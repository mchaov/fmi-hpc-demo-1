import {
  BASELINE_MIX,
  buildStageMetadata,
  createSummaryHandler,
  describeMix,
  getCommonTestTags,
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

const metadata = {
  scenario: 'breakpoint',
  testType: 'breakpoint',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'capacity-ramp',
  workloadMix: describeMix(BASELINE_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.05 with abort after 30s of sustained breach',
    'http_req_duration p(95) < 1200ms with abort after 30s of sustained breach'
  ],
  notes: 'Step ramp to identify the last passing capacity stage.',
  breakpointStages: buildStageMetadata(breakpointStages)
};

export const options = {
  stages: [
    ...breakpointStages,
    { duration: '30s', target: 0 }
  ],
  tags: getCommonTestTags(metadata),
  thresholds: {
    http_req_failed: [
      {
        threshold: 'rate<0.05',
        abortOnFail: true,
        delayAbortEval: '30s'
      }
    ],
    http_req_duration: [
      {
        threshold: 'p(95)<1200',
        abortOnFail: true,
        delayAbortEval: '30s'
      }
    ]
  }
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);

  if (mode === 'search') {
    runSearch('capacity', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
