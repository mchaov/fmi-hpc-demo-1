# University HPC Performance Demo

Docker-based local teaching lab for:

- performance engineering
- observability with metrics, logs, and traces
- repeatable load testing
- cross-service root-cause analysis

Detailed repository documentation, configuration, and tool interconnections live in [`manual.md`](./manual.md). This `README.md` is the quick setup guide.

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

- API health: `http://localhost:8080/health`
- API metrics: `http://localhost:8080/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

Grafana is configured for anonymous access for classroom use.

## Quick Validation

Run the smoke scenario:

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

Then use:

- `Endpoint Comparison` for route and mode comparisons
- `Dependency Health` for downstream behavior
- Grafana logs and traces for drilldown

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

Use [`manual.md`](./manual.md) as the source of truth for:

- repository structure
- service responsibilities
- observability configuration
- container build design
- dashboard provisioning
- how metrics, logs, traces, and load tests are interconnected
- scenario behavior and teaching flow
