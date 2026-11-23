import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

let ingested = true;
let httpStatus = 200;
const fixture = http.createServer((req, res) => {
  req.resume();
  if (req.url.startsWith('/query?')) {
    res.end(JSON.stringify({ status: 'success', data: { result: ingested ? [{ value: [0, '10'] }] : [] } }));
  } else if (req.url === '/write') {
    res.writeHead(204).end();
  } else {
    res.writeHead(httpStatus, { 'Content-Type': 'application/json' }).end('{}');
  }
});
fixture.listen(0, '127.0.0.1');
await once(fixture, 'listening');
const target = 'http://127.0.0.1:' + fixture.address().port;
const child = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit', env: {
  ...process.env, BASE_URL: target, K6_PROMETHEUS_RW_SERVER_URL: target + '/write', PROMETHEUS_QUERY_URL: target + '/query'
} });
const exited = once(child, 'exit');
const origin = 'http://127.0.0.1:8080';
const get = async path => (await fetch(origin + path)).json();
const post = (path, data) => fetch(origin + path, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
});
async function until(check, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for the runner');
}
async function start(scenario, settings) {
  const response = await post('/api/runs', { scenario, settings });
  const data = await response.json();
  assert.equal(response.status, 202, JSON.stringify(data));
  return data;
}
const state = predicate => until(async () => {
  const run = await get('/api/run');
  return predicate(run) && run;
});
const finished = () => state(run => run.status === 'finished');

try {
  await until(() => fetch(origin + '/api/scenarios').then(res => res.ok, () => false), 5000);
  const plan = await get('/api/plan/breakpoint?BREAKPOINT_STEP_DURATION=3s&BREAKPOINT_MAX_VUS=25');
  assert.deepEqual(plan.stages.map(s => s.target), [20, 25, 0]);
  assert.equal(plan.workloadMs, 36000);

  const soak = await start('soak', { SOAK_DURATION: '8s' });
  assert.equal((await post('/api/runs', { scenario: 'smoke' })).status, 409);
  await state(run => run.dashboardReady);
  const eventsPath = origin + '/live/' + soak.id + '/events';
  const viewers = await Promise.all([fetch(eventsPath), fetch(eventsPath)]);
  const completed = await finished();
  assert.equal(completed.outcome, 'PASS', completed.diagnostic);
  assert.ok(completed.reportReady);
  for (const viewer of viewers) assert.match(await viewer.text(), /event: snapshot/);
  assert.equal((await fetch(eventsPath)).status, 204);
  assert.equal((await fetch(origin + '/api/runs/' + soak.id + '/report')).status, 200);

  await start('smoke');
  const smoke = await finished();
  assert.equal(smoke.iterations, 5);
  assert.match(smoke.summary, /Requests: 10\b/);
  assert.match(smoke.summary, /Smoke result: PASS/);
  assert.equal(smoke.reportReady, false);
  assert.equal((await fetch(origin + '/api/runs/' + soak.id + '/report')).status, 404);

  ingested = false;
  await start('smoke');
  await state(run => run.status === 'verifying');
  const failedReadback = await finished();
  assert.equal(failedReadback.outcome, 'FAIL');
  assert.match(failedReadback.summary, /HTTP result: PASS/);
  assert.match(failedReadback.summary, /Smoke result: FAIL \(Prometheus ingestion\)/);

  httpStatus = 503;
  await start('smoke');
  const failedHttp = await finished();
  assert.equal(failedHttp.outcome, 'FAIL');
  assert.match(failedHttp.summary, /HTTP result: FAIL/);
  httpStatus = 200;

  const active = await start('stress');
  await state(run => run.status === 'running');
  assert.equal((await post('/api/runs/' + soak.id + '/stop', {})).status, 404);
  assert.equal((await post('/api/runs/' + active.id + '/stop', {})).status, 202);
  assert.equal((await finished()).outcome, 'STOPPED');

  await start('baseline');
  await state(run => run.status === 'running');
  child.kill('SIGTERM');
  await exited;
  await assert.rejects(fetch('http://127.0.0.1:6565/v1/status'));
} finally {
  child.kill('SIGTERM');
  await exited;
  fixture.close();
  fixture.closeAllConnections();
}
