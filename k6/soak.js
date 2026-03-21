import {
  BASELINE_MIX,
  buildScenarioOptions,
  createSummaryHandler,
  describeMix,
  readDurationEnv,
  runReportMode,
  runSearch,
  weightedReportMode
} from './common.js';

const SOAK_DURATION = readDurationEnv('SOAK_DURATION', '20m');

const metadata = {
  scenario: 'soak',
  testType: 'soak',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'sustained',
  workloadMixMap: BASELINE_MIX,
  workloadMix: describeMix(BASELINE_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.01',
    'http_req_duration p(95) < 700ms'
  ],
  notes: `Sustained representative load for ${SOAK_DURATION} to inspect drift and resource stability.`
};

export const options = buildScenarioOptions(metadata, {
  executor: 'constant-vus',
  vus: 20,
  duration: SOAK_DURATION
}, {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<700']
  }
});

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);

  if (mode === 'search') {
    runSearch('sustainability', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
