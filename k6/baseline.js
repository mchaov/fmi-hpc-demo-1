import {
  BASELINE_MIX,
  buildScenarioOptions,
  createSummaryHandler,
  describeMix,
  runReportMode,
  runSearch,
  weightedReportMode
} from './common.js';

const metadata = {
  scenario: 'baseline',
  testType: 'load',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'representative',
  workloadMixMap: BASELINE_MIX,
  workloadMix: describeMix(BASELINE_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.01',
    'http_req_duration p(95) < 500ms',
    'http_req_duration p(99) < 1200ms'
  ],
  notes: 'Representative nominal load for baseline comparison.'
};

export const options = buildScenarioOptions(metadata, {
  executor: 'constant-vus',
  vus: 20,
  duration: '2m'
}, {
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1200']
  }
});

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);

  if (mode === 'search') {
    runSearch('performance', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
