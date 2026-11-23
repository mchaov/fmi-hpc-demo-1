import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { durationMs } from '../breakpoint-stages.js';

const exec = promisify(execFile);
const scripts = fileURLToPath(new URL('../', import.meta.url));
const control = 'http://127.0.0.1:6565/v1';
export const nativeDashboard = 'http://127.0.0.1:5665';

export const scenarios = [
  { id: 'smoke', name: 'Smoke', description: 'Smoke checks API health and the fast report path.' },
  { id: 'baseline', name: 'Baseline', description: 'Measure the representative workload under steady load.' },
  { id: 'degraded', name: 'Degraded', description: 'Measure the workload with slow and failing dependency calls.' },
  { id: 'isolation', name: 'Isolation', description: 'Measure a single operation in isolation.', fields: [
    { key: 'TARGET_OPERATION', label: 'Operation', choices: ['fast', 'search', 'dependency'], value: 'fast' }
  ] },
  { id: 'spike', name: 'Spike', description: 'Watch repeated bursts of traffic and the recovery between them.' },
  { id: 'stress', name: 'Stress', description: 'Observe saturation as the load ramps up in steps.' },
  { id: 'stress-500', name: 'Stress 500', description: 'Run the extended instructor ramp up to 500 virtual users.' },
  { id: 'soak', name: 'Soak', description: 'Watch sustained traffic for changes in latency and stability.', fields: [
    { key: 'SOAK_DURATION', label: 'Workload duration', value: '20m' }
  ] },
  { id: 'breakpoint', name: 'Breakpoint', description: 'Find the last passing stage before a threshold is breached.', fields: [
    { key: 'BREAKPOINT_STEP_DURATION', label: 'Step duration', value: '90s' },
    { key: 'BREAKPOINT_MAX_VUS', label: 'Maximum VUs', value: '120', max: 500 }
  ] }
];

export function problem(status, message) {
  return Object.assign(new Error(message), { status });
}

export function validatedSettings(id, input = {}) {
  const scenario = scenarios.find(item => item.id === id);
  if (!scenario) throw problem(400, 'Choose a listed scenario.');
  const fields = scenario.fields ?? [];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !fields.some(field => field.key === key))) {
    throw problem(400, 'The settings do not match this scenario.');
  }
  const settings = {};
  for (const field of fields) {
    const value = input[field.key] ?? field.value;
    if (typeof value !== 'string' || !value.trim() || value.length > 64) {
      throw problem(400, `Enter a value for ${field.label}.`);
    }
    const trimmed = value.trim();
    if (field.choices) {
      if (!field.choices.includes(trimmed)) throw problem(400, 'Choose a listed operation.');
    } else if (field.max) {
      if (!/^[1-9]\d*$/.test(trimmed) || Number(trimmed) > field.max) {
        throw problem(400, `Enter a whole number from 1 to ${field.max} for ${field.label}.`);
      }
    } else {
      try {
        if (!(durationMs(trimmed) > 0)) throw new Error();
      } catch {
        throw problem(400, `Enter a positive k6 duration for ${field.label}, such as 30s or 2m.`);
      }
    }
    settings[field.key] = trimmed;
  }
  return settings;
}

function envFlags(settings) {
  return Object.entries(settings).flatMap(([key, value]) => ['-e', `${key}=${value}`]);
}

export async function inspectPlan(id, settings) {
  const path = join(scripts, id + '.js');
  let stdout;
  try {
    ({ stdout } = await exec('k6', ['inspect', '--execution-requirements', ...envFlags(settings), path],
      { timeout: 10000, maxBuffer: 1024 * 1024 }));
  } catch (err) {
    if (err.code === 'ENOENT') throw err;
    throw problem(400, (err.stderr || 'k6 could not inspect these settings.').trim().slice(-1000));
  }
  const options = JSON.parse(stdout);
  const scenario = options.scenarios[id];
  const stages = (scenario.stages ?? []).map(stage => ({
    durationMs: durationMs(stage.duration), target: stage.target
  }));
  const workloadMs = stages.length ? stages.reduce((sum, stage) => sum + stage.durationMs, 0)
    : scenario.duration ? durationMs(scenario.duration) : null;
  const thresholds = Object.entries(options.thresholds ?? {}).flatMap(([metric, rules]) =>
    rules.map(rule => {
      if (typeof rule === 'string') return metric + '  ' + rule;
      const abort = rule.abortOnFail ? ' (abort on failure after ' + (rule.delayAbortEval || '0s') + ')' : '';
      return metric + '  ' + rule.threshold + abort;
    }));
  return { executor: scenario.executor, startVUs: scenario.startVUs ?? 1, maxVUs: options.maxVUs,
    iterations: scenario.iterations ?? null, workloadMs, stages, thresholds };
}

