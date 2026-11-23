import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { inspectPlan, nativeDashboard, problem, scenarios, TestRunner, validatedSettings } from './run.mjs';

const runner = new TestRunner();
const assets = new Map([
  ['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']],
  ['/style.css', ['style.css', 'text/css']]
]);

function reply(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

async function readCommand(req) {
  if (req.headers.origin && req.headers.origin !== 'http://' + req.headers.host) {
    throw problem(403, 'Open the runner to control a test.');
  }
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw problem(415, 'Send a JSON command.');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw problem(413, 'The command is too large.');
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {}
  throw problem(400, 'Send a JSON object.');
}

// k6 waits for event-stream clients at shutdown. The server owns every upstream
// connection, including viewers in background tabs that cannot run browser timers.
function proxyNative(req, res, path, run) {
  const upstream = http.get(nativeDashboard + path, {
    headers: req.headers['last-event-id'] ? { 'Last-Event-ID': req.headers['last-event-id'] } : {}
  }, source => {
    res.writeHead(source.statusCode, { 'Content-Type': source.headers['content-type'] || 'application/octet-stream',
      'Cache-Control': 'no-store' });
    res.flushHeaders();
    source.on('error', () => res.end());
    source.pipe(res);
  });
  const close = id => {
    if (id === run.id) {
      upstream.destroy();
      res.end();
    }
  };
  if (path.startsWith('/events')) runner.on('closeDashboard', close);
  res.once('close', () => {
    runner.off('closeDashboard', close);
    upstream.destroy();
  });
  upstream.on('error', () => {
    if (!res.headersSent && !res.writableEnded) res.writeHead(503);
    res.end();
  });
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const path = url.pathname;
  if (req.method === 'GET') {
    if (path === '/api/scenarios') return reply(res, 200, scenarios);
    if (path === '/api/run') return reply(res, 200, runner.snapshot());
    if (path.startsWith('/api/plan/')) {
      const id = path.slice('/api/plan/'.length);
      const settings = validatedSettings(id, Object.fromEntries(url.searchParams));
      return reply(res, 200, await inspectPlan(id, settings));
    }
    const run = runner.current;
    if (run && path === '/api/runs/' + run.id + '/report' && run.reportReady) {
      const html = await readFile(run.reportFile).catch(err => {
        if (err.code === 'ENOENT') throw problem(404, 'This report has been replaced.');
        throw err;
      });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }
    const live = path.match(/^\/live\/([^/]+)\/(events|report)$/);
    if (live) {
      if (run?.id === live[1] && run.dashboardReady) {
        return proxyNative(req, res, '/' + live[2] + url.search, run);
      }
      // HTTP 204 also stops an EventSource from reconnecting to an expired run.
      res.writeHead(live[2] === 'events' ? 204 : 404);
      return res.end();
    }
    if (path.startsWith('/ui/') && run?.dashboardReady) return proxyNative(req, res, path + url.search, run);
    if (assets.has(path)) {
      const [file, type] = assets.get(path);
      const content = await readFile(new URL('./public/' + file, import.meta.url));
      res.writeHead(200, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(content);
    }
    if (path === '/favicon.ico') { res.writeHead(204); return res.end(); }
  }
  if (req.method === 'POST') {
    const body = await readCommand(req);
    if (path === '/api/runs') return reply(res, 202, await runner.start(body.scenario, body.settings));
    const stop = path.match(/^\/api\/runs\/([^/]+)\/stop$/);
    if (stop) return reply(res, 202, runner.stop(stop[1]));
  }
  throw problem(404, 'This page or run is unavailable.');
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    if (!err.status) console.error(err);
    if (!res.headersSent) reply(res, err.status || 500, { error: err.status ? err.message : 'The runner could not complete the request.' });
    else res.end();
  });
});
server.listen(8080, '0.0.0.0');

async function shutdown() {
  server.close();
  await runner.shutdown();
  server.closeAllConnections();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
