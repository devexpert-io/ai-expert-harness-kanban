import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { git } from '../harness/git-workspace.mjs';
import test from 'node:test';
import { FeatureQueue } from '../harness/queue.mjs';
import { StateStore } from '../harness/state-store.mjs';
import { inspectProject } from '../harness/project-contract.mjs';
import { createHarnessServer } from '../server.mjs';
import { fixture, feature, fakeExecutor, until } from './fixtures.mjs';

function setup(features, executor) {
  const cwd = fixture(features);
  const statePath = join(fixture(), 'state.json');
  const queue = new FeatureQueue({ store: new StateStore(statePath), executor: executor ?? fakeExecutor(), piVersion: 'fixture' });
  queue.select(inspectProject(cwd));
  return { cwd, statePath, queue };
}

test('una sola feature activa, orden de dependencias y selección explícita', async () => {
  let active = 0;
  let maximum = 0;
  const calls = [];
  const executor = fakeExecutor({ calls, hook: async () => { maximum = Math.max(maximum, ++active); await new Promise((resolve) => setTimeout(resolve, 5)); active--; } });
  const { queue } = setup([feature('second', ['first']), feature('first'), feature('unselected')], executor);
  queue.enqueue(['second', 'first']);
  assert.throws(() => queue.enqueue(['first']), /ejecución pendiente/);
  const first = () => queue.data.runs.find((run) => run.taskId === 'first');
  const second = () => queue.data.runs.find((run) => run.taskId === 'second');
  await until(() => first().status === 'review');
  // A dependent never builds on an unreviewed commit; waiting is idle, not a blocked queue.
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(second().status, 'queued');
  assert.equal(queue.data.paused, false);
  queue.action(first().id, 'reviewed');
  await until(() => second().status === 'review');
  assert.equal(maximum, 1);
  assert.deepEqual(calls, ['first:planner', 'first:implementer', 'first:validator', 'second:planner', 'second:implementer', 'second:validator']);
  assert.equal(queue.project().tasks.find((task) => task.id === 'unselected').sourceStatus, 'not_started');
});

test('dependencia no seleccionada bloquea la petición sin añadir trabajo', () => {
  const { queue } = setup([feature('first'), feature('second', ['first'])]);
  assert.throws(() => queue.enqueue(['second']), /seleccionar primero: first/);
  assert.equal(queue.data.runs.length, 0);
});

test('pausa permite acabar la feature activa, no comienza la siguiente', async () => {
  const { queue } = setup([feature('first'), feature('second')]);
  queue.enqueue(['first', 'second']);
  queue.pause();
  await until(() => !queue.active);
  assert.deepEqual(queue.data.runs.map((run) => run.status), ['review', 'queued']);
  queue.resume();
  await until(() => queue.data.runs[1].status === 'review');
});

test('reconecta proyecto, cola y evidencia tras reiniciar; no arranca sola', async () => {
  const { queue, statePath, cwd } = setup([feature('first'), feature('second')]);
  queue.enqueue(['first', 'second']);
  queue.pause();
  await until(() => !queue.active);
  const restored = new FeatureQueue({ store: new StateStore(statePath), executor: fakeExecutor(), piVersion: 'fixture' });
  assert.equal(restored.snapshot().project.path, cwd);
  assert.equal(restored.data.paused, true);
  assert.equal(restored.data.runs[0].steps.length, 3);
  assert.equal(restored.data.runs[1].status, 'queued');
  restored.resume();
  await until(() => restored.data.runs[1].status === 'review');
});

test('cancelación guarda bloqueo, pausa cola y permite reintentar sin duplicados', async () => {
  const { queue } = setup([feature()], async ({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
  }));
  queue.enqueue(['example']);
  queue.action(queue.data.runs[0].id, 'stop');
  await until(() => !queue.active);
  assert.equal(queue.data.runs[0].status, 'blocked');
  assert.equal(queue.data.paused, true);
  queue.executor = fakeExecutor();
  queue.action(queue.data.runs[0].id, 'retry');
  await until(() => queue.data.runs[0].status === 'review');
  assert.equal(queue.data.runs.length, 1);
});

