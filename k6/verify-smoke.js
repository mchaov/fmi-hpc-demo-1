import http from 'k6/http';
import { sleep } from 'k6';

export const options = { vus: 1, iterations: 1 };

export function setup() {
  const endpoint = __ENV.PROMETHEUS_QUERY_URL || 'http://prometheus:9090/api/v1/query';
  const query = `sum(k6_http_reqs_total{smoke_invocation="${__ENV.SMOKE_INVOCATION}"}) > 0`;
  const url = `${endpoint}?query=${encodeURIComponent(query)}`;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = http.get(url, { timeout: Math.max(1, Math.min(1000, deadline - Date.now())) });
    if (response.status === 200) {
      try {
        const payload = response.json();
        if (payload.status === 'success' && payload.data?.result?.length > 0) {
          return;
        }
      } catch {
        // A restarting receiver can temporarily return a non-JSON response.
      }
    }
    sleep(Math.min(0.5, Math.max(0, deadline - Date.now()) / 1000));
  }
  throw new Error('Prometheus did not return a request sample from this smoke invocation within 15s.');
}

export default function () {}

export function handleSummary() {
  return {};
}
