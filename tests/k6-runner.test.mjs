import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { progress, scenarios, validatedSettings } from '../k6/runner/run.mjs';

test('only the course scenarios and their typed settings can be launched', () => {
  assert.equal(scenarios.length, 9);
  assert.deepEqual(validatedSettings('baseline'), {});
  assert.deepEqual(validatedSettings('breakpoint', { BREAKPOINT_STEP_DURATION: '2.5s' }), {
    BREAKPOINT_STEP_DURATION: '2.5s', BREAKPOINT_MAX_VUS: '120'
  });
  assert.deepEqual(validatedSettings('isolation', { TARGET_OPERATION: 'search' }), { TARGET_OPERATION: 'search' });
  for (const [id, settings] of [
    ['verify-smoke', {}], ['baseline', { BASE_URL: 'custom' }], ['smoke', []],
    ['soak', { SOAK_DURATION: '0s' }], ['soak', { SOAK_DURATION: '3s junk' }],
    ['isolation', { TARGET_OPERATION: 'slow' }], ['breakpoint', { BREAKPOINT_MAX_VUS: '1.5' }]
  ]) {
    assert.throws(() => validatedSettings(id, settings), { status: 400 });
  }
});

test('stage boundaries follow targets and iteration-based tests have no countdown', () => {
  const plan = { startVUs: 1, iterations: null, workloadMs: 6000, stages: [
    { durationMs: 2000, target: 10 }, { durationMs: 1000, target: 10 }, { durationMs: 3000, target: 0 }
  ] };
  assert.deepEqual(progress(plan, 0), { phase: 'Ramp up', stage: 1, target: 10, remainingMs: 6000 });
  assert.equal(progress(plan, 2000).phase, 'Steady load');
  assert.deepEqual(progress(plan, 3000), { phase: 'Ramp down', stage: 3, target: 0, remainingMs: 3000 });
  assert.equal(progress(plan, 6200).phase, 'Finishing');
  assert.deepEqual(progress({ iterations: 5, workloadMs: null }, 42), { phase: 'Iterations', remainingMs: null });
});

test('real k6 runs release native viewers and use the final wrapper outcome', () => {
  // Exercise a private runner with loopback fixture services, independent of the instructor's active run.
  const input = readFileSync(new URL('./fixtures/k6-runner.mjs', import.meta.url));
  execFileSync('docker', ['compose', 'run', '--rm', '--no-deps', '-T', 'k6-runner', 'node', '--input-type=module', '-'],
    { input, timeout: 90000, stdio: ['pipe', 'inherit', 'inherit'] });
});
