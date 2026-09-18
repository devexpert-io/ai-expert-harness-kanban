import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runMockTask } from './harness/mock-engine.mjs';
import { runPiTask } from './harness/pi-engine.mjs';
import { RunStore } from './harness/run-store.mjs';
import { getTaskDefinition } from './harness/task-catalog.mjs';
import { inspectProject } from './harness/project-contract.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT ?? 4173);
const piBin = process.env.PI_BIN ?? 'pi';
const piMutationsAllowed = process.env.PI_ALLOW_MUTATIONS === 'true';
const store = new RunStore();
const selectedProjects = new Map();

function detectPi() {
  const result = spawnSync(piBin, ['--version'], { encoding: 'utf8', timeout: 3_000 });
  return result.status === 0 ? result.stdout.trim() : null;
}

const piVersion = detectPi();
const piEnabled = Boolean(piVersion && piMutationsAllowed);

function json(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 16_384) throw new Error('Payload demasiado grande');
  }
  return body ? JSON.parse(body) : {};
}

async function execute(run, task, projectPath) {
  try {
    if (run.engine === 'mock') {
      for await (const event of runMockTask({ signal: run.controller.signal })) store.emit(run.id, event);
    } else {
      await runPiTask({
        task,
        cwd: projectPath,
        emit: (event) => store.emit(run.id, event),
        signal: run.controller.signal,
        piBin,
        provider: process.env.PI_PROVIDER,
        model: process.env.PI_MODEL,
        timeoutMs: Number(process.env.PI_TIMEOUT_MS ?? 600_000)
      });
    }
    store.complete(run.id);
  } catch (error) {
    store.complete(run.id, error);
  }
}

function serveEvents(request, response, run) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
  for (const event of run.events) response.write(`data: ${JSON.stringify(event)}\n\n`);
  if (run.status !== 'running') {
    response.write(`event: complete\ndata: ${JSON.stringify({ status: run.status, error: run.error })}\n\n`);
    response.end();
    return;
  }
  const unsubscribe = store.subscribe(run.id, (event, finalRun) => {
    if (event) response.write(`data: ${JSON.stringify(event)}\n\n`);
    else {
      response.write(`event: complete\ndata: ${JSON.stringify({ status: finalRun.status, error: finalRun.error })}\n\n`);
      response.end();
    }
  });
  request.on('close', unsubscribe);
}

const publicFiles = new Map([
  ['/', 'index.html'], ['/index.html', 'index.html'], ['/styles.css', 'styles.css'], ['/app.js', 'app.js'], ['/README.md', 'README.md']
]);
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  try {
    if (request.method === 'GET' && url.pathname === '/api/status') {
      return json(response, 200, {
        defaultEngine: 'mock',
        pi: {
          installed: Boolean(piVersion),
          version: piVersion,
          enabled: piEnabled,
          reason: piEnabled ? null : !piVersion ? 'Pi no está instalado' : 'Configura PI_ALLOW_MUTATIONS=true'
        }
      });
    }
    if (request.method === 'POST' && url.pathname === '/api/projects/inspect') {
      const body = await readJson(request);
      const project = inspectProject(body.path);
      selectedProjects.set(project.path, project);
      return json(response, 200, project);
    }
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const body = await readJson(request);
      const project = body.projectPath ? selectedProjects.get(resolve(body.projectPath)) : null;
      if (body.projectPath && !project) return json(response, 409, { error: 'Selecciona e inspecciona el proyecto antes de ejecutar tareas' });
      const projectTask = project?.tasks.find((candidate) => candidate.id === body.taskId);
      const task = projectTask ? {
        ...projectTask,
        role: projectTask.role ?? 'Implementer',
        skill: projectTask.skill ?? 'feature-implementer',
        objective: `Completa ${projectTask.title}. Gate esperado: ${projectTask.gate ?? 'evidencia reproducible'}.`
      } : getTaskDefinition(body.taskId);
      const engine = body.engine === 'pi' ? 'pi' : 'mock';
      if (!task) return json(response, 404, { error: 'Tarea no ejecutable' });
      if (task.blocked) return json(response, 409, { error: `Tarea bloqueada: ${task.blocked.reason}` });
      if (engine === 'pi' && !project) return json(response, 409, { error: 'Pi requiere un proyecto seleccionado explícitamente' });
      if (engine === 'pi' && !piEnabled) return json(response, 409, { error: `Pi no disponible: ${!piVersion ? 'no instalado' : 'falta PI_ALLOW_MUTATIONS=true'}` });
      const run = store.create({ taskId: task.id, engine, projectPath: project?.path ?? null });
      queueMicrotask(() => execute(run, task, project?.path));
      return json(response, 202, { runId: run.id, taskId: run.taskId, engine: run.engine });
    }
    const eventMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/);
    if (request.method === 'GET' && eventMatch) {
      const run = store.get(eventMatch[1]);
      if (!run) return json(response, 404, { error: 'Ejecución no encontrada' });
      return serveEvents(request, response, run);
    }
    const fileName = publicFiles.get(url.pathname);
    if (request.method === 'GET' && fileName) {
      const path = join(root, fileName);
      const stat = statSync(path);
      response.writeHead(200, { 'content-type': mimeTypes[extname(path)] ?? 'application/octet-stream', 'content-length': stat.size });
      return createReadStream(path).pipe(response);
    }
    json(response, 404, { error: 'No encontrado' });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

server.listen(port, () => {
  console.log(`Harness en http://localhost:${port} · mock activo · Pi ${piEnabled ? `activo (${piVersion})` : `inactivo (${piVersion ?? 'no instalado'})`}`);
});
