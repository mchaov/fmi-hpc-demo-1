# University HPC Performance Demo

Docker-based local demo platform for teaching performance engineering, observability, load testing, and cross-service root-cause analysis.

## Stack

- `demo-api`: Fastify API with Prometheus metrics, JSON logs, and OpenTelemetry traces
- `demo-dependency`: internal Fastify dependency with controllable latency and failures
- `Prometheus`: metrics collection
- `Grafana`: dashboards, logs, and traces UI
- `Loki` + `Promtail`: centralized logs
- `Tempo`: trace backend
- `k6`: on-demand load tests

## Requirements

- Docker Desktop with Compose

## Start The Lab

```powershell
docker compose up --build -d
```

## Stop The Lab

```powershell
docker compose down
```

To remove stored observability data as well:

```powershell
docker compose down -v
```

## URLs

- API health: `http://localhost:8080/health`
- API metrics: `http://localhost:8080/metrics`
- Grafana: `http://localhost:3000`
- Prometheus: `http://localhost:9090`

Grafana runs with anonymous admin access enabled for classroom simplicity.

## Dashboards

- `System Overview`
- `Infrastructure Overview`
- `Load Test Correlation`
- `Endpoint Comparison`
- `Dependency Health`
- `Root Cause Drilldown`

## Load Tests

Run smoke test:

```powershell
docker compose --profile loadtest run --rm k6
```

Run the lecture-aligned scenarios:

```powershell
docker compose --profile loadtest run --rm k6 run /scripts/isolation.js
docker compose --profile loadtest run --rm k6 run /scripts/baseline.js
docker compose --profile loadtest run --rm k6 run /scripts/spike.js
docker compose --profile loadtest run --rm k6 run /scripts/stress.js
docker compose --profile loadtest run --rm k6 run /scripts/stress-500.js
docker compose --profile loadtest run --rm k6 run /scripts/soak.js
docker compose --profile loadtest run --rm k6 run /scripts/breakpoint.js
docker compose --profile loadtest run --rm k6 run /scripts/degraded.js
```

Run isolation against a specific operation:

```powershell
docker compose --profile loadtest run --rm -e TARGET_OPERATION=dependency k6 run /scripts/isolation.js
```

Optional overrides for the lecture scenarios:

```powershell
docker compose --profile loadtest run --rm -e SOAK_DURATION=30m k6 run /scripts/soak.js
docker compose --profile loadtest run --rm -e BREAKPOINT_STEP_DURATION=60s -e BREAKPOINT_MAX_VUS=200 k6 run /scripts/breakpoint.js
```

`stress-500.js` is the advanced profile and is intended for stronger laptops or instructor-led demonstrations, not as the default classroom run.

## Lecture Mapping

| Lecture Type | Script | Scope / Intent | Watch First | Result |
| --- | --- | --- | --- | --- |
| `isolation` | `isolation.js` | Single-path test for one operation (`fast`, `search`, or `dependency`) | endpoint latency | pass/fail |
| `load` | `baseline.js` | Nominal representative mix for the baseline | p95 latency, error rate | pass/fail |
| `load` degraded variant | `degraded.js` | Same teaching flow as load, but with injected dependency slowdown | p95 latency, dependency errors | pass/fail |
| `spike` | `spike.js` | Ten sharp bursts to show repeated tail-latency spikes | request-rate and VU peaks | pass/fail |
| `stress` | `stress.js` | Student-safe stepped ramp to observe degradation | latency growth vs CPU | observational |
| `stress` extended profile | `stress-500.js` | Advanced stepped ramp up to `500` VUs | saturation point and error growth | observational |
| `soak` | `soak.js` | Sustained nominal traffic to inspect drift over time | memory and latency drift | pass/fail |
| `breakpoint` | `breakpoint.js` | Capacity ramp that stops at the first sustained SLO breach | breaking stage and last passing stage | pass/fail with abort |

All request metrics are tagged with `scenario`, `test_type`, `variant`, `run_profile`, `workload_profile`, and `operation` so Grafana can filter by lecture taxonomy instead of only by script name.

`configuration` testing and `internet` testing from the lecture are not implemented in this phase.

## Demo Endpoints

- `GET /health`
- `GET /metrics`
- `GET /api/items/:id`
- `GET /api/search?q=...`
- `GET /api/report?mode=fast|slow|dependency|degraded|error`

Report mode behavior:

- `fast`: immediate response
- `slow`: fixed `150ms` delay
- `dependency`: internal dependency call with `75ms` latency
- `degraded`: internal dependency call with `400ms` latency and `5%` failure rate
- `error`: immediate `503`

## Teaching Flow

1. Start the stack.
2. Run `baseline.js`.
3. Inspect `System Overview`, `Infrastructure Overview`, and `Load Test Correlation` together to compare request rate, latency, active VUs, CPU, memory, disk, and network usage.
4. Run one lecture test type that contrasts with baseline: `spike.js`, `stress.js`, `soak.js`, or `breakpoint.js`.
5. Run `degraded.js` to compare nominal vs degraded `load`.
6. Compare `Endpoint Comparison` and `Dependency Health` against the hardware dashboards to see whether the bottleneck is resource saturation or an application-level dependency slowdown.
7. Use Grafana logs and trace links to move from symptoms to root cause.

## Notes

- `Tempo` is intentionally pinned to `grafana/tempo:2.6.0` in [`docker-compose.yml`](/G:/codex-projects/university-hpc/docker-compose.yml) to keep the local monolithic trace backend stable for this demo.
- Loki logs include `trace_id`, and the provisioned Grafana Loki data source links matching log lines directly into Tempo traces.
- The hardware dashboards show the Docker runtime environment used by Docker Desktop on the laptop, not the native host operating system outside Docker.
- `k6` exports its run metrics into the same Prometheus instance, so Grafana can correlate VUs, request rate, and latency with host and container utilization during each scenario.
