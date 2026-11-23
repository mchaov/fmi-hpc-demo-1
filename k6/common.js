import http from 'k6/http';
import exec from 'k6/execution';
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

function getCommonTestTags(metadata) {
  return {
    scenario: metadata.scenario,
    test_type: metadata.testType,
    variant: metadata.variant || 'nominal',
    run_profile: metadata.runProfile || 'student',
    workload_profile: metadata.workloadProfile || 'representative',
    test_run_id: __ENV.TEST_RUN_ID || createDefaultTestRunId(metadata)
  };
}

export function buildScenarioOptions(metadata, scenarioOptions, extraOptions = {}) {
  return {
    tags: getCommonTestTags(metadata),
    summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(90)', 'p(95)', 'p(99)'],
    scenarios: {
      [metadata.scenario]: {
        exec: 'default',
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

function getScenarioTags(operation, overrides = {}) {
  return {
    operation,
    name: getRequestName(operation),
    ...overrides
  };
}

function emitWorkloadTargetShare(metadata) {
  if (!Array.isArray(metadata.workloadMixMap) || metadata.workloadMixMap.length === 0) {
    return;
  }

  for (const [operation, share] of metadata.workloadMixMap) {
    workloadTargetShare.add(share, { operation });
  }
}

export function getScenarioRequestOptions(operation, overrides = {}) {
  return {
    headers: {
      'x-test-run-id': exec.test.options.tags.test_run_id,
      ...(overrides.headers || {})
    },
    tags: getScenarioTags(operation, overrides.tags)
  };
}

export function runRequest(path, metadata, operation, overrides = {}) {
  emitWorkloadTargetShare(metadata);
  const response = http.get(
    `${BASE_URL}${path}`,
    getScenarioRequestOptions(operation, overrides)
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

export function createSummaryHandler(metadata, additionalLines) {
  return function handleSummary(data) {
    const thresholdResults = collectThresholdResults(data.metrics);
    const allThresholdsPassed = thresholdResults.every((result) => result.ok);
    const httpReqs = data.metrics.http_reqs?.values || {};
    const httpReqDuration = data.metrics.http_req_duration?.values || {};
    const httpReqFailed = data.metrics.http_req_failed?.values || {};
    const iterationDuration = data.metrics.iteration_duration?.values || {};
    const lines = [
      '=== K6 Lecture Summary ===',
      `Scenario: ${metadata.scenario}`,
      `Lecture type: ${metadata.testType}`,
      `Variant: ${metadata.variant || 'nominal'}`,
      `Run profile: ${metadata.runProfile || 'student'}`,
      `Workload profile: ${metadata.workloadProfile || 'representative'}`,
      `Test run id: ${exec.test.options.tags.test_run_id}`,
      `Workload mix: ${metadata.workloadMix || 'n/a'}`,
      `Evaluation: ${metadata.evaluationMode === 'observational' ? 'observational' : 'threshold-based'}`,
      `${metadata.scenario === 'smoke' ? 'HTTP result' : 'Result'}: ${
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

    if (additionalLines) {
      lines.push(...additionalLines(data, allThresholdsPassed));
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
