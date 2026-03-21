# Repository Manual

`manual.md` is the source of truth for the detailed configuration of this repository, how the stack is assembled, and how the different tools and services are interconnected.

## Purpose

This repository contains a self-contained teaching lab for:

- software performance engineering
- observability with metrics, logs, and traces
- repeatable load testing
- root-cause analysis across a small multi-service system

Despite the repository name, the practical focus is not classical MPI/OpenMP-style high performance computing. The lab is centered on performance behavior in a service-based application and on how to observe that behavior with open-source tooling.

## What Is In This Repository

At a high level, the repository contains four things:

1. a demo application stack
2. an observability stack
3. load-test scenarios
4. supporting course and planning material

## Repository Layout

### Root files

- [`README.md`](/media/sf_university-hpc/README.md): short project overview and quick-start commands
- [`manual.md`](/media/sf_university-hpc/manual.md): this detailed manual
- [`docker-compose.yml`](/media/sf_university-hpc/docker-compose.yml): main orchestration file for the entire lab
- [`course-evaluation-and-demo-plan.md`](/media/sf_university-hpc/course-evaluation-and-demo-plan.md): rationale for the teaching lab and scope decisions
- [`development-plan.md`](/media/sf_university-hpc/development-plan.md): dashboard and observability roadmap

### Application services

- [`services/api`](/media/sf_university-hpc/services/api): primary demo API
- [`services/dependency`](/media/sf_university-hpc/services/dependency): downstream helper service used to simulate latency and failures

### Load testing

- [`k6`](/media/sf_university-hpc/k6): `k6` scenarios and shared helpers

### Observability

- [`observability/prometheus`](/media/sf_university-hpc/observability/prometheus): Prometheus configuration and image build
- [`observability/grafana`](/media/sf_university-hpc/observability/grafana): Grafana image build, provisioning, and dashboards
- [`observability/loki`](/media/sf_university-hpc/observability/loki): Loki configuration and image build
- [`observability/promtail`](/media/sf_university-hpc/observability/promtail): Promtail configuration and image build
- [`observability/tempo`](/media/sf_university-hpc/observability/tempo): Tempo configuration and image build

### Course material

- [`course-content`](/media/sf_university-hpc/course-content): lecture PDFs used as the conceptual source material for the lab design

## What The Stack Looks Like

The runtime shape is:

```text
k6 ---> demo-api ---> demo-dependency
 |        |   |             |
 |        |   |             +--> logs -> Promtail -> Loki -> Grafana
 |        |   |
 |        |   +--> traces -> Tempo -> Grafana
 |        |
 |        +--> metrics ----+
 |                         |
 +--> remote write --------+--> Prometheus -> Grafana

cadvisor ------------------+
node-exporter ------------+
```

## Main Runtime Components

### `demo-api`

The API is a Fastify service running on port `8080`.

It exposes:

- `GET /health`
- `GET /metrics`
- `GET /api/items/:id`
- `GET /api/search?q=...`
- `GET /api/report?mode=fast|slow|dependency|degraded|error`

Its purpose is to provide deliberately different execution paths:

- `fast`: immediate response
- `slow`: fixed delay
- `dependency`: calls the downstream service with moderate latency
- `degraded`: calls the downstream service with higher latency and a failure probability
- `error`: immediate application-side error
- `search`: local in-memory filtering with some CPU work

This gives students multiple observable behaviors without needing a real database or complex business logic.

### `demo-dependency`

The dependency service is another Fastify service, also on port `8080` inside the compose network.

It exposes:

- `GET /health`
- `GET /metrics`
- `GET /work?delayMs=...&failRate=...`

The API uses it to simulate downstream latency and failure propagation. This is the main mechanism behind the `dependency` and `degraded` report modes.

### Prometheus

Prometheus scrapes metrics from:

- `demo-api`
- `demo-dependency`
- `cadvisor`
- `node-exporter`

It also accepts remote-write traffic from `k6`, which is how load-test metrics appear in the same time series store as service and infrastructure metrics.

### Grafana

Grafana is the main user interface for the lab.

It is provisioned with:

- Prometheus as the default datasource
- Loki for logs
- Tempo for traces
- a folder named `HPC Demo`
- the repository dashboards

Grafana runs with anonymous access enabled to keep classroom usage friction low.

### Loki and Promtail

Promtail discovers Docker containers through the Docker socket and ships container logs to Loki.

The log pipeline:

