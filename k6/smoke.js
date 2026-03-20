import { check } from 'k6';
import http from 'k6/http';

import { BASE_URL } from './common.js';

export const options = {
  vus: 1,
  iterations: 5,
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300']
  }
};

export default function () {
  const health = http.get(`${BASE_URL}/health`, { tags: { scenario: 'smoke' } });
  check(health, {
    'health returns 200': (res) => res.status === 200
  });

  const fast = http.get(`${BASE_URL}/api/report?mode=fast`, { tags: { scenario: 'smoke' } });
  check(fast, {
    'fast path returns 200': (res) => res.status === 200
  });
}
