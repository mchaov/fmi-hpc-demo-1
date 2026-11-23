import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

function panels(file) {
  const path = new URL(`../observability/grafana/dashboards/${file}.json`, import.meta.url);
  return JSON.parse(readFileSync(path)).panels;
}

const comparison = panels('run-comparison');
const correlation = panels('load-test-correlation');
const defaults = {
  scenario: '.*', test_type: '.*', variant: '.*', run_profile: '.*', workload_profile: '.*',
  operation: '.*', base_run_id: 'base', candidate_run_id: 'candidate', test_run_id: 'base',
  __range: '3m', __rate_interval: '2m'
};

function query(dashboard, panel, variables = {}) {
  const values = { ...defaults, ...variables };
  return dashboard.find(p => p.title === panel).targets[0].expr
    .replace(/\$(\w+)/g, (_, key) => values[key]);
}

function histogram(count, seconds) {
  const offset = Math.ceil(Math.log2(seconds) * 256);
  return `{{schema:8 count:${count} sum:${count * seconds} offset:${offset} buckets:[${count}]}}`;
}

test('provisioned panel queries evaluate correctly on known Prometheus samples', () => {
  const inputs = [];
  const checks = [];
  function series(metric, run, tags, values) {
    const labels = Object.entries({ test_run_id: run, ...tags }).map(([k, v]) => `${k}="${v}"`);
    inputs.push({ series: `${metric}{${labels.join(',')}}`, values });
  }
  function expect(expr, value, labels = '{}') {
    checks.push({ expr, eval_time: '2m', exp_samples: value === null ? [] : [{ labels, value }] });
  }
  function within(expr, low, high) {
    return `(sum(${expr}) > bool ${low}) * (sum(${expr}) < bool ${high})`;
  }
  for (const [operation, success, count] of [
    ['fast', 'true', 60], ['dependency', 'true', 5], ['degraded', 'true', 20],
    ['degraded', 'false', 10], ['slow', 'true', 5]
  ]) {
    series('k6_http_reqs_total', 'base', { operation, expected_response: success }, `0 0 ${count}`);
  }
  series('k6_http_reqs_total', 'candidate', { operation: 'fast', expected_response: 'true' }, '0 0 10');
  series('k6_workload_target_share', 'base', { operation: 'fast' }, '0.6x2');
  series('k6_vus', 'base', {}, '5x2');
  series('k6_vus', 'candidate', {}, '20x2');
  for (const [operation, count, seconds] of [['fast', 990, 0.01], ['slow', 10, 0.156]]) {
    const samples = [0, 1, count].map(n => histogram(n, seconds)).join(' ');
    series('k6_http_req_duration_seconds', 'base', { operation }, samples);
  }

  expect(query(comparison, 'Base Error Rate'), 0.1);
  expect(query(comparison, 'Candidate Error Rate'), 0);
  expect(query(comparison, 'Delta Error Rate'), -0.1);
  expect(query(comparison, 'Base Error Rate', { base_run_id: 'missing' }), null);
  expect(query(comparison, 'Base Dependency Share'), 0.35);
  expect(query(comparison, 'Delta Avg VUs'), 15);
  expect(query(correlation, 'Active VUs'), 5);
  expect(query(correlation, 'Active VUs', { test_run_id: 'missing' }), null);
  expect(query(correlation, 'k6 Request Share By Operation', { operation: 'fast' }), 0.6, '{operation="fast"}');
  expect(within(query(comparison, 'Base p95 Latency'), 9.5, 10.5), 1);
  expect(within(query(comparison, 'Base p95 Latency By Operation', { operation: 'slow' }), 155, 157), 1);
  for (const [dashboard, actual, drift] of [
    [comparison, 'Base Actual Share By Operation', 'Base Drift By Operation'],
    [correlation, 'Target vs Actual Share By Operation', 'Workload Mix Drift By Operation']
  ]) {
    expect(query(dashboard, actual, { operation: 'fast' }), 0.6, '{operation="fast"}');
    expect(`abs(${query(dashboard, drift, { operation: 'fast' })}) < bool 1e-12`, 1, '{operation="fast"}');
  }

  const fixture = { fuzzy_compare: true, tests: [{ interval: '1m', input_series: inputs, promql_expr_test: checks }] };
  execFileSync('docker', ['compose', 'exec', '-T', 'prometheus', 'promtool', 'test', 'rules', '/dev/stdin'],
    { input: JSON.stringify(fixture), stdio: ['pipe', 'inherit', 'inherit'] });
});
