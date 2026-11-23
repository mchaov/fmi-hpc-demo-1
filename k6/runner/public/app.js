const el = id => document.getElementById(id);
let catalog = [];
let run = null;
let planReady = false;
let posting = false;
let planVersion = 0;
let statusVersion = 0;
let previewTimer;
let frameUrl = '';
let initialized = false;

async function api(path, data) {
  const response = await fetch(path, data === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'The request failed.');
  return result;
}

function message(id, text = '') {
  el(id).textContent = text;
  el(id).hidden = !text;
}

function clock(ms) {
  if (ms === null) return '—';
  const seconds = Math.floor(ms / 1000);
  return Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's';
}

function busy() { return run && run.status !== 'finished'; }

function controls() {
  el('configuration').hidden = Boolean(busy());
  el('scenario').disabled = !catalog.length || posting || busy();
  for (const field of el('settings').querySelectorAll('input,select')) field.disabled = posting || busy();
  el('start').hidden = Boolean(busy());
  el('start').disabled = !planReady || posting || !el('connection').hidden || busy();
  el('stop').hidden = !busy();
  el('stop').disabled = posting || ['stopping', 'finishing'].includes(run?.status);
}

function fieldValues() {
  return Object.fromEntries([...el('settings').querySelectorAll('input,select')].map(node => [node.name, node.value]));
}

function showPlan(plan) {
  const executors = { 'shared-iterations': 'Shared iterations', 'constant-vus': 'Constant VUs', 'ramping-vus': 'Ramping VUs' };
  el('executor').textContent = plan ? executors[plan.executor] || plan.executor : '—';
  el('maximum').textContent = plan?.maxVUs ?? '—';
  el('workload').textContent = !plan ? '—' : plan.iterations !== null ? plan.iterations + ' iterations' : clock(plan.workloadMs);
  const rules = plan?.thresholds.length ? plan.thresholds : plan ? ['Observational run'] : [];
  el('thresholds').replaceChildren(...rules.map(rule => {
    const li = document.createElement('li');
    li.textContent = rule;
    return li;
  }));
  planReady = Boolean(plan);
  controls();
}

function preview(delay = 0) {
  const version = ++planVersion;
  clearTimeout(previewTimer);
  message('error');
  showPlan(null);
  previewTimer = setTimeout(async () => {
    try {
      const plan = await api('/api/plan/' + el('scenario').value + '?' + new URLSearchParams(fieldValues()));
      if (planVersion === version) showPlan(plan);
    } catch (err) { if (planVersion === version) message('error', err.message); }
  }, delay);
}

function choose(id, values = {}) {
  const scenario = catalog.find(item => item.id === id);
  el('scenario').value = id;
  el('description').textContent = scenario.description;
  el('settings').replaceChildren(...(scenario.fields ?? []).map(field => {
    const label = document.createElement('label');
    label.textContent = field.label;
    const input = document.createElement(field.choices ? 'select' : 'input');
    input.name = field.key;
    if (field.choices) for (const choice of field.choices) input.add(new Option(choice, choice));
    else if (field.max) { input.type = 'number'; input.min = 1; input.max = field.max; }
    input.value = values[field.key] ?? field.value;
    input.required = true;
    input.addEventListener('input', () => preview(200));
    label.append(input);
    return label;
  }));
}

function dashboard(src, note) {
  const box = el('chart-note');
  box.textContent = note;
  box.classList.toggle('empty', !src);
  if (src === frameUrl) return;
  frameUrl = src;
  el('viewer').replaceChildren();
  if (src) {
    const frame = document.createElement('iframe');
    frame.title = 'Native k6 dashboard';
    frame.src = src;
    el('viewer').append(frame);
  }
}

