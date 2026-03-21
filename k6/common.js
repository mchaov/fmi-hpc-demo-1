import http from 'k6/http';
import { check, sleep } from 'k6';
import { Gauge } from 'k6/metrics';

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
const DEFAULT_THINK_TIME_SECONDS = Number.parseFloat(__ENV.K6_THINK_TIME || '0.1');
const workloadTargetShare = new Gauge('workload_target_share');

export const BASELINE_MIX = [
  ['fast', 0.6],
  ['search', 0.2],
  ['dependency', 0.15],
  ['slow', 0.05]
];

export const STRESS_MIX = [
  ['fast', 0.55],
  ['search', 0.15],
  ['dependency', 0.2],
  ['slow', 0.1]
];

export const DEGRADED_MIX = [
  ['fast', 0.45],
  ['search', 0.2],
  ['dependency', 0.05],
  ['degraded', 0.3]
];

const DURATION_TO_MS = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000
};

function sanitizeRunIdSegment(value) {
  return `${value || 'na'}`
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'na';
}

function createDefaultTestRunId(metadata) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return [
    sanitizeRunIdSegment(metadata.scenario),
    sanitizeRunIdSegment(metadata.variant || 'nominal'),
    sanitizeRunIdSegment(metadata.workloadProfile || 'representative'),
    timestamp
  ].join('-');
}

export function getTestRunId(metadata) {
  if (!metadata.testRunId) {
    metadata.testRunId = __ENV.TEST_RUN_ID || createDefaultTestRunId(metadata);
  }

  return metadata.testRunId;
}

export function weightedReportMode(weightMap) {
  const value = Math.random();
  let cumulative = 0;

  for (const [mode, weight] of weightMap) {
    cumulative += weight;
    if (value <= cumulative) {
      return mode;
    }
  }

  return weightMap[weightMap.length - 1][0];
}

export function describeMix(weightMap) {
  return weightMap.map(([mode, weight]) => `${Math.round(weight * 100)}% ${mode}`).join(', ');
}

