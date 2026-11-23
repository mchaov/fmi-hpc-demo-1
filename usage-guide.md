# Usage Guide

`usage-guide.md` is the detailed how-to-use guide for running the lab, validating it, and using the dashboards during a lesson.

## Prerequisites

- Docker Desktop or a compatible Docker Engine + Compose setup

## Start Everything

```bash
docker compose up --build -d
```

This builds local images and starts the main lab stack.

After updating the load-test scripts in an existing checkout, rebuild their on-demand image with `docker compose --profile loadtest build k6`.

## Check The Stack

Useful checks:

```bash
docker compose ps
curl http://localhost:8080/health
curl http://localhost:8080/metrics
curl http://localhost:9090/-/healthy
curl http://localhost:3000/api/health
```

## Open The UIs

- API health: `http://localhost:8080/health`
- API metrics: `http://localhost:8080/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

Grafana dashboards are under the `HPC Demo` folder. Anyone who can reach the published Grafana port has anonymous organization-admin access, including dashboard editing.

## Run The Smoke Test

```bash
docker compose --profile loadtest run --rm k6
```

This validates:

- API reachability
- fast-path request handling
- Prometheus remote-write from `k6`
- the basic summary and threshold flow

The final `Smoke result` includes a Prometheus readback after k6 flushes its metrics. It waits up to 15 seconds for a request sample unique to this invocation, even when you reuse a test run ID.

## Run The Teaching Scenarios

```bash
docker compose --profile loadtest run --rm k6 run /scripts/baseline.js
docker compose --profile loadtest run --rm k6 run /scripts/degraded.js
docker compose --profile loadtest run --rm k6 run /scripts/isolation.js
docker compose --profile loadtest run --rm k6 run /scripts/spike.js
docker compose --profile loadtest run --rm k6 run /scripts/stress.js
docker compose --profile loadtest run --rm k6 run /scripts/stress-500.js
docker compose --profile loadtest run --rm k6 run /scripts/soak.js
docker compose --profile loadtest run --rm k6 run /scripts/breakpoint.js
```

## Common Scenario Overrides

Isolation target:

```bash
docker compose --profile loadtest run --rm -e TARGET_OPERATION=dependency k6 run /scripts/isolation.js
```

Longer soak:

```bash
docker compose --profile loadtest run --rm -e SOAK_DURATION=30m k6 run /scripts/soak.js
```

Custom breakpoint ramp:

```bash
docker compose --profile loadtest run --rm -e BREAKPOINT_STEP_DURATION=60s -e BREAKPOINT_MAX_VUS=200 k6 run /scripts/breakpoint.js
```

The breakpoint summary lists completed stages with observed requests, error rate, and p95 latency. The last passing stage meets both limits. The stop phase identifies the ramp or ramp-down in progress at the end of the run.

Explicit run id:

```bash
docker compose --profile loadtest run --rm -e TEST_RUN_ID=baseline-demo-01 k6 run /scripts/baseline.js
```

## Recommended Dashboard Flow

After running `baseline.js`, open:

- `System Overview`
- `Infrastructure Overview`
- `Load Test Correlation`

In `Load Test Correlation`, start with the `Workload Mix` row:

- compare `k6 Request Share By Operation` with `API Request Share By Route` and `API Request Share By Mode`
- use `Target vs Actual Share By Operation` and `Workload Mix Drift By Operation` to spot execution drift quickly

Then use:

- `Run Comparison` to compare two selected `test_run_id` values directly
- `Endpoint Comparison` for side-by-side route and `/api/report` mode behavior
- `Dependency Health` for dependency share, latency, error overlays, and outcome split
- Grafana logs and traces for drilldown, filtering by `test_run_id` when you need to isolate one run

## Suggested Usage Flow During A Lesson

1. Start the stack and verify health.
2. Run `smoke.js` as a quick preflight.
3. Run `baseline.js`.
4. Open `System Overview`, `Infrastructure Overview`, and `Load Test Correlation`.
5. In `Load Test Correlation`, start at the `Workload Mix` row and compare intended share, actual share, and drift.
6. Use `Run Comparison` when you want to compare repeated runs such as `baseline A` versus `baseline B`.
7. Use `Endpoint Comparison` to compare route shape with `/api/report` mode shape.
8. Use `Dependency Health` to decide whether the system is dependency-heavy or dependency-impaired.
9. Run a contrasting scenario such as `spike.js`, `stress.js`, `soak.js`, or `breakpoint.js`.
10. Run `degraded.js`.
11. Repeat the route/mode and dependency comparison on the degraded run.
12. Use Loki and Tempo from Grafana to move from symptoms to individual requests and traces, filtering by `test_run_id` when you need to isolate one run.

## Stop And Reset

Stop the stack:

```bash
docker compose down
```

Stop and delete persisted observability data:

```bash
docker compose down -v
```
