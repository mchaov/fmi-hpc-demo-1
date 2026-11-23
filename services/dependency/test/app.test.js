'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createApp } = require('../src/app');

test('work validates complete values and preserves defaults and probability boundaries', async t => {
  process.env.LOG_LEVEL = 'silent';
  const app = createApp();
  t.after(() => app.close());
  for (const query of ['delayMs=2.9', 'delayMs=2abc', 'failRate=0abc', 'failRate=', 'failRate=1.1']) {
    assert.equal((await app.inject('/work?' + query)).statusCode, 400, query);
  }
  for (const query of ['', '?delayMs=0&failRate=0']) {
    const response = await app.inject('/work' + query);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().delayMs, 0);
  }
  assert.equal((await app.inject('/work?failRate=1')).statusCode, 503);
});
