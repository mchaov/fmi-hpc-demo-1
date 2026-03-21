import {
  DEGRADED_MIX,
  createSummaryHandler,
  describeMix,
  getCommonTestTags,
  runReportMode,
  runSearch,
  weightedReportMode
} from './common.js';

const metadata = {
  scenario: 'degraded',
  testType: 'load',
  variant: 'degraded',
  runProfile: 'student',
  workloadProfile: 'representative',
  workloadMixMap: DEGRADED_MIX,
  workloadMix: describeMix(DEGRADED_MIX),
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.08',
    'http_req_duration p(95) < 1200ms'
  ],
  notes: 'Degraded comparison against nominal load with dependency slowdown injected.'
};

export const options = {
  vus: 20,
  duration: '2m',
  tags: getCommonTestTags(metadata),
  thresholds: {
    http_req_failed: ['rate<0.08'],
    http_req_duration: ['p(95)<1200']
  }
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(DEGRADED_MIX);

  if (mode === 'search') {
    runSearch('degraded', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
