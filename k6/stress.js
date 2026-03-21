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
  scenario: 'stress',
  testType: 'stress',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'capacity-ramp',
  workloadMix: describeMix(STRESS_MIX),
  evaluationMode: 'observational',
  thresholdSummary: [
    'No hard fail thresholds. Observe saturation, latency growth, and errors.'
  ],
  notes: 'Student-safe stress ramp for capacity observation.'
};

export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '2m', target: 40 },
    { duration: '2m', target: 80 },
    { duration: '2m', target: 120 },
    { duration: '30s', target: 0 }
  ],
  tags: getCommonTestTags(metadata)
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(STRESS_MIX);

  if (mode === 'search') {
    runSearch('throughput', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
