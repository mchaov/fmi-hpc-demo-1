'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');
const { randomUUID } = require('node:crypto');

const Fastify = require('fastify');
const { SpanKind, SpanStatusCode, context, propagation } = require('@opentelemetry/api');

const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { getTracer } = require('./tracing');

const API_PORT = Number.parseInt(process.env.PORT || '8080', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'demo-api';
const DEPENDENCY_URL = process.env.DEPENDENCY_URL || 'http://dependency:8080';

const SEARCH_DATASET = buildDataset();

function buildDataset() {
  const subjects = ['distributed', 'parallel', 'observability', 'latency', 'throughput', 'jitter', 'capacity', 'benchmark'];
  const nouns = ['cluster', 'node', 'request', 'trace', 'dashboard', 'metric', 'experiment', 'report'];
  const adjectives = ['fast', 'resilient', 'measured', 'repeatable', 'stable', 'noisy', 'efficient', 'degraded'];
  const items = [];

  for (let index = 1; index <= 400; index += 1) {
    const subject = subjects[index % subjects.length];
    const noun = nouns[index % nouns.length];
    const adjective = adjectives[index % adjectives.length];

    items.push({
      id: index,
      name: `${adjective}-${subject}-${noun}-${index}`,
      category: subject,
      description: `Demo item ${index} for ${subject} performance scenarios.`
    });
  }

  return items;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRouteLabel(request) {
  return request.routeOptions?.url || request.routerPath || new URL(`http://localhost${request.raw.url}`).pathname || 'unmatched';
}

function getModeLabel(request) {
  const route = getRouteLabel(request);

  if (route === '/api/report') {
    return request.query?.mode || 'report';
  }

  if (route === '/api/search') {
    return 'search';
  }

  if (route === '/api/items/:id') {
    return 'item';
  }

  if (route === '/health') {
    return 'health';
  }

  if (route === '/metrics') {
    return 'metrics';
  }

  return 'unknown';
}

function requestJson(urlString, timeoutMs = 3000, headers = {}) {
  const url = new URL(urlString);
  const transport = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers
      },
      (response) => {
        let body = '';

        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          let parsed = null;

          if (body) {
            try {
              parsed = JSON.parse(body);
            } catch (error) {
              reject(new Error(`Dependency returned invalid JSON: ${error.message}`));
              return;
            }
          }

          resolve({
            statusCode: response.statusCode || 500,
            body: parsed
          });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(new Error(`Dependency request timed out after ${timeoutMs}ms`));
    });

    request.on('error', (error) => {
      reject(error);
    });

    request.end();
  });
}

async function withServerSpan({ request, tracer, spanName, handler }) {
  const route = request.metricsRoute || getRouteLabel(request);
  const parentContext = propagation.extract(context.active(), request.headers);

  return tracer.startActiveSpan(
    spanName,
    {
      kind: SpanKind.SERVER,
      attributes: {
        'http.method': request.method,
        'http.route': route,
        'http.request_id': request.id
      }
    },
    parentContext,
    async (span) => {
      request.traceContext = span.spanContext();

      try {
        const result = await handler(span);

        if (request.responseError) {
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: request.responseError.message
          });
        } else {
          span.setStatus({ code: SpanStatusCode.OK });
        }

        return result;
      } catch (error) {
        request.responseError = error;
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: error.message
        });
        throw error;
      } finally {
        span.end();
      }
    }
  );
}

