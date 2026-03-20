'use strict';

const { diag, DiagConsoleLogger, DiagLogLevel, trace } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { AlwaysOnSampler } = require('@opentelemetry/sdk-trace-base');

let sdk;

function isTracingEnabled() {
  return (process.env.ENABLE_TRACING || 'true').toLowerCase() !== 'false';
}

async function startTracing(serviceName) {
  if (!isTracingEnabled() || sdk) {
    return sdk;
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  sdk = new NodeSDK({
    sampler: new AlwaysOnSampler(),
    traceExporter: new OTLPTraceExporter({
      url: process.env.TEMPO_ENDPOINT || 'http://tempo:4318/v1/traces'
    })
  });

  await sdk.start();
  return sdk;
}

async function stopTracing() {
  if (!sdk) {
    return;
  }

  await sdk.shutdown();
  sdk = null;
}

function getTracer(name) {
  return trace.getTracer(name);
}

module.exports = {
  getTracer,
  startTracing,
  stopTracing
};
