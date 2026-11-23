'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const { before, after, test } = require('node:test');

let api;
let upstream;
let interruptResponse = true;

before(async () => {
  upstream = http.createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.write('{', () => {
      if (interruptResponse) response.destroy();
    });
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  process.env.DEPENDENCY_URL = `http://127.0.0.1:${upstream.address().port}`;
  process.env.LOG_LEVEL = 'silent';
  api = require('../src/app').createApp();
});

after(async () => {
  await api.close();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
});

test('report routing and telemetry use the same bounded mode', async () => {
  for (const suffix of ['', '?mode=fast', '?mode=FAST']) {
    const response = await api.inject('/api/report' + suffix);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().mode, 'fast');
  }
  assert.equal((await api.inject('/api/report?mode=other')).statusCode, 400);
  const { body } = await api.inject('/metrics');
  assert.match(body, /http_requests_total\{[^\n]*mode="fast"[^\n]*\} 3\n/);
  assert.match(body, /http_requests_total\{[^\n]*mode="unsupported"[^\n]*\} 1\n/);
});

test('item lookup requires the entire decimal ID', async () => {
  assert.equal((await api.inject('/api/items/12')).json().item.id, 12);
  assert.equal((await api.inject('/api/items/12-no-such-item')).statusCode, 404);
});

test('interrupted and stalled upstream bodies finish and release the in-flight gauge', async () => {
  assert.equal((await api.inject('/api/report?mode=dependency')).statusCode, 502);
  interruptResponse = false;
  assert.equal((await api.inject('/api/report?mode=dependency')).statusCode, 504);
  const { body } = await api.inject('/metrics');
  assert.match(body, /http_requests_in_flight\{[^\n]*route="\/api\/report"[^\n]*\} 0\n/);
  assert.match(body, /dependency_errors_total\{[^\n]*operation="dependency"[^\n]*\} 2\n/);
});