- parses Docker log envelopes
- extracts JSON fields such as `service`, `level`, `route`, `trace_id`, and `request_id`
- promotes selected fields to Loki labels

This makes it possible to filter logs in Grafana by service, level, route, and then jump from log lines to traces using the `trace_id`.

### Tempo

Tempo stores traces generated by the two Node.js services.

The services export OTLP traces over HTTP to:

- `http://tempo:4318/v1/traces`

Tempo is intentionally kept simple:

- local storage backend
- local WAL
- single-binary mode

It is not published on a host port in the current compose file. It is meant to be reached by Grafana over the internal compose network.

### `cadvisor` and `node-exporter`

These provide host and container resource telemetry:

- `cadvisor`: container-level CPU, memory, filesystem, and runtime metrics
- `node-exporter`: host-level CPU, memory, disk, network, and filesystem metrics

Those metrics are what let the dashboards correlate application symptoms with hardware and container pressure.

### `k6`

`k6` is the load generator.

It is not started by default. It is attached to the `loadtest` profile and is typically run on demand:

```bash
docker compose --profile loadtest run --rm k6
```

The default command runs the smoke scenario. Other scenarios are started explicitly.

## How The Setup Is Created

## Docker Compose As The Top-Level Orchestrator

[`docker-compose.yml`](/media/sf_university-hpc/docker-compose.yml) is the single source of truth for the runtime stack.

It defines:

- which services exist
- which images are built locally
- which services depend on others
- which ports are published to the host
- which persistent volumes hold observability data
- which environment variables configure the services

### Which services are built locally

These services are built from repository source:

- `api`
- `dependency`
- `prometheus`
- `grafana`
- `loki`
- `promtail`
- `tempo`
- `k6`

### Which services use upstream base images

The local Dockerfiles are thin wrappers around upstream images:

- `node:22-alpine` for the Node services
- `prom/prometheus:latest` for Prometheus
- `grafana/grafana-oss:latest` for Grafana
- `grafana/loki:latest` for Loki
- `grafana/promtail:latest` for Promtail
- `grafana/tempo:2.6.0` for Tempo
- `grafana/k6:latest` for `k6`

### Why several configs are baked into images

Prometheus, Loki, Tempo, Promtail, Grafana, and `k6` use custom Dockerfiles that copy configuration and scripts into the images instead of relying on host bind mounts.

That design exists for portability. In this workspace, direct bind mounts from the shared folder produced container-side permission errors for:

- observability config files
- dashboard files
- `k6` scripts

Baking these assets into the images avoids that class of failure.

### Persistent volumes

The compose stack creates named volumes for:

- `grafana-data`
- `loki-data`
- `prometheus-data`
- `tempo-data`

These preserve dashboards, logs, metrics, and traces across restarts unless the stack is stopped with:

```bash
docker compose down -v
```

## How The Services Interconnect

### API to dependency

The API reads `DEPENDENCY_URL` from compose:

- `http://dependency:8080`

When `/api/report` is called with `mode=dependency` or `mode=degraded`, the API calls the dependency service’s `/work` endpoint.

### API and dependency to Tempo

Both services start OpenTelemetry on boot and export traces to:

- `http://tempo:4318/v1/traces`

The API also propagates trace context when making outbound dependency calls, so the dependency span appears under the same request trace.

### Services to Prometheus

Both services expose Prometheus-format metrics on `/metrics`.

Prometheus scrapes them every `5s`.

### `k6` to Prometheus

The `k6` container is configured with:

- `K6_OUT=experimental-prometheus-rw`
- `K6_PROMETHEUS_RW_SERVER_URL=http://prometheus:9090/api/v1/write`

That means `k6` sends its own timeseries directly into Prometheus while the scenario is running.

### Containers to Loki

Promtail watches Docker containers through:

- `/var/run/docker.sock`

It forwards structured container logs to:

- `http://loki:3100/loki/api/v1/push`

### Grafana to everything else

Grafana queries:

- Prometheus for metrics
- Loki for logs
- Tempo for traces

It uses provisioned datasources from [`datasources.yml`](/media/sf_university-hpc/observability/grafana/provisioning/datasources/datasources.yml), so there is no manual datasource setup step.

## Application Internals

## API Behavior

The API service is intentionally small but instrumented heavily enough for teaching.

### Request handling

The API:

- generates or reuses `x-request-id`
- labels each request with a normalized `route`
- derives a logical `mode` label
- records start time on request entry
- exports metrics on response
- logs structured JSON on non-health and non-metrics requests

### API metrics

