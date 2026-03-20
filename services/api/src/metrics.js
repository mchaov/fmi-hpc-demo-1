'use strict';

const client = require('prom-client');

function createMetrics(serviceName) {
  const register = new client.Registry();
  register.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register });

  const httpRequestsTotal = new client.Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests handled by the service.',
    labelNames: ['method', 'route', 'status_code', 'mode'],
    registers: [register]
  });

  const httpRequestDurationSeconds = new client.Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request duration in seconds.',
    labelNames: ['method', 'route', 'status_code', 'mode'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
  });

  const httpRequestsInFlight = new client.Gauge({
    name: 'http_requests_in_flight',
    help: 'HTTP requests currently being processed.',
    labelNames: ['method', 'route'],
    registers: [register]
  });

  const dependencyRequestsTotal = new client.Counter({
    name: 'dependency_requests_total',
    help: 'Total outbound dependency requests.',
    labelNames: ['dependency', 'operation', 'outcome'],
    registers: [register]
  });

  const dependencyRequestDurationSeconds = new client.Histogram({
    name: 'dependency_request_duration_seconds',
    help: 'Outbound dependency request duration in seconds.',
    labelNames: ['dependency', 'operation', 'outcome'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.075, 0.1, 0.15, 0.25, 0.5, 1, 2.5, 5],
    registers: [register]
  });

  const dependencyErrorsTotal = new client.Counter({
    name: 'dependency_errors_total',
    help: 'Total outbound dependency request errors.',
    labelNames: ['dependency', 'operation'],
    registers: [register]
  });

  return {
    register,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    httpRequestsInFlight,
    dependencyRequestsTotal,
    dependencyRequestDurationSeconds,
    dependencyErrorsTotal
  };
}

module.exports = {
  createMetrics
};
