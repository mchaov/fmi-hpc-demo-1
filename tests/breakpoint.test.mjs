import assert from 'node:assert/strict';
import test from 'node:test';
import { breakpointSummary, durationMs } from '../k6/breakpoint-stages.js';

const stages = [{ target: 20 }, { target: 40 }];
function summary(elapsed, passed, observations) {
  const metrics = {};
  for (const [target, errors, p95] of observations) {
    const tag = `{breakpoint_stage:${target}}`;
    metrics[`http_req_failed${tag}`] = { values: { passes: errors, fails: 100 - errors, rate: errors / 100 } };
    metrics[`http_req_duration${tag}`] = { values: { 'p(95)': p95 } };
  }
  return breakpointSummary({ state: { testRunDurationMs: elapsed }, metrics }, passed, stages, 1000, 30000);
}

test('a failed ramp-down credits only stages with passing observations', () => {
  const result = summary(2500, false, [[20, 1, 100], [40, 0, 1500]]);
  assert.ok(result.includes('Last passing stage: 20 VUs'));
  assert.ok(result.includes('Stop phase: ramp-down'));
  assert.ok(result.includes('Breakpoint status: failed'));
  assert.ok(summary(2500, false, [[20, 100, 100], [40, 100, 100]]).includes('Last passing stage: none'));
});

test('partial and empty stages earn no passing result', () => {
  assert.ok(summary(1500, true, [[40, 0, 100]]).includes('Last passing stage: none'));
  assert.ok(summary(32000, true, [[20, 0, 100], [40, 0, 100]]).includes('Last passing stage: 40 VUs'));
  assert.equal(durationMs('1m30.5s'), 90500);
});
