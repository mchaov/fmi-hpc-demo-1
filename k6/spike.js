import {
  BASELINE_MIX,
  createSummaryHandler,
  describeMix,
  getCommonTestTags,
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
  notes: 'Ten short bursts to visualize repeated latency and throughput spikes.'
};

export const options = {
  stages: [
    { duration: '10s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '5s', target: 80 },
    { duration: '10s', target: 80 },
    { duration: '15s', target: 10 },
    { duration: '10s', target: 0 }
  ],
  tags: getCommonTestTags(metadata),
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(99)<2500']
  }
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(BASELINE_MIX);

  if (mode === 'search') {
    runSearch('latency', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
