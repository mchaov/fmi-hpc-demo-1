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
  scenario: 'spike',
  testType: 'spike',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'burst',
  workloadMixMap: BASELINE_MIX,
  workloadMix: describeMix(BASELINE_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.03',
    'http_req_duration p(99) < 2500ms'
  ],
  notes: 'Nominal load followed by escalating spikes to 60, 90, 150, 200, 300 VUs with repeated returns to baseline.'
};

export const options = buildScenarioOptions(metadata, {
  executor: 'ramping-vus',
  stages: [
    { duration: '30s', target: 5 },
    { duration: '60s', target: 60 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 90 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 150 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 150 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 150 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 200 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 300 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 300 },
    { duration: '30s', target: 5 },
    { duration: '60s', target: 0 }
  ]
}, {
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(99)<2500']
  }
});

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);

  if (mode === 'search') {
    runSearch('latency', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
