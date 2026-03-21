const http = require('node:http');

const PORT = Number.parseInt(process.env.PORT || '9105', 10);
const DOCKER_SOCKET_PATH = process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock';
const SCRAPE_CACHE_MS = Number.parseInt(process.env.SCRAPE_CACHE_MS || '2000', 10);

let cachedBody = '';
let cachedAt = 0;
let inFlightScrape = null;

function escapeLabelValue(value) {
  return `${value}`
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/"/g, '\\"');
}

function formatLabels(labels) {
  const entries = Object.entries(labels).filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (entries.length === 0) {
    return '';
  }

  return `{${entries.map(([key, value]) => `${key}="${escapeLabelValue(value)}"`).join(',')}}`;
}

function sumValues(items, keySelector) {
  return items.reduce((total, item) => total + (Number(keySelector(item)) || 0), 0);
}

function selectComposeLabels(container) {
  const labels = container.Labels || {};
  const composeService = labels['com.docker.compose.service'];
  const composeProject = labels['com.docker.compose.project'];

  if (!composeService || !composeProject) {
    return null;
  }

  return {
    compose_container_number: labels['com.docker.compose.container-number'] || '1',
    compose_project: composeProject,
    compose_service: composeService,
    container_id: container.Id.slice(0, 12),
    container_name: (container.Names?.[0] || '').replace(/^\/+/, '') || container.Id.slice(0, 12),
    id: `/docker/${container.Id}`,
    image: container.Image || 'unknown'
  };
}

function dockerGetJson(path) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        method: 'GET',
        path,
        socketPath: DOCKER_SOCKET_PATH
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve(body ? JSON.parse(body) : null);
            return;
          }

          reject(new Error(`Docker API ${path} returned ${response.statusCode}: ${body}`));
        });
      }
    );

    request.on('error', reject);
    request.end();
  });
}

function buildMetricLines(name, help, type, samples) {
  const lines = [
    `# HELP ${name} ${help}`,
    `# TYPE ${name} ${type}`
  ];

  for (const sample of samples) {
    lines.push(`${name}${formatLabels(sample.labels)} ${sample.value}`);
  }

  return lines;
}

function extractBlockIoTotals(stats) {
  const items = stats.blkio_stats?.io_service_bytes_recursive || [];
  let reads = 0;
  let writes = 0;

  for (const item of items) {
    const op = `${item.op || ''}`.toLowerCase();
    const value = Number(item.value) || 0;
    if (op === 'read') {
      reads += value;
    } else if (op === 'write') {
      writes += value;
    }
  }

  return { reads, writes };
}

function extractNetworkTotals(stats) {
  const networks = Object.values(stats.networks || {});

  return {
    rx: sumValues(networks, (network) => network.rx_bytes),
    tx: sumValues(networks, (network) => network.tx_bytes)
  };
}

function extractMemoryWorkingSet(stats) {
  const usage = Number(stats.memory_stats?.usage) || 0;
  const inactiveFile =
    Number(stats.memory_stats?.stats?.inactive_file)
    || Number(stats.memory_stats?.stats?.total_inactive_file)
    || 0;

  return Math.max(usage - inactiveFile, 0);
}

async function scrapeDockerMetrics() {
  const containers = await dockerGetJson('/containers/json?all=0');
  const composeContainers = containers
    .map((container) => ({ container, labels: selectComposeLabels(container) }))
    .filter((entry) => entry.labels);

  const statsResults = await Promise.all(
    composeContainers.map(async ({ container, labels }) => {
      const stats = await dockerGetJson(`/containers/${container.Id}/stats?stream=0`);
      const cpuSeconds = (Number(stats.cpu_stats?.cpu_usage?.total_usage) || 0) / 1_000_000_000;
      const memoryWorkingSet = extractMemoryWorkingSet(stats);
      const blockIoTotals = extractBlockIoTotals(stats);
      const networkTotals = extractNetworkTotals(stats);

      return {
        blockIoTotals,
        cpuSeconds,
        labels,
        memoryWorkingSet,
        networkTotals
      };
    })
  );

  const lines = [];
  lines.push(
    ...buildMetricLines(
      'container_cpu_usage_seconds_total',
      'Total CPU time consumed by the container in seconds.',
      'counter',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.cpuSeconds
      }))
    ),
    ...buildMetricLines(
      'container_memory_working_set_bytes',
      'Approximate working set memory used by the container in bytes.',
      'gauge',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.memoryWorkingSet
      }))
    ),
    ...buildMetricLines(
      'container_network_receive_bytes_total',
      'Cumulative bytes received by the container.',
      'counter',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.networkTotals.rx
      }))
    ),
    ...buildMetricLines(
      'container_network_transmit_bytes_total',
      'Cumulative bytes transmitted by the container.',
      'counter',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.networkTotals.tx
      }))
    ),
    ...buildMetricLines(
      'container_fs_reads_bytes_total',
      'Cumulative bytes read by the container block devices.',
      'counter',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.blockIoTotals.reads
      }))
    ),
    ...buildMetricLines(
      'container_fs_writes_bytes_total',
      'Cumulative bytes written by the container block devices.',
      'counter',
      statsResults.map((result) => ({
        labels: result.labels,
        value: result.blockIoTotals.writes
      }))
    )
  );

  return `${lines.join('\n')}\n`;
}

async function getMetricsBody() {
  const now = Date.now();
  if (cachedBody && now - cachedAt < SCRAPE_CACHE_MS) {
    return cachedBody;
  }

  if (!inFlightScrape) {
    inFlightScrape = scrapeDockerMetrics()
      .then((body) => {
        cachedBody = body;
        cachedAt = Date.now();
        return body;
      })
      .finally(() => {
        inFlightScrape = null;
      });
  }

  return inFlightScrape;
}

const server = http.createServer(async (request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  if (request.url !== '/metrics') {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('not found\n');
    return;
  }

  try {
    const body = await getMetricsBody();
    response.writeHead(200, {
      'Content-Type': 'text/plain; version=0.0.4; charset=utf-8'
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end(`# scrape failed: ${error.message}\n`);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  process.stdout.write(JSON.stringify({
    event: 'docker-metrics-exporter-started',
    port: PORT
  }) + '\n');
});
