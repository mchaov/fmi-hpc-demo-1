import { runRequest, weightedReportMode } from './common.js';

export const options = {
  vus: 20,
  duration: '2m',
  thresholds: {
    http_req_failed: ['rate<0.08'],
    http_req_duration: ['p(95)<1200']
  }
};

const mix = [
  ['fast', 0.45],
  ['search', 0.2],
  ['dependency', 0.05],
  ['degraded', 0.3]
];

export default function () {
  const mode = weightedReportMode(mix);

  if (mode === 'search') {
    runRequest('/api/search?q=degraded', { scenario: 'degraded', operation: 'search' });
    return;
  }

  runRequest(`/api/report?mode=${mode}`, { scenario: 'degraded', operation: mode });
}