export function readPositiveIntEnv(name, defaultValue) {
  const rawValue = __ENV[name];

  if (!rawValue) {
    return defaultValue;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${rawValue}`);
  }

  return parsed;
}

export function readDurationEnv(name, defaultValue) {
  const rawValue = `${__ENV[name] || ''}`.trim();
  return rawValue || defaultValue;
}

export function buildStageMetadata(stages) {
  return stages.map((stage) => ({
    duration: stage.duration,
    target: stage.target
  }));
}

export function getCommonTestTags(metadata) {
  return {
    scenario: metadata.scenario,
    test_type: metadata.testType,
    variant: metadata.variant || 'nominal',
    run_profile: metadata.runProfile || 'student',
    workload_profile: metadata.workloadProfile || 'representative',
    test_run_id: getTestRunId(metadata)
  };
}

export function buildScenarioOptions(metadata, scenarioOptions, extraOptions = {}) {
  return {
    scenarios: {
      [metadata.scenario]: {
        exec: 'default',
        tags: getCommonTestTags(metadata),
        ...scenarioOptions
      }
    },
    ...extraOptions
  };
}

function getRequestName(operation) {
  if (operation === 'health' || operation === 'metrics') {
    return operation;
  }

  if (operation === 'search') {
    return 'search';
  }

  return `report-${operation}`;
}

export function getScenarioTags(metadata, operation, overrides = {}) {
  return {
    ...getCommonTestTags(metadata),
    operation,
    name: getRequestName(operation),
    ...overrides
  };
}

function emitWorkloadTargetShare(metadata) {
  if (!Array.isArray(metadata.workloadMixMap) || metadata.workloadMixMap.length === 0) {
    return;
  }

  const commonTags = getCommonTestTags(metadata);
  for (const [operation, share] of metadata.workloadMixMap) {
    workloadTargetShare.add(share, {
      ...commonTags,
      operation
    });
  }
}

export function getScenarioRequestOptions(metadata, operation, overrides = {}) {
  return {
    headers: {
      'x-test-run-id': getTestRunId(metadata),
      ...(overrides.headers || {})
    },
    tags: getScenarioTags(metadata, operation, overrides.tags || {})
  };
}

export function runRequest(path, metadata, operation, overrides = {}) {
  emitWorkloadTargetShare(metadata);
  const response = http.get(
    `${BASE_URL}${path}`,
    getScenarioRequestOptions(metadata, operation, overrides)
  );

  check(response, {
    'status is below 500': (res) => res.status < 500
  });

  const thinkTime = overrides.thinkTime ?? metadata.thinkTime ?? DEFAULT_THINK_TIME_SECONDS;
  if (thinkTime > 0) {
    sleep(thinkTime);
  }

  return response;
}

export function runReportMode(mode, metadata, overrides = {}) {
  return runRequest(`/api/report?mode=${mode}`, metadata, mode, overrides);
}

export function runSearch(query, metadata, overrides = {}) {
  return runRequest(`/api/search?q=${encodeURIComponent(query)}`, metadata, 'search', overrides);
}

function collectThresholdResults(metrics) {
  const results = [];

  for (const [metricName, metric] of Object.entries(metrics || {})) {
    for (const [rule, evaluation] of Object.entries(metric.thresholds || {})) {
      results.push({
        metricName,
        rule,
        ok: evaluation.ok
      });
    }
  }

  return results;
}

function parseDurationToMs(duration) {
  const match = /^(\d+)(ms|s|m|h)$/.exec(`${duration}`.trim());
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1], 10) * DURATION_TO_MS[match[2]];
}

function formatValue(value, digits = 2) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return value.toFixed(digits);
}

function formatPercent(value) {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }

  return `${(value * 100).toFixed(2)}%`;
}

function summarizeBreakpoint(metadata, data) {
  if (!metadata.breakpointStages?.length) {
    return null;
  }

  const testRunDurationMs = data.state?.testRunDurationMs;
  if (!Number.isFinite(testRunDurationMs)) {
    return null;
  }

  let cumulativeDuration = 0;
  let breakingStageIndex = -1;

  for (let index = 0; index < metadata.breakpointStages.length; index += 1) {
    cumulativeDuration += parseDurationToMs(metadata.breakpointStages[index].duration) || 0;
    if (testRunDurationMs <= cumulativeDuration) {
      breakingStageIndex = index;
      break;
    }
  }

  if (breakingStageIndex === -1) {
    return {
      status: 'completed',
      lastPassingStage: metadata.breakpointStages[metadata.breakpointStages.length - 1].target,
      breakingStage: null
    };
  }

  return {
    status: 'aborted',
    lastPassingStage: breakingStageIndex > 0 ? metadata.breakpointStages[breakingStageIndex - 1].target : null,
    breakingStage: metadata.breakpointStages[breakingStageIndex].target
  };
}

export function createSummaryHandler(metadata) {
  return function handleSummary(data) {
    const thresholdResults = collectThresholdResults(data.metrics);
    const allThresholdsPassed = thresholdResults.every((result) => result.ok);
    const httpReqs = data.metrics.http_reqs?.values || {};
    const httpReqDuration = data.metrics.http_req_duration?.values || {};
    const httpReqFailed = data.metrics.http_req_failed?.values || {};
    const iterationDuration = data.metrics.iteration_duration?.values || {};
    const breakpointSummary = summarizeBreakpoint(metadata, data);
    const lines = [
      '=== K6 Lecture Summary ===',
      `Scenario: ${metadata.scenario}`,
      `Lecture type: ${metadata.testType}`,
      `Variant: ${metadata.variant || 'nominal'}`,
      `Run profile: ${metadata.runProfile || 'student'}`,
      `Workload profile: ${metadata.workloadProfile || 'representative'}`,
      `Test run id: ${getTestRunId(metadata)}`,
      `Workload mix: ${metadata.workloadMix || 'n/a'}`,
      `Evaluation: ${metadata.evaluationMode === 'observational' ? 'observational' : 'threshold-based'}`,
      `Result: ${
        metadata.evaluationMode === 'observational'
          ? 'OBSERVE'
          : allThresholdsPassed
            ? 'PASS'
            : 'FAIL'
      }`,
      `Requests: ${formatValue(httpReqs.count, 0)}`,
      `Request rate: ${formatValue(httpReqs.rate)} req/s`,
      `Error rate: ${formatPercent(httpReqFailed.rate)}`,
      `Latency avg: ${formatValue(httpReqDuration.avg)} ms`,
      `Latency p95: ${formatValue(httpReqDuration['p(95)'])} ms`,
      `Latency p99: ${formatValue(httpReqDuration['p(99)'])} ms`,
      `Iteration avg: ${formatValue(iterationDuration.avg)} ms`
    ];

    if (metadata.notes) {
      lines.push(`Focus: ${metadata.notes}`);
    }

    if (breakpointSummary) {
      lines.push(
        `Breakpoint status: ${breakpointSummary.status}`,
        `Last passing stage: ${breakpointSummary.lastPassingStage === null ? 'none' : `${breakpointSummary.lastPassingStage} VUs`}`,
        `Breaking stage: ${breakpointSummary.breakingStage === null ? 'not reached' : `${breakpointSummary.breakingStage} VUs`}`
      );
    }

    if (metadata.thresholdSummary?.length) {
      lines.push('Thresholds:');
      for (const threshold of metadata.thresholdSummary) {
        lines.push(`- ${threshold}`);
      }
    }

    if (thresholdResults.length) {
      lines.push('Threshold results:');
      for (const result of thresholdResults) {
        lines.push(`- ${result.metricName}: ${result.rule} => ${result.ok ? 'PASS' : 'FAIL'}`);
      }
    }

    return {
      stdout: `${lines.join('\n')}\n`
    };
  };
}
