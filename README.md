# Observability Demo

Docker-based local teaching lab for:

- performance engineering
- observability with metrics, logs, and traces
- repeatable load testing
- cross-service root-cause analysis

Detailed repository documentation lives in:

- [`repository-guide.md`](./repository-guide.md) for repository structure, configuration, and teaching design
- [`usage-guide.md`](./usage-guide.md) for the detailed how-to-use workflow

This `README.md` is the quick setup guide.

## Prerequisites

- Docker Desktop or Docker Engine with Compose support
- Enough local resources to run several containers at once
  - practical minimum: `8 GB` RAM
  - more headroom is helpful for `stress-500.js`
- Internet access for the first image build and pull

## Quick Setup

Start the lab:

```bash
docker compose up --build -d
```

Check that the core services are healthy:

```bash
docker compose ps
curl http://localhost:8080/health
curl http://localhost:9090/-/healthy
curl http://localhost:3000/api/health
```

Open the main interfaces:

- [Test runner](http://localhost:5665) to start a scenario and watch k6
- [Grafana](http://localhost:3000) to explore metrics, logs, and traces
- API health: `http://localhost:8080/health`
- API metrics: `http://localhost:8080/metrics`
- Prometheus: `http://localhost:9090`

Grafana is configured for anonymous access for classroom use.

## Quick Validation

In the test runner, leave **Smoke** selected and choose **Start test**. Five iterations make ten HTTP requests. The final **PASS** includes a Prometheus ingestion check.

Next, start **Baseline** and choose **Open in Grafana**. The runner shows live k6 charts and the lecture summary. The second tab opens **Load Test Correlation** with this run selected.

For a terminal smoke test, use the existing CLI:

```bash
docker compose --profile loadtest run --rm k6
```

This validates:

- API reachability
- `k6` execution
- Prometheus remote-write ingestion
- the basic performance threshold path

## Common Usage

Run the representative baseline:

```bash
docker compose --profile loadtest run --rm k6 run /scripts/baseline.js
```

Run the same scenario with an explicit run identifier:

```bash
docker compose --profile loadtest run --rm -e TEST_RUN_ID=baseline-demo-01 k6 run /scripts/baseline.js
```

Run the degraded comparison:

```bash
docker compose --profile loadtest run --rm k6 run /scripts/degraded.js
```

Run a single-path isolation test:

```bash
docker compose --profile loadtest run --rm -e TARGET_OPERATION=dependency k6 run /scripts/isolation.js
```

Other included scenarios:

- `/scripts/spike.js`
- `/scripts/stress.js`
- `/scripts/stress-500.js`
- `/scripts/soak.js`
- `/scripts/breakpoint.js`

## Recommended First Dashboard View

After running `baseline.js`, open:

- `System Overview`
- `Infrastructure Overview`
- `Load Test Correlation`

In `Load Test Correlation`, start with the `Workload Mix` row:

- compare `k6 Request Share By Operation` with `Route share of all API requests` and `Mode share of all API requests`
- use `Target vs Actual Share By Operation` and `Workload Mix Drift By Operation` to spot execution drift quickly

Then use:

- `Run Comparison` to compare two selected `test_run_id` values directly
- `Endpoint Comparison` for side-by-side route and `/api/report` mode behavior
- `Dependency Health` for dependency share, latency, error overlays, and outcome split
- Grafana logs and traces for drilldown, filtering by `test_run_id` when you need to isolate one run

## Stop And Reset

Stop the stack:

```bash
docker compose down
```

Stop and remove persisted observability data:

```bash
docker compose down -v
```

## Documentation

Use:

- [`repository-guide.md`](./repository-guide.md) as the source of truth for repository structure, configuration, service responsibilities, observability design, and dashboard provisioning
- [`usage-guide.md`](./usage-guide.md) as the source of truth for running the stack, using the scenarios, and following the teaching flow
