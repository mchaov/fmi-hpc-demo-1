import { runRequest, weightedReportMode } from './common.js';

export const options = {
  stages: [
    { duration: '30s', target: 80 },
    { duration: '60s', target: 80 },
    { duration: '30s', target: 0 }
  ],
  thresholds: {
    http_req_failed: ['rate<0.03'],
    http_req_duration: ['p(99)<2500']
  }
};

const mix = [
  ['fast', 0.6],
  ['search', 0.2],
  ['dependency', 0.15],
  ['slow', 0.05]
];

export default function () {
  const mode = weightedReportMode(mix);

  if (mode === 'search') {
    runRequest('/api/search?q=latency', { scenario: 'spike', operation: 'search' });
    return;
  }

  runRequest(`/api/report?mode=${mode}`, { scenario: 'spike', operation: mode });
}
