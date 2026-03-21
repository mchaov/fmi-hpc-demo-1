import {
  STRESS_MIX,
  buildScenarioOptions,
  createSummaryHandler,
  describeMix,
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
  workloadMixMap: STRESS_MIX,
  workloadMix: describeMix(STRESS_MIX),
  evaluationMode: 'observational',
  thresholdSummary: [
    'No hard fail thresholds. Observe saturation, latency growth, and errors.'
  ],
  notes: 'Student-safe stress ramp for capacity observation.'
};

export const options = buildScenarioOptions(metadata, {
  executor: 'ramping-vus',
  stages: [
    { duration: '2m', target: 20 },
    { duration: '2m', target: 40 },
    { duration: '2m', target: 80 },
    { duration: '2m', target: 120 },
    { duration: '30s', target: 0 }
  ]
});

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const mode = weightedReportMode(STRESS_MIX);

  if (mode === 'search') {
    runSearch('throughput', metadata);
    return;
  }

  runReportMode(mode, metadata);
}