The API exports:

- `http_requests_total`
- `http_request_duration_seconds`
- `http_requests_in_flight`
- `dependency_requests_total`
- `dependency_request_duration_seconds`
- `dependency_errors_total`

Important labels include:

- `route`
- `mode`
- `status_code`
- `operation`
- `outcome`

These labels are what power the dashboard slicing by route, mode, and dependency operation.

### API logs

The API logs:

- `request_id`
- `method`
- `route`
- `status_code`
- `duration_ms`
- `mode`
- `error`
- `trace_id`
- `span_id`

Because those logs go to stdout as JSON, Promtail can ingest them without a separate file shipper sidecar.

## Dependency Behavior

The dependency service mirrors the API’s structure, but its job is narrower:

- validate `delayMs`
- validate `failRate`
- sleep for `delayMs`
- fail randomly according to `failRate`
- emit metrics and structured logs

This gives the lab a clean downstream bottleneck with controlled behavior.

## Tracing Model

Both Node services use:

- `@opentelemetry/sdk-node`
- OTLP over HTTP
- an always-on sampler

The API creates server spans for incoming requests and client spans for dependency calls. The dependency creates server spans for its own incoming work requests. Because the API propagates context, the resulting trace graph shows the application hop cleanly.

## Load Testing Design

## Shared `k6` helpers

[`k6/common.js`](/media/sf_university-hpc/k6/common.js) centralizes:

- request execution helpers
- metadata tag generation
- workload mix constants
- small environment parsers
- a common summary formatter

Every scenario tags requests with:

- `scenario`
- `test_type`
- `variant`
- `run_profile`
- `workload_profile`
- `operation`

That taxonomy is a major part of the teaching design. It lets Grafana filter by lecture semantics instead of only by script name.

## Scenario inventory

The repository includes these scenarios:

- `smoke.js`
- `baseline.js`
- `degraded.js`
- `isolation.js`
- `spike.js`
- `stress.js`
- `stress-500.js`
- `soak.js`
- `breakpoint.js`

### What each scenario is for

- `smoke`: startup preflight, not part of the main lecture taxonomy
- `baseline`: representative mixed nominal traffic
- `degraded`: representative traffic with more degraded dependency-backed work
- `isolation`: single-path measurement for one operation
- `spike`: repeated bursts to expose latency spikes
- `stress`: stepped student-safe capacity ramp
- `stress-500`: extended instructor-grade stress ramp
- `soak`: sustained traffic for drift and stability checks
- `breakpoint`: stepped ramp with threshold-triggered abort

### Workload mixes

Representative mixes are defined in `common.js`:

- `BASELINE_MIX`
- `STRESS_MIX`
- `DEGRADED_MIX`

Those mixes determine which report mode or search path each iteration uses.

## Observability Design

## Metrics

### Prometheus scrape model

Prometheus scrapes:

- `demo-api` on `/metrics`
- `demo-dependency` on `/metrics`
- `cadvisor`
- `node-exporter`

Scrape and evaluation intervals are both `5s`.

### Why both service metrics and `k6` metrics exist

The stack intentionally keeps two perspectives:

- `k6` metrics show intended test traffic
- service metrics show what the application actually handled

This distinction matters when there is queuing, degradation, or partial failure.

## Logs

Promtail’s pipeline extracts useful structured fields from container logs and sends them to Loki. This lets Grafana logs views answer questions like:

- which route failed
- which service produced the error
- which request ID was affected
- which trace should be opened next

## Traces

Tempo stores spans from both services and Grafana uses Tempo as the trace backend.

The Loki datasource is configured with a derived field that matches `trace_id` in logs and links that value into Tempo. This is the main log-to-trace navigation path in the lab.

## Dashboards

Grafana provisions a folder named `HPC Demo` and loads these dashboards:

- `System Overview`
- `Infrastructure Overview`
- `Load Test Correlation`
- `Endpoint Comparison`
- `Dependency Health`
- `Root Cause Drilldown`

### Dashboard roles

- `System Overview`: application-centered runtime summary
- `Infrastructure Overview`: host and container resource context
- `Load Test Correlation`: puts load, latency, and infrastructure signals on the same page
- `Endpoint Comparison`: compares route and mode behavior
- `Dependency Health`: focuses on outbound dependency effects
- `Root Cause Drilldown`: supports symptom-to-trace investigation

### Current dashboard roadmap status

