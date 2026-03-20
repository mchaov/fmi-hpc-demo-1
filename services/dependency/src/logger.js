'use strict';

const pino = require('pino');
const { trace } = require('@opentelemetry/api');

function createLogger(serviceName) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: {
      service: serviceName
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      }
    },
    mixin() {
      const span = trace.getActiveSpan();

      if (!span) {
        return {};
      }

      const context = span.spanContext();
      return {
        trace_id: context.traceId,
        span_id: context.spanId
      };
    }
  });
}

module.exports = {
  createLogger
};
