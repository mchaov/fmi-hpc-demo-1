'use strict';

const { createApp, API_PORT, SERVICE_NAME } = require('./app');
const { startTracing, stopTracing } = require('./tracing');

async function main() {
  await startTracing(SERVICE_NAME);

  const app = createApp();

  const close = async (signal) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await stopTracing();
    process.exit(0);
  };

  process.on('SIGINT', close);
  process.on('SIGTERM', close);

  await app.listen({
    port: API_PORT,
    host: '0.0.0.0'
  });

  app.log.info({ port: API_PORT }, 'demo api started');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
