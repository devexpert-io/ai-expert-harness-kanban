import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chooseProject } from './harness/project-selector.mjs';
import { StateStore } from './harness/state-store.mjs';
import { FeatureQueue } from './harness/queue.mjs';
import { acquireServerLock } from './harness/server-lock.mjs';
import { piOptions as configuredPiOptions } from './harness/pi-config.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicFiles = new Map([['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/app.js', 'app.js']]);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Petición demasiado grande');
  }
  return body ? JSON.parse(body) : {};
}

export function createHarnessServer({ statePath = process.env.HARNESS_STATE_PATH ?? join(root, '.harness-data/state.json'), select = chooseProject, executor, piVersion, piOptions = {} } = {}) {
  const release = acquireServerLock(statePath);
  const options = { ...configuredPiOptions(), ...piOptions };
  if (piVersion === undefined) {
    const detection = spawnSync(options.piBin, ['--version'], { encoding: 'utf8', timeout: 3_000 });
    piVersion = detection.status === 0 ? detection.stdout.trim() : null;
  }
  let queue;
  try { queue = new FeatureQueue({ store: new StateStore(statePath), executor, piVersion, piOptions: options }); }
  catch (error) { release(); throw error; }
  let selecting = false;
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(response, 403, { error: 'Solo se permite acceso local' });
      const url = new URL(request.url, `http://${host}`);
      if (request.method !== 'GET') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: 'Origen no permitido' });
        if (request.headers['content-type'] !== 'application/json') return json(response, 415, { error: 'Se requiere application/json' });
      }
      if (request.method === 'GET' && ['/api/state', '/api/status'].includes(url.pathname)) return json(response, 200, queue.snapshot());
      if (request.method === 'POST' && url.pathname === '/api/projects/select') {
        if (selecting) throw new Error('El selector de carpetas ya está abierto');
        selecting = true;
        try {
          const project = await select();
          if (project) queue.select(project);
          return json(response, 200, { cancelled: !project, ...queue.snapshot() });
        } finally { selecting = false; }
      }
      if (request.method === 'POST' && url.pathname === '/api/project/reload') return json(response, 200, queue.snapshot());
      if (request.method === 'POST' && url.pathname === '/api/queue') {
        const body = await readJson(request);
        queue.enqueue(body.taskIds);
        return json(response, 202, queue.snapshot());
      }
      if (request.method === 'POST' && url.pathname === '/api/queue/pause') { queue.pause(); return json(response, 200, queue.snapshot()); }
      if (request.method === 'POST' && url.pathname === '/api/queue/resume') { queue.resume(); return json(response, 200, queue.snapshot()); }
      const match = url.pathname.match(/^\/api\/runs\/([\w-]+)\/(stop|retry|discard|reviewed)$/);
      if (request.method === 'POST' && match) { queue.action(match[1], match[2]); return json(response, 200, queue.snapshot()); }
      const file = publicFiles.get(url.pathname);
      if (request.method === 'GET' && file) {
        const path = join(root, file);
        response.writeHead(200, { 'content-type': mimeTypes[extname(path)], 'content-length': statSync(path).size, 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
        return createReadStream(path).pipe(response);
      }
      return json(response, 404, { error: 'No encontrado' });
    } catch (error) { return json(response, 409, { error: error.message }); }
  });
  server.once('close', release);
  server.once('error', release);
  return { server, queue };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, queue } = createHarnessServer();
  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, '127.0.0.1', () => console.log(`Harness en http://localhost:${port} · Pi · feature-flow · WIP 1`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await queue.close();
    server.close();
    server.closeAllConnections();
  });
}
