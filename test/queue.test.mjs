import assert from 'node:assert/strict';
import { join } from 'node:path';
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
  await until(() => queue.data.runs.every((run) => run.status === 'review'));
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
