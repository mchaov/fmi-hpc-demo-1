import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

function panels(file) {
  const path = new URL(`../observability/grafana/dashboards/${file}.json`, import.meta.url);
  return JSON.parse(readFileSync(path)).panels;
}

const comparison = panels('run-comparison');
const correlation = panels('load-test-correlation');
const endpoint = panels('endpoint-comparison');
const dependency = panels('dependency-health');
const system = panels('system-overview');
const defaults = {
  scenario: '.*', test_type: '.*', variant: '.*', run_profile: '.*', workload_profile: '.*',
  route: '.*', mode: '.*', operation: '.*', base_run_id: 'base', candidate_run_id: 'candidate', test_run_id: 'base',
  __range: '3m', __rate_interval: '2m'
};

function query(dashboard, id, variables = {}, refId = 'A') {
  const values = { ...defaults, ...variables };
  const target = dashboard.find(panel => panel.id === id).targets.find(target => target.refId === refId);
  const selection = variables.selection ?? [values.test_run_id];
  const params = new URLSearchParams(selection.map(run => ['var-test_run_id', run]));
  // Grafana passes its All sentinel unescaped in the queryparam formatter.
  const formatted = selection[0] === '$__all' ? 'var-test_run_id=$__all' : params.toString();
  return target.expr.replace(/\$(\w+)/g, (_, key) => values[key])
    .replaceAll('${test_run_id:queryparam}', () => formatted);
}

function metricRow(metric, refId, variables) {
  const table = query(comparison, 2, variables, refId);
  return `sum((${table}) and on(Metric) label_replace(vector(1), "Metric", "${metric}", "", ""))`;
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
    checks.push({ expr, eval_time: '1m', exp_samples: value === null ? [] : [{ labels, value }] });
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
  series('k6_http_reqs_total', 'candidate', { operation: 'fast', expected_response: 'true' }, '0 0 8');
  series('k6_http_reqs_total', 'candidate', { operation: 'new', expected_response: 'true' }, '0 0 2');
  series('k6_http_reqs_total', 'smoke', { operation: 'fast' }, '_ _ 10');
  series('k6_http_reqs_total', 'idle', { operation: 'fast' }, '0x2');
  for (const [operation, target] of [['fast', 0.6], ['dependency', 0.1], ['search', 0.3]]) {
    series('k6_workload_target_share', 'base', { operation }, `${target}x2`);
  }
  series('k6_workload_target_share', 'candidate', { operation: 'fast' }, '1x2');

  for (const [route, mode, count] of [
    ['/api/report', 'fast', 40], ['/api/report', 'dependency', 10], ['/api/report', 'degraded', 30],
    ['/api/search', 'search', 20], ['/health', 'health', 900], ['/idle', 'idle', 0]
  ]) {
    series('http_requests_total', 'service', { service: 'demo-api', route, mode, status_code: '200' },
      `0 ${count} ${2 * count}`);
  }
  series('k6_vus', 'base', {}, '5x2');
  series('k6_vus', 'candidate', {}, '20x2');
  for (const [operation, count, seconds] of [['fast', 990, 0.01], ['slow', 10, 0.156]]) {
    const samples = [0, 1, count].map(n => histogram(n, seconds)).join(' ');
    series('k6_http_req_duration_seconds', 'base', { operation }, samples);
  }

  expect(metricRow('Total requests', 'A'), 100);
  expect(metricRow('Total requests', 'B', { candidate_run_id: 'smoke' }), 10);
  expect(metricRow('Error rate (%)', 'A'), 10);
  expect(metricRow('Error rate (%)', 'B'), 0);
  expect(metricRow('Dependency share (%)', 'A'), 35);
  expect(`(${metricRow('Average VUs', 'B')}) - (${metricRow('Average VUs', 'A')})`, 15);
  expect(within(metricRow('p95 latency (ms)', 'A'), 9.5, 10.5), 1);
  expect(within(query(comparison, 28, { operation: 'slow' }), 155, 157), 1);
  expect(metricRow('Workload-mix drift (%)', 'A'), 35);
  for (const [metric, run] of [['Total requests', 'missing'], ['Workload-mix drift (%)', 'smoke']]) {
    const row = metricRow(metric, 'B', { candidate_run_id: run });
    expect(`(${row}) == bool (${row})`, 0); // NaN keeps the table row and renders as an em dash.
  }

  for (const [operation, change] of [['fast', 20], ['new', 20], ['slow', -5], ['degraded', -30]]) {
    expect(`round(${query(comparison, 25, { operation })}, 0.000001)`, change, `{operation="${operation}"}`);
  }
  for (const candidate_run_id of ['idle', 'missing']) {
    expect(query(comparison, 25, { candidate_run_id }), null);
  }
  expect(query(comparison, 21, { operation: 'search' }), 0, '{operation="search"}');
  expect(query(comparison, 23, { operation: 'search' }), -30, '{operation="search"}');
  expect(query(comparison, 24, { candidate_run_id: 'smoke' }), null);
  expect(query(comparison, 22, { operation: 'fast' }, 'B'), 1, '{operation="fast"}');

  expect(query(correlation, 1), 5);
  expect(query(correlation, 1, { test_run_id: 'base|candidate' }), 20);
  expect(query(correlation, 1, { test_run_id: 'missing' }), null);
  expect(query(correlation, 18, { operation: 'fast' }), 0.6, '{operation="fast"}');
  expect(`sum(${query(correlation, 30, {}, 'B')})`, 1);
  expect(query(correlation, 31, { operation: 'search' }), -0.3, '{operation="search"}');
  for (const variables of [
    { test_run_id: 'base|candidate', selection: ['base', 'candidate'] },
    { test_run_id: '.*', selection: ['$__all'] }, { test_run_id: 'smoke' }
  ]) {
    expect(query(correlation, 30, variables), null);
    expect(query(correlation, 30, variables, 'B'), null);
    expect(query(correlation, 31, variables), null);
  }

  expect(query(dependency, 5, { route: '/api/search', mode: 'search' }), 0.4);
  expect(query(endpoint, 7, { route: '/api/search' }), 0.2, '{route="/api/search"}');
  expect(query(endpoint, 8, { mode: 'fast' }), 0.5, '{mode="fast"}');
  expect(query(correlation, 20, { mode: 'fast' }), 0.4, '{mode="fast"}');
  expect(query(system, 3), 0);
  expect(query(endpoint, 3, { route: '/api/search' }), 0, '{route="/api/search"}');
  expect(query(endpoint, 3, { route: '/idle' }), null);
  expect(query(endpoint, 3, { route: '/missing' }), null);

  const fixture = { fuzzy_compare: true, tests: [{ interval: '30s', input_series: inputs, promql_expr_test: checks }] };
  execFileSync('docker', ['compose', 'exec', '-T', 'prometheus', 'promtool', 'test', 'rules', '/dev/stdin'],
    { input: JSON.stringify(fixture), stdio: ['pipe', 'inherit', 'inherit'] });
});
