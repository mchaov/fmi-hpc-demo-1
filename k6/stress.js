import { runRequest, weightedReportMode } from './common.js';

export const options = {
  stages: [
    { duration: '2m', target: 20 },
    { duration: '2m', target: 40 },
    { duration: '2m', target: 80 },
    { duration: '2m', target: 120 }
  ]
};

const mix = [
  ['fast', 0.55],
  ['search', 0.15],
  ['dependency', 0.2],
  ['slow', 0.1]
];

export default function () {
  const mode = weightedReportMode(mix);

  if (mode === 'search') {
    runRequest('/api/search?q=throughput', { scenario: 'stress', operation: 'search' });
    return;
  }

  runRequest(`/api/report?mode=${mode}`, { scenario: 'stress', operation: mode });
}
