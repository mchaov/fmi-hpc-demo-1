import { check } from 'k6';
import http from 'k6/http';

import { BASE_URL, createSummaryHandler, getCommonTestTags, getScenarioTags } from './common.js';

const metadata = {
  scenario: 'smoke',
  testType: 'preflight',
  variant: 'nominal',
  runProfile: 'student',
  workloadProfile: 'preflight',
  workloadMix: 'health + fast path preflight',
  evaluationMode: 'threshold',
  thresholdSummary: [
    'http_req_failed rate < 0.01',
    'http_req_duration p(95) < 300ms'
  ],
  notes: 'Operational preflight; not part of the lecture taxonomy.'
};

export const options = {
  vus: 1,
  iterations: 5,
  tags: getCommonTestTags(metadata),
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300']
  }
};

export const handleSummary = createSummaryHandler(metadata);

export default function () {
  const health = http.get(`${BASE_URL}/health`, {
    tags: getScenarioTags(metadata, 'health')
  });
  check(health, {
    'health returns 200': (res) => res.status === 200
  });

  const fast = http.get(`${BASE_URL}/api/report?mode=fast`, {
    tags: getScenarioTags(metadata, 'fast')
  });
  check(fast, {
    'fast path returns 200': (res) => res.status === 200
  });
}
