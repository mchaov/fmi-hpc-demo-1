export const MAX_ERROR_RATE = 0.05;
export const MAX_P95_MS = 1200;

export function durationMs(duration) {
  const units = { h: 3600000, m: 60000, s: 1000, ms: 1, us: 0.001, 'µs': 0.001, ns: 0.000001 };
  if (/^\d+$/.test(duration)) return Number(duration);
  const parts = [...duration.matchAll(/(\d+(?:\.\d+)?|\.\d+)(ms|us|µs|ns|h|m|s)/g)];
  if (!parts.length || parts.map(([text]) => text).join('') !== duration) {
    throw new Error(`Invalid stage duration: ${duration}`);
  }
  return parts.reduce((total, [, value, unit]) => total + Number(value) * units[unit], 0);
}

export function breakpointSummary(data, thresholdsPassed, stages, stepMs, cooldownMs) {
  const elapsed = data.state.testRunDurationMs;
  const rampMs = stages.length * stepMs;
  const finished = elapsed >= rampMs + cooldownMs;
  const phase = elapsed >= rampMs ? 'ramp-down' : `ramp to ${stages[Math.floor(elapsed / stepMs)].target} VUs`;
  const lines = [];
  let lastPassing = null;

  for (const [index, { target }] of stages.entries()) {
    const tag = `{breakpoint_stage:${target}}`;
    const errors = data.metrics[`http_req_failed${tag}`]?.values;
    const p95 = data.metrics[`http_req_duration${tag}`]?.values['p(95)'];
    const count = (errors?.passes || 0) + (errors?.fails || 0);
    if (elapsed < (index + 1) * stepMs || !count || !Number.isFinite(p95)) continue;
    const passed = errors.rate < MAX_ERROR_RATE && p95 < MAX_P95_MS;
    lines.push(`Stage ${target} VUs: ${passed ? 'PASS' : 'FAIL'} (${count} requests, ${(100 * errors.rate).toFixed(2)}% errors, p95 ${p95.toFixed(2)} ms)`);
    if (passed) lastPassing = target;
  }
  return [
    `Breakpoint status: ${!thresholdsPassed ? 'failed' : finished ? 'completed' : 'stopped early'}`,
    `Stop phase: ${phase}`,
    `Last passing stage: ${lastPassing === null ? 'none' : lastPassing + ' VUs'}`,
    ...lines
  ];
}