[`development-plan.md`](/media/sf_university-hpc/development-plan.md) captures ongoing dashboard work. The repository already includes the phase-2 workload mix row in `Load Test Correlation`, while later documentation and some later dashboard phases remain incomplete.

## How To Start And Use The Lab

## Prerequisites

- Docker Desktop or a compatible Docker Engine + Compose setup

## Start everything

```bash
docker compose up --build -d
```

This builds local images and starts the main lab stack.

## Check the stack

Useful checks:

```bash
docker compose ps
curl http://localhost:8080/health
curl http://localhost:8080/metrics
curl http://localhost:9090/-/healthy
curl http://localhost:3000/api/health
```

## Open the UIs

- API health: `http://localhost:8080/health`
- API metrics: `http://localhost:8080/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3000`

Grafana dashboards are under the `HPC Demo` folder.

## Run the smoke test

```bash
docker compose --profile loadtest run --rm k6
```

This validates:

- API reachability
- fast-path request handling
- Prometheus remote-write from `k6`
- the basic summary and threshold flow

## Run the teaching scenarios

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

### Common scenario overrides

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

## Suggested usage flow during a lesson

1. Start the stack and verify health.
2. Run `smoke.js` as a quick preflight.
3. Run `baseline.js`.
4. Open `System Overview`, `Infrastructure Overview`, and `Load Test Correlation`.
5. Run a contrasting scenario such as `spike.js`, `stress.js`, `soak.js`, or `breakpoint.js`.
6. Run `degraded.js`.
7. Compare `Endpoint Comparison` and `Dependency Health`.
8. Use Loki and Tempo from Grafana to move from symptoms to individual requests and traces.

## How To Stop And Reset

Stop the stack:

```bash
docker compose down
```

Stop and delete persisted observability data:

```bash
docker compose down -v
```

## Development Notes

## Why the repo has custom Dockerfiles for observability and `k6`

This repository now intentionally bakes:

- Prometheus config
- Loki config
- Promtail config
- Tempo config
- Grafana provisioning and dashboards
- `k6` scripts

into local images.

That is not just stylistic. It prevents container-side permission problems that can occur when this repository lives on a shared filesystem.

## How dashboard provisioning works

Grafana provisioning files live under:

- [`observability/grafana/provisioning`](/media/sf_university-hpc/observability/grafana/provisioning)

Dashboard JSON files live under:

- [`observability/grafana/dashboards`](/media/sf_university-hpc/observability/grafana/dashboards)

At image build time they are copied into `/etc/grafana/...`, not into the persistent Grafana data volume, so a named volume on `/var/lib/grafana` does not hide them.

## Supporting documents

- [`course-evaluation-and-demo-plan.md`](/media/sf_university-hpc/course-evaluation-and-demo-plan.md): explains why the lab uses this architecture and where it fits in the course
- [`development-plan.md`](/media/sf_university-hpc/development-plan.md): describes dashboard improvements that are still in progress
- [`course-content`](/media/sf_university-hpc/course-content): source lecture material that motivates the demo system

## Known Limits And Current Gaps

- Tempo is available to Grafana inside the compose network, but not exposed on a host port.
- `test_run_id` is not implemented yet, so repeated runs are still mainly separated by time range and scenario tags.
- Intended-vs-actual workload mix visualization is not complete yet.
- The course content is performance/observability oriented, not a full classical HPC curriculum.
- The repository does not currently include a formal unit/integration test suite for the Node services; validation is primarily done through compose health checks and `k6` scenarios.

## Quick Summary

This repository is a Docker-based teaching lab where:

- `k6` generates traffic
- `demo-api` serves requests
- `demo-dependency` simulates downstream latency and failure
- Prometheus stores metrics
- Loki stores logs
- Tempo stores traces
- Grafana ties those signals together with provisioned dashboards

If you want to understand the repo quickly, start from:

1. [`docker-compose.yml`](/media/sf_university-hpc/docker-compose.yml)
2. [`services/api/src/app.js`](/media/sf_university-hpc/services/api/src/app.js)
3. [`k6/common.js`](/media/sf_university-hpc/k6/common.js)
4. [`observability/prometheus/prometheus.yml`](/media/sf_university-hpc/observability/prometheus/prometheus.yml)
5. [`observability/grafana/provisioning/datasources/datasources.yml`](/media/sf_university-hpc/observability/grafana/provisioning/datasources/datasources.yml)
6. [`observability/grafana/dashboards/load-test-correlation.json`](/media/sf_university-hpc/observability/grafana/dashboards/load-test-correlation.json)