test('HTTP: selección, ejecución, lectura de evidencia y origen externo rechazado', async (t) => {
  const cwd = fixture();
  const { server, queue } = createHarnessServer({ statePath: join(fixture(), 'state.json'), select: async () => inspectProject(cwd), executor: fakeExecutor(), piVersion: 'fixture' });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await queue.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body = {}, extra = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify(body) });
  assert.equal((await post('/api/projects/select', {}, { origin: 'https://outside.invalid' })).status, 403);
  const selected = await (await post('/api/projects/select')).json();
  assert.equal(selected.project.tasks.length, 1);
  assert.equal((await post('/api/queue', { taskIds: ['example'] })).status, 202);
  await until(() => queue.data.runs[0].status === 'review');
  const state = await (await fetch(`${base}/api/state`)).json();
  assert.equal(state.runs[0].steps.length, 3);
  assert.ok(state.runs[0].commit);
  assert.equal(state.runs[0].baseline, undefined);
});

test('un servidor no puede sobrescribir el estado de otro servidor vivo', async (t) => {
  const statePath = join(fixture(), 'state.json');
  const first = createHarnessServer({ statePath, piVersion: 'fixture' });
  first.server.listen(0, '127.0.0.1');
  await new Promise((resolve) => first.server.once('listening', resolve));
  t.after(async () => { await first.queue.close(); await new Promise((resolve) => first.server.close(resolve)); });
  assert.throws(() => createHarnessServer({ statePath, piVersion: 'fixture' }), /Ya hay un servidor/);
});

test('estado running se restaura como interrumpido y exige continuar explícitamente', () => {
  const { queue, statePath } = setup([feature()]);
  queue.pause();
  queue.enqueue(['example']);
  queue.data.runs[0].status = 'running';
  queue.save();
  const restored = new StateStore(statePath);
  assert.equal(restored.data.runs[0].status, 'interrupted');
  assert.equal(restored.data.paused, true);
});

test('pedir cambios en revisión humana relanza implementer → validator y hace un commit de corrección', async () => {
  const calls = [];
  const { queue, cwd } = setup([feature('first'), feature('second', ['first'])], fakeExecutor({ calls }));
  queue.enqueue(['first', 'second']);
  await until(() => queue.data.runs[0].status === 'review');
  assert.throws(() => queue.action(queue.data.runs[0].id, 'reject', { feedback: '  ' }), /Describe qué hay que cambiar/);
  queue.action(queue.data.runs[0].id, 'reject', { feedback: 'Cambia el texto del botón' });
  assert.equal(queue.data.runs[0].status, 'changes-requested');
  const rework = () => queue.data.runs.find((run) => run.reopen);
  await until(() => rework()?.status === 'review');
  assert.deepEqual(calls.slice(3), ['first:implementer', 'first:validator']);
  assert.equal(rework().steps[0].role, 'implementer');
  assert.equal(queue.data.runs.find((run) => run.taskId === 'second').status, 'queued');
  assert.match(git(cwd, 'log', '-1', '--format=%B'), /fix: address review of first/);
  assert.match(readFileSync(join(cwd, 'src/first.js'), 'utf8'), /Cambia el texto del botón/);
  assert.equal(queue.project().tasks.find((task) => task.id === 'first').sourceStatus, 'accepted');
  queue.action(rework().id, 'reviewed');
  await until(() => queue.data.runs.find((run) => run.taskId === 'second').status === 'review');
});

test('continuar una ejecución no deja estado a medias si otra sigue bloqueada', () => {
  const { queue } = setup([feature('first'), feature('second')]);
  queue.pause();
  queue.enqueue(['first', 'second']);
  for (const run of queue.data.runs) run.status = 'blocked';
  assert.throws(() => queue.action(queue.data.runs[0].id, 'retry'), /bloqueada/);
  assert.equal(queue.data.runs[0].status, 'blocked');
});

test('HTTP: content-type con charset, JSON inválido y rutas estáticas seguras', async (t) => {
  const { server, queue } = createHarnessServer({ statePath: join(fixture(), 'state.json'), piVersion: 'fixture' });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => { await queue.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body, type = 'application/json; charset=utf-8') => fetch(`${base}/api/queue/pause`, { method: 'POST', headers: { 'content-type': type }, body });
  assert.equal((await post('{}')).status, 200);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post('{}', 'text/plain')).status, 415);
  const first = await fetch(`${base}/api/state`);
  const tag = first.headers.get('etag');
  assert.ok(tag);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'if-none-match': tag } })).status, 304);
  assert.equal((await fetch(`${base}/`)).headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal((await fetch(`${base}/ui/board.js`)).status, 200);
  assert.equal((await fetch(`${base}/..%2Fserver.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/package.json`)).status, 404);
});
