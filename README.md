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
- `Endpoint Comparison`
- `Dependency Health`
- `Root Cause Drilldown`

## Load Tests

Run smoke test:

```powershell
docker compose --profile loadtest run --rm k6
```

Run the other bundled scenarios:

```powershell
docker compose --profile loadtest run --rm k6 run /scripts/baseline.js
docker compose --profile loadtest run --rm k6 run /scripts/spike.js
docker compose --profile loadtest run --rm k6 run /scripts/stress.js
docker compose --profile loadtest run --rm k6 run /scripts/degraded.js
```

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
3. Inspect the `System Overview`, `Endpoint Comparison`, and `Dependency Health` dashboards.
4. Run `degraded.js`.
5. Use Grafana logs and trace links to move from symptoms to root cause.

## Notes

- `Tempo` is intentionally pinned to `grafana/tempo:2.6.0` in [`docker-compose.yml`](/G:/codex-projects/university-hpc/docker-compose.yml) to keep the local monolithic trace backend stable for this demo.
- Loki logs include `trace_id`, and the provisioned Grafana Loki data source links matching log lines directly into Tempo traces.