// A planned stage describes the target. Actual VUs come from k6's execution status.
export function progress(plan, elapsedMs) {
  const remainingMs = plan.workloadMs === null ? null : Math.max(0, plan.workloadMs - elapsedMs);
  if (plan.iterations !== null) return { phase: 'Iterations', remainingMs };
  if (remainingMs === 0) return { phase: 'Finishing', remainingMs };
  let end = 0;
  let previous = plan.startVUs;
  for (const [i, stage] of plan.stages.entries()) {
    end += stage.durationMs;
    if (elapsedMs < end) {
      const phase = stage.target > previous ? 'Ramp up' : stage.target < previous ? 'Ramp down' : 'Steady load';
      return { phase, stage: i + 1, target: stage.target, remainingMs };
    }
    previous = stage.target;
  }
  return { phase: 'Steady load', target: plan.maxVUs, remainingMs };
}

function signalGroup(child, signal) {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch (err) { if (err.code !== 'ESRCH') throw err; }
}

export class TestRunner extends EventEmitter {
  current = null;
  reserved = false;
  closing = false;

  snapshot() {
    const run = this.current;
    if (!run) return null;
    const elapsedMs = run.durationMs ?? (run.startedAt ? Math.max(0, (run.workloadEnd ?? Date.now()) - run.startedAt) : 0);
    const timing = progress(run.plan, elapsedMs);
    return {
      id: run.id, scenario: run.scenario, settings: run.settings, plan: run.plan,
      status: run.status, outcome: run.outcome, elapsedMs, ...timing,
      launchedAt: run.launchedAt, finishedAt: run.finishedAt, vus: run.vus, iterations: run.iterations,
      dashboardReady: run.dashboardReady, reportReady: run.reportReady, summary: run.stdout.trim(),
      diagnostic: run.status === 'finished' ? run.stderr.trim() : ''
    };
  }

