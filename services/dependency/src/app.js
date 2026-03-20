'use strict';

const { randomUUID } = require('node:crypto');

const Fastify = require('fastify');
const { SpanKind, SpanStatusCode, context, propagation } = require('@opentelemetry/api');

const { createLogger } = require('./logger');
const { createMetrics } = require('./metrics');
const { getTracer } = require('./tracing');

const DEPENDENCY_PORT = Number.parseInt(process.env.PORT || '8080', 10);
const SERVICE_NAME = process.env.SERVICE_NAME || 'demo-dependency';

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getRouteLabel(request) {
  return request.routeOptions?.url || request.routerPath || request.raw.url || 'unmatched';
}

function getModeLabel(request) {
  if (getRouteLabel(request) === '/work') {
    return 'work';
  }

  if (getRouteLabel(request) === '/health') {
    return 'health';
  }

  if (getRouteLabel(request) === '/metrics') {
    return 'metrics';
  }

  return 'unknown';
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
    port: DEPENDENCY_PORT
  }));

  app.get('/metrics', async (request, reply) => {
    reply.header('content-type', metrics.register.contentType);
    return metrics.register.metrics();
  });

  app.get('/work', async (request, reply) => {
    return withServerSpan({
      request,
      tracer,
      spanName: 'GET /work',
      handler: async () => {
        const delayMs = Number.parseInt(request.query?.delayMs || '0', 10);
        const failRate = Number.parseFloat(request.query?.failRate || '0');

        if (!Number.isFinite(delayMs) || delayMs < 0) {
          request.responseError = { message: 'delayMs must be a non-negative integer.' };
          reply.code(400);
          return {
            request_id: request.id,
            error: 'delayMs must be a non-negative integer.'
          };
        }

        if (!Number.isFinite(failRate) || failRate < 0 || failRate > 1) {
          request.responseError = { message: 'failRate must be between 0 and 1.' };
          reply.code(400);
          return {
            request_id: request.id,
            error: 'failRate must be between 0 and 1.'
          };
        }

        return tracer.startActiveSpan('dependency.simulate', async (span) => {
          try {
            span.setAttribute('demo.delay_ms', delayMs);
            span.setAttribute('demo.fail_rate', failRate);

            await sleep(delayMs);

            if (Math.random() < failRate) {
              request.responseError = { message: 'Intentional dependency failure.' };
              reply.code(503);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: 'Intentional dependency failure.'
              });

              return {
                request_id: request.id,
                error: 'Intentional dependency failure.',
                delayMs,
                failRate
              };
            }

            span.setStatus({ code: SpanStatusCode.OK });
            return {
              request_id: request.id,
              service: SERVICE_NAME,
              delayMs,
              failRate,
              message: 'Dependency completed work.'
            };
          } finally {
            span.end();
          }
        });
      }
    });
  });

  return app;
}

module.exports = {
  DEPENDENCY_PORT,
  SERVICE_NAME,
  createApp
};
