import { runRequest, weightedReportMode } from './common.js';

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500', 'p(99)<1200']
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
    runRequest('/api/search?q=performance', { scenario: 'baseline', operation: 'search' });
    return;
  }

  runRequest(`/api/report?mode=${mode}`, { scenario: 'baseline', operation: mode });
}
