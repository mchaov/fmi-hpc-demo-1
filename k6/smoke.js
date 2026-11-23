import { check } from 'k6';
import http from 'k6/http';

import {
  BASE_URL,
  buildScenarioOptions,
  createSummaryHandler,
  getScenarioRequestOptions
} from './common.js';

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

export const options = buildScenarioOptions(metadata, {
  executor: 'shared-iterations',
  vus: 1,
  iterations: 5
}, {
  thresholds: {
    checks: ['rate==1'],
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<300']
  }
});

export const handleSummary = createSummaryHandler(metadata);

const smokeRequestOptions = __ENV.SMOKE_INVOCATION
  ? { tags: { smoke_invocation: __ENV.SMOKE_INVOCATION } }
  : {};

export default function () {
  const health = http.get(
    `${BASE_URL}/health`,
    getScenarioRequestOptions('health', smokeRequestOptions)
  );
  check(health, {
    'health returns 200': (res) => res.status === 200
  });

  const fast = http.get(
    `${BASE_URL}/api/report?mode=fast`,
    getScenarioRequestOptions('fast', smokeRequestOptions)
  );
  check(fast, {
    'fast path returns 200': (res) => res.status === 200
  });
}