  async start(id, input) {
    if (this.closing) throw problem(503, 'The runner is shutting down.');
    if (this.reserved || this.current?.child) throw problem(409, 'A test is already starting or running.');
    const settings = validatedSettings(id, input);
    this.reserved = true;
    try {
      const plan = await inspectPlan(id, settings);
      const previous = this.current;
      if (previous) await rm(previous.reportFile, { force: true });
      if (this.closing) throw problem(503, 'The runner is shutting down.');
      const runId = id + '-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
      const run = {
        id: runId, scenario: id, settings, plan, status: 'starting', outcome: null,
        launchedAt: Date.now(), startedAt: null, workloadEnd: null, finishedAt: null, durationMs: null,
        vus: null, iterations: 0, dashboardReady: false, reportReady: false, stdout: '', stderr: '',
        reportFile: join(tmpdir(), runId + '.html'), metricsFile: join(tmpdir(), runId + '.json')
      };
      const args = [join(scripts, 'run.sh'), 'run', '--quiet', '--no-color', '--address=127.0.0.1:6565',
        '--out', process.env.K6_OUT || 'experimental-prometheus-rw',
        '--out', 'web-dashboard=host=127.0.0.1&port=5665&period=2s&export=' + run.reportFile,
        '--summary-export', run.metricsFile, ...envFlags({ ...settings, TEST_RUN_ID: runId }), join(scripts, id + '.js')];
      run.child = spawn('/bin/sh', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      this.current = run;
      run.child.stdout.on('data', chunk => {
        run.stdout = (run.stdout + chunk).slice(-65536);
        if (id === 'smoke' && run.stdout.includes('HTTP result: PASS') && !run.stopRequested) {
          run.status = 'verifying';
          this.endWorkload(run);
        }
      });
      run.child.stderr.on('data', chunk => { run.stderr = (run.stderr + chunk).slice(-8192); });
      run.child.on('error', err => { run.stderr += '\n' + err.message; });
      run.done = new Promise(resolve => {
        run.child.once('close', (code, signal) => this.finish(run, code, signal).finally(resolve));
      });
      void this.monitor(run);
      return this.snapshot();
    } finally { this.reserved = false; }
  }

  endWorkload(run) {
    run.workloadEnd ??= Date.now();
    run.dashboardReady = false;
    if (run.status === 'running' || run.status === 'starting') run.status = 'finishing';
    this.emit('closeDashboard', run.id);
  }

  async monitor(run) {
    try {
      const response = await fetch(control + '/status', { signal: AbortSignal.timeout(900) });
      if (!response.ok) return;
      const { data: { attributes } } = await response.json();
      if (run.workloadEnd || run.stopRequested) return;
      run.vus = attributes.vus;
      if (attributes.execution_result !== null && attributes.execution_result !== undefined) {
        this.endWorkload(run);
      } else if (attributes.running) {
        run.startedAt ??= Date.now();
        run.status = 'running';
        if (!run.dashboardReady) {
          const ui = await fetch(nativeDashboard + '/ui/', { method: 'HEAD', signal: AbortSignal.timeout(900) });
          run.dashboardReady = ui.ok && !run.workloadEnd && !run.stopRequested;
        }
        if (run.plan.iterations !== null) {
          const metric = await fetch(control + '/metrics/iterations', { signal: AbortSignal.timeout(900) });
          if (metric.ok) run.iterations = (await metric.json()).data.attributes.sample.count;
        }
      }
    } catch {
      // The private endpoints exist only while the primary k6 process is alive.
    } finally {
      if (run.child && !run.workloadEnd && !run.stopRequested) {
        run.timer = setTimeout(() => void this.monitor(run), 400);
      }
    }
  }

  async finish(run, code, signal) {
    clearTimeout(run.timer);
    clearTimeout(run.killTimer);
    this.endWorkload(run);
    run.vus = 0;
    try {
      const { metrics } = JSON.parse(await readFile(run.metricsFile, 'utf8'));
      if (metrics.iterations) {
        const { count, rate } = metrics.iterations;
        run.iterations = count;
        // k6's whole-run iteration rate uses its measured execution duration.
        if (rate > 0) run.durationMs = Math.round(1000 * count / rate);
      }
    } catch (err) { if (err.code !== 'ENOENT') run.stderr += '\n' + err.message; }
    try {
      await rm(run.metricsFile, { force: true });
      run.reportReady = (await stat(run.reportFile)).size > 0;
    } catch (err) { if (err.code !== 'ENOENT') run.stderr += '\n' + err.message; }
    const smokeFailure = run.stderr.match(/^Smoke result: FAIL[^\r\n]*/m);
    if (smokeFailure) run.stdout = run.stdout.trimEnd() + '\n' + smokeFailure[0] + '\n';
    run.outcome = run.stopRequested ? 'STOPPED' : code !== 0 ? 'FAIL'
      : run.stdout.includes('Result: OBSERVE') ? 'OBSERVE' : 'PASS';
    if (signal) run.stderr += '\nk6 exited on ' + signal;
    run.finishedAt = Date.now();
    run.status = 'finished';
    run.child = null;
  }

  stop(id) {
    const run = this.current;
    if (!run || run.id !== id) throw problem(404, 'This run is no longer current.');
    if (!run.child || run.stopRequested || run.child.exitCode !== null || run.child.signalCode !== null) {
      return this.snapshot();
    }
    run.stopRequested = true;
    run.status = 'stopping';
    this.endWorkload(run);
    signalGroup(run.child, 'SIGTERM');
    run.killTimer = setTimeout(() => signalGroup(run.child, 'SIGKILL'), 4000);
    return this.snapshot();
  }

  async shutdown() {
    this.closing = true;
    if (this.current?.child) {
      this.stop(this.current.id);
      await this.current.done;
    }
  }
}
