import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chooseProject } from './harness/project-selector.mjs';
import { StateStore } from './harness/state-store.mjs';
import { FeatureQueue } from './harness/queue.mjs';
import { acquireServerLock } from './harness/server-lock.mjs';
import { piOptions as configuredPiOptions } from './harness/pi-config.mjs';
import { Credentials, verifyKey } from './harness/credentials.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const publicRoot = join(root, 'public');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
// Only flat, known asset names from public/; no traversal, no directory listing.
function publicFile(pathname) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!/^(ui\/)?[\w-]+\.(html|css|js)$/.test(name)) return null;
  const path = join(publicRoot, name);
  return existsSync(path) ? path : null;
}
class RequestError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const json = (response, status, value) => {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
};
async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new RequestError(413, 'Petición demasiado grande');
  }
  try { return body ? JSON.parse(body) : {}; } catch { throw new RequestError(400, 'El cuerpo no es JSON válido'); }
}

export function createHarnessServer({ statePath = process.env.HARNESS_STATE_PATH ?? join(root, '.harness-data/state.json'), select = chooseProject, executor, piVersion, piOptions = {}, env = process.env, verify = verifyKey, queueOptions = {} } = {}) {
  const release = acquireServerLock(statePath);
  const options = { ...configuredPiOptions(), ...piOptions };
  if (piVersion === undefined) {
    const detection = spawnSync(options.piBin, ['--version'], { encoding: 'utf8', timeout: 3_000 });
    piVersion = detection.status === 0 ? detection.stdout.trim() : null;
  }
  let queue;
  const credentials = new Credentials({ path: join(dirname(statePath), 'credentials.json'), env });
  const maxParallel = Math.max(1, Math.min(8, Number(env.HARNESS_PARALLEL ?? 3) || 3));
  try { queue = new FeatureQueue({ store: new StateStore(statePath), executor, piVersion, piOptions: options, credentials, maxParallel, ...queueOptions }); }
  catch (error) { release(); throw error; }
  let selecting = false;
  const server = createServer(async (request, response) => {
    try {
      const host = request.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return json(response, 403, { error: 'Solo se permite acceso local' });
      const url = new URL(request.url, `http://${host}`);
      if (request.method !== 'GET') {
        if (request.headers.origin && request.headers.origin !== `http://${host}`) return json(response, 403, { error: 'Origen no permitido' });
        if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return json(response, 415, { error: 'Se requiere application/json' });
      }
      const body = request.method === 'POST' ? await readJson(request) : {};
      if (request.method === 'GET' && ['/api/state', '/api/status'].includes(url.pathname)) {
        // Polling clients revalidate with an ETag, so an unchanged board costs no transfer or re-parse.
        const body = JSON.stringify(queue.snapshot());
        const tag = `"${createHash('sha1').update(body).digest('base64url')}"`;
        if (request.headers['if-none-match'] === tag) { response.writeHead(304, { etag: tag, 'cache-control': 'no-cache' }); return response.end(); }
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', etag: tag });
        return response.end(body);
      }
      if (request.method === 'POST' && url.pathname === '/api/projects/select') {
        if (selecting) throw new Error('El selector de carpetas ya está abierto');
        selecting = true;
        try {
          const project = await select();
          if (project) queue.select(project);
          return json(response, 200, { cancelled: !project, ...queue.snapshot() });
        } finally { selecting = false; }
      }
      if (request.method === 'POST' && url.pathname === '/api/queue') {
        queue.enqueue(body.taskIds);
        return json(response, 202, queue.snapshot());
      }
      if (request.method === 'POST' && url.pathname === '/api/credentials') {
        if (typeof body.apiKey !== 'string') throw new RequestError(400, 'Falta la API key');
        await verify(body.apiKey);
        credentials.set(body.apiKey, body.remember === true);
        return json(response, 200, queue.snapshot());
      }
      if (request.method === 'POST' && url.pathname === '/api/credentials/clear') { credentials.clear(); return json(response, 200, queue.snapshot()); }
      if (request.method === 'POST' && url.pathname === '/api/reviews/refresh') { queue.refreshReviews(); return json(response, 200, queue.snapshot()); }
      if (request.method === 'POST' && url.pathname === '/api/queue/pause') { queue.pause(); return json(response, 200, queue.snapshot()); }
      if (request.method === 'POST' && url.pathname === '/api/queue/resume') { queue.resume(); return json(response, 200, queue.snapshot()); }
      const match = url.pathname.match(/^\/api\/runs\/([\w-]+)\/(stop|retry|discard|merge|reject)$/);
      if (request.method === 'POST' && match) { queue.action(match[1], match[2], body); return json(response, 200, queue.snapshot()); }
      const path = request.method === 'GET' ? publicFile(url.pathname) : null;
      if (path) {
        response.writeHead(200, { 'content-type': mimeTypes[extname(path)], 'content-length': statSync(path).size, 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'" });
        return createReadStream(path).pipe(response);
      }
      return json(response, 404, { error: 'No encontrado' });
    } catch (error) { return json(response, error.status ?? 409, { error: error.message }); }
  });
  server.once('close', release);
  server.once('error', release);
  return { server, queue };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, queue } = createHarnessServer();
  queue.watchReviews();
  const port = Number(process.env.PORT ?? 4173);
  server.listen(port, '127.0.0.1', () => console.log(`Harness en http://localhost:${port} · Pi · feature-flow · hasta ${queue.maxParallel} en paralelo`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => {
    await queue.close();
    server.close();
    server.closeAllConnections();
  });
}
