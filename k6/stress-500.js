import {
  STRESS_MIX,
  createSummaryHandler,
  describeMix,
  getCommonTestTags,
  runReportMode,
  runSearch,
  weightedReportMode
} from './common.js';

const metadata = {
  scenario: 'stress-500',
  testType: 'stress',
  variant: 'nominal',
  runProfile: 'extended-500',
  workloadProfile: 'capacity-ramp',
  workloadMixMap: STRESS_MIX,
  workloadMix: describeMix(STRESS_MIX),
  evaluationMode: 'observational',
  thresholdSummary: [
    'No hard fail thresholds. Extended ramp intended for stronger laptops or instructor demos.'
  ],
  notes: 'Advanced stress ramp up to 500 VUs.'
};

export const options = {
  stages: [
    { duration: '60s', target: 50 },
    { duration: '60s', target: 100 },
    { duration: '60s', target: 150 },
    { duration: '60s', target: 200 },
    { duration: '60s', target: 250 },
    { duration: '60s', target: 300 },
    { duration: '60s', target: 350 },
    { duration: '60s', target: 400 },
    { duration: '60s', target: 450 },
    { duration: '60s', target: 500 },
    { duration: '30s', target: 0 }
  ],
  tags: getCommonTestTags(metadata)
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(STRESS_MIX);

  if (mode === 'search') {
    runSearch('capacity', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