function showRun(next) {
  const changed = run?.id !== next?.id;
  if (changed || !initialized) {
    ++planVersion;
    clearTimeout(previewTimer);
    choose(next?.scenario || 'smoke', next?.settings);
    if (next) { showPlan(next.plan); message('error'); }
    else preview();
    el('details').open = !next;
  }
  run = next;
  const grafana = new URL('/d/load-test-correlation/load-test-correlation', location.href);
  grafana.port = '3000';
  if (run) {
    grafana.searchParams.set('var-test_run_id', run.id);
    grafana.searchParams.set('from', run.launchedAt - 60000);
    grafana.searchParams.set('to', run.finishedAt ? run.finishedAt + 10000 : 'now');
  }
  el('grafana').href = grafana.href;
  const labels = { starting: 'Starting', running: 'Running', finishing: 'Finishing', verifying: 'Verifying ingestion', stopping: 'Stopping' };
  const label = run?.outcome || labels[run?.status] || 'Idle';
  el('status').textContent = label;
  el('status').dataset.tone = busy() ? 'live' : label.toLowerCase();
  el('progress').hidden = !run;
  el('result').hidden = !run || run.status !== 'finished';
  controls();
  if (!run) {
    dashboard('', 'Start a test to see live k6 charts.');
    return;
  }
  const name = catalog.find(item => item.id === run.scenario).name;
  el('run-heading').textContent = name + (busy() ? ' in progress' : ' result');
  el('run-id').textContent = run.id;
  el('phase').textContent = run.status === 'running' ? run.phase : run.status === 'finished' ? label : labels[run.status];
  if (run.status === 'running' && run.stage) {
    el('phase').textContent += ` · ${run.stage}/${run.plan.stages.length} to ${run.target} VUs`;
  }
  el('elapsed').textContent = run.status === 'starting' ? '—' :
    run.status === 'finished' && run.elapsedMs < 1000 ? run.elapsedMs + ' ms' : clock(run.elapsedMs);
  el('vus').textContent = run.vus ?? '—';
  const iterations = run.plan.iterations;
  el('remaining-label').textContent = iterations !== null ? 'Iterations' : 'Est. remaining';
  el('remaining').textContent = iterations !== null ? run.iterations + ' / ' + iterations :
    run.status === 'running' ? clock(run.remainingMs) : '—';
  const bar = el('bar');
  bar.max = iterations ?? run.plan.workloadMs ?? 1;
  bar.value = iterations !== null ? run.iterations : run.elapsedMs;
  el('summary').textContent = run.summary || 'k6 produced no lecture summary.';
  el('diagnostic').hidden = !run.diagnostic;
  el('messages').textContent = run.diagnostic;
  if (run.reportReady) {
    dashboard('/api/runs/' + run.id + '/report', 'Final report from the test runner.');
  } else if (run.dashboardReady) {
    dashboard('/ui/?endpoint=' + encodeURIComponent('/live/' + run.id + '/'), 'k6 groups client measurements into short intervals. Compare them with the rolling service metrics in Grafana.');
  } else {
    dashboard('', busy() ? 'Waiting for k6…' : 'k6 did not produce an HTML report for this run.');
  }
}

el('scenario').addEventListener('change', () => {
  choose(el('scenario').value);
  el('details').open = true;
  preview();
});

async function command(path, args) {
  ++statusVersion;
  posting = true;
  message('error');
  controls();
  try { showRun(await api(path, args)); }
  catch (err) { message('error', err.message); }
  finally { posting = false; controls(); }
}

el('configuration').addEventListener('submit', event => {
  event.preventDefault();
  if (!el('start').disabled) void command('/api/runs', { scenario: el('scenario').value, settings: fieldValues() });
});
el('stop').addEventListener('click', () => {
  if (run) void command('/api/runs/' + run.id + '/stop', {});
});

async function refresh() {
  const version = statusVersion;
  try {
    if (!catalog.length) {
      catalog = await api('/api/scenarios');
      for (const scenario of catalog) el('scenario').add(new Option(scenario.name, scenario.id));
    }
    if (!posting) {
      const next = await api('/api/run');
      if (!posting && version === statusVersion) {
        message('connection');
        showRun(next);
        initialized = true;
      }
    }
  } catch {
    message('connection', 'Connection lost. Reconnecting to the runner…');
    controls();
  } finally { setTimeout(refresh, 800); }
}
void refresh();
