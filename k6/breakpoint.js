import exec from 'k6/execution';
import { breakpointSummary, durationMs, MAX_ERROR_RATE, MAX_P95_MS } from './breakpoint-stages.js';
import {
  BASELINE_MIX,
  buildScenarioOptions,
  createSummaryHandler,
  describeMix,
  readDurationEnv,
  readPositiveIntEnv,
  runReportMode,
  runSearch,
  weightedReportMode
} from './common.js';

const BREAKPOINT_STEP_DURATION = readDurationEnv('BREAKPOINT_STEP_DURATION', '90s');
const BREAKPOINT_MAX_VUS = readPositiveIntEnv('BREAKPOINT_MAX_VUS', 120);

function buildBreakpointStages(maxVus, stepDuration) {
  const stages = [];

  for (let target = 20; target <= maxVus; target += 20) {
    stages.push({ duration: stepDuration, target });
  }

  if (stages[stages.length - 1]?.target !== maxVus) {
    stages.push({ duration: stepDuration, target: maxVus });
  }

  return stages;
}

const breakpointStages = buildBreakpointStages(BREAKPOINT_MAX_VUS, BREAKPOINT_STEP_DURATION);
const stepMs = durationMs(BREAKPOINT_STEP_DURATION);
if (stepMs <= 0) throw new Error('BREAKPOINT_STEP_DURATION must be positive.');
const cooldown = '30s';
const stageMetrics = {};
for (const { target } of breakpointStages) {
  // Empty thresholds collect submetric summaries without changing the run's exit criteria.
  stageMetrics[`http_req_failed{breakpoint_stage:${target}}`] = [];
  stageMetrics[`http_req_duration{breakpoint_stage:${target}}`] = [];
}

const metadata = {
  scenario: 'breakpoint',
  testType: 'breakpoint',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'capacity-ramp',
  workloadMixMap: BASELINE_MIX,
  workloadMix: describeMix(BASELINE_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    `http_req_failed rate < ${MAX_ERROR_RATE}, abort evaluation begins after 30s`,
    `http_req_duration p(95) < ${MAX_P95_MS}ms, abort evaluation begins after 30s`
  ],
  notes: 'Each completed ramp stage is evaluated using its own requests.'
};

export const options = buildScenarioOptions(metadata, {
  executor: 'ramping-vus',
  stages: [
    ...breakpointStages,
    { duration: cooldown, target: 0 }
  ]
}, {
  thresholds: {
    ...stageMetrics,
    http_req_failed: [
      {
        threshold: `rate<${MAX_ERROR_RATE}`,
        abortOnFail: true,
        delayAbortEval: '30s'
      }
    ],
    http_req_duration: [
      {
        threshold: `p(95)<${MAX_P95_MS}`,
        abortOnFail: true,
        delayAbortEval: '30s'
      }
    ]
  }
});

export const handleSummary = createSummaryHandler(metadata, (data, passed) =>
  breakpointSummary(data, passed, breakpointStages, stepMs, durationMs(cooldown)));

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);
  const index = Math.floor((Date.now() - exec.scenario.startTime) / stepMs);
  const stage = String(breakpointStages[index]?.target ?? 'ramp-down');
  const overrides = { tags: { breakpoint_stage: stage } };

  if (mode === 'search') {
    runSearch('capacity', metadata, overrides);
    return;
  }

  runReportMode(mode, metadata, overrides);
}