function createApp() {
  const logger = createLogger(SERVICE_NAME);
  const metrics = createMetrics(SERVICE_NAME);
  const tracer = getTracer(SERVICE_NAME);

  const app = Fastify({
    loggerInstance: logger,
    disableRequestLogging: true,
    requestIdHeader: 'x-request-id',
    genReqId(request) {
      return request.headers['x-request-id'] || randomUUID();
    }
  });

  app.addHook('onRequest', async (request, reply) => {
    request.startTime = process.hrtime.bigint();
    reply.header('x-request-id', request.id);
  });

  app.addHook('preHandler', async (request) => {
    request.metricsRoute = getRouteLabel(request);
    request.modeLabel = getModeLabel(request);

    metrics.httpRequestsInFlight.inc({
      method: request.method,
      route: request.metricsRoute
    });
  });

  app.addHook('onResponse', async (request, reply) => {
    const route = request.metricsRoute || getRouteLabel(request);
    const mode = request.modeLabel || getModeLabel(request);
    const statusCode = String(reply.statusCode || 500);
    const durationSeconds = Number(process.hrtime.bigint() - request.startTime) / 1e9;
    const durationMs = Number((durationSeconds * 1000).toFixed(2));

    metrics.httpRequestsInFlight.dec({
      method: request.method,
      route
    });

    metrics.httpRequestsTotal.inc({
      method: request.method,
      route,
      status_code: statusCode,
      mode
    });

    metrics.httpRequestDurationSeconds.observe(
      {
        method: request.method,
        route,
        status_code: statusCode,
        mode
      },
      durationSeconds
    );

    if (route === '/metrics' || route === '/health') {
      return;
    }

    const traceContext = request.traceContext;
    request.log.info({
      request_id: request.id,
      method: request.method,
      route,
      status_code: reply.statusCode,
      duration_ms: durationMs,
      mode,
      error: request.responseError ? request.responseError.message : null,
      trace_id: traceContext ? traceContext.traceId : undefined,
      span_id: traceContext ? traceContext.spanId : undefined
    }, 'request completed');
  });

  app.setErrorHandler((error, request, reply) => {
    request.responseError = error;
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;

    reply.code(statusCode).send({
      error: error.message,
      request_id: request.id
    });
  });

  app.get('/health', async () => ({
    ok: true,
    service: SERVICE_NAME,
    version: process.env.SERVICE_VERSION || 'v2',
    port: API_PORT
  }));

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', metrics.register.contentType);
    return metrics.register.metrics();
  });

  app.get('/api/items/:id', async (request, reply) => {
    return withServerSpan({
      request,
      tracer,
      spanName: 'GET /api/items/:id',
      handler: async () => {
        const itemId = Number.parseInt(request.params.id, 10);
        const item = SEARCH_DATASET.find((candidate) => candidate.id === itemId);

        if (!item) {
          request.responseError = { message: `Item ${request.params.id} not found.` };
          reply.code(404);
          return {
            error: `Item ${request.params.id} not found.`,
            request_id: request.id
          };
        }

        return {
          request_id: request.id,
          item
        };
      }
    });
  });

  app.get('/api/search', async (request) => {
    return withServerSpan({
      request,
      tracer,
      spanName: 'GET /api/search',
      handler: async () => {
        const query = `${request.query?.q || ''}`.trim().toLowerCase();

        const results = await tracer.startActiveSpan('search.in-memory', async (span) => {
          try {
            span.setAttribute('search.query', query || '<empty>');

            const filtered = SEARCH_DATASET.filter((item) => {
              if (!query) {
                return true;
              }

              return item.name.includes(query)
                || item.category.includes(query)
                || item.description.toLowerCase().includes(query);
            }).slice(0, 10);

            let checksum = 0;
            for (let index = 0; index < 25000; index += 1) {
              checksum = (checksum + (index * (query.length + 1))) % 9973;
            }

            span.setAttribute('search.result_count', filtered.length);
            span.setAttribute('search.checksum', checksum);
            span.setStatus({ code: SpanStatusCode.OK });
            return filtered;
          } finally {
            span.end();
          }
        });

        return {
          request_id: request.id,
          count: results.length,
          results
        };
      }
    });
  });

  app.get('/api/report', async (request, reply) => {
    return withServerSpan({
      request,
      tracer,
      spanName: 'GET /api/report',
      handler: async () => {
        const mode = `${request.query?.mode || 'fast'}`.toLowerCase();

        if (mode === 'fast') {
          return {
            request_id: request.id,
            mode,
            message: 'Fast path completed.'
          };
        }

        if (mode === 'slow') {
          await tracer.startActiveSpan('report.delay', async (span) => {
            try {
              span.setAttribute('demo.delay_ms', 150);
              await sleep(150);
              span.setStatus({ code: SpanStatusCode.OK });
            } finally {
              span.end();
            }
          });

          return {
            request_id: request.id,
            mode,
            message: 'Slow path completed.'
          };
        }

        if (mode === 'dependency' || mode === 'degraded') {
          const dependencyResponse = await callDependency({
            metrics,
            tracer,
            mode,
            requestId: request.id,
            log: request.log
          });

          return {
            request_id: request.id,
            mode,
            dependency: dependencyResponse
          };
        }

        if (mode === 'error') {
          request.responseError = { message: 'Intentional demo error.' };
          reply.code(503);
          return {
            request_id: request.id,
            mode,
            error: 'Intentional demo error.'
          };
        }

        request.responseError = { message: `Unsupported mode: ${mode}` };
        reply.code(400);
        return {
          request_id: request.id,
          error: `Unsupported mode: ${mode}`
        };
      }
    });
  });

  return app;
}

async function callDependency({ metrics, tracer, mode, requestId, log }) {
  const delayMs = mode === 'dependency' ? 75 : 400;
  const failRate = mode === 'dependency' ? 0 : 0.05;
  const operation = mode;
  const targetUrl = `${DEPENDENCY_URL}/work?delayMs=${delayMs}&failRate=${failRate}`;

  return tracer.startActiveSpan('dependency.invoke', { kind: SpanKind.CLIENT }, async (span) => {
    let outcome = 'success';
    const start = process.hrtime.bigint();
    const headers = {
      accept: 'application/json'
    };

    span.setAttribute('dependency.url', targetUrl);
    span.setAttribute('dependency.delay_ms', delayMs);
    span.setAttribute('dependency.fail_rate', failRate);
    propagation.inject(context.active(), headers);

    try {
      const response = await requestJson(targetUrl, 3000, headers);

      if (response.statusCode >= 400) {
        outcome = 'error';
        const error = new Error(`Dependency call failed with status ${response.statusCode}.`);
        error.statusCode = 502;
        throw error;
      }

      span.setStatus({ code: SpanStatusCode.OK });
      return response.body;
    } catch (error) {
      outcome = 'error';
      metrics.dependencyErrorsTotal.inc({
        dependency: 'demo-dependency',
        operation
      });

      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message
      });

      log.warn({
        request_id: requestId,
        mode,
        error: error.message
      }, 'dependency request failed');

      throw error;
    } finally {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;

      metrics.dependencyRequestsTotal.inc({
        dependency: 'demo-dependency',
        operation,
        outcome
      });

      metrics.dependencyRequestDurationSeconds.observe(
        {
          dependency: 'demo-dependency',
          operation,
          outcome
        },
        durationSeconds
      );

      span.end();
    }
  });
}

module.exports = {
  API_PORT,
  SERVICE_NAME,
  createApp
};
