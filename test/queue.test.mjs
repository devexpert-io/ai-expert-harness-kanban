import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { FeatureQueue } from '../harness/queue.mjs';
import { StateStore } from '../harness/state-store.mjs';
import { inspectProject } from '../harness/project-contract.mjs';
import { git } from '../harness/git-workspace.mjs';
import { fixture, feature, fakeExecutor, until } from './fixtures.mjs';

export function setup(features, executor, options = {}) {
  const cwd = fixture(features);
  const statePath = join(fixture(), 'state.json');
  const queue = new FeatureQueue({ store: new StateStore(statePath), executor: executor ?? fakeExecutor(), piVersion: 'fixture', ...options });
  queue.select(inspectProject(cwd));
  return { cwd, statePath, queue };
}
const byTask = (queue, id) => [...queue.data.runs].reverse().find((run) => run.taskId === id);
const statusOf = (queue) => Object.fromEntries(queue.data.runs.map((run) => [run.taskId, run.status]));

test('features independientes avanzan en paralelo, cada una en su rama y worktree', async () => {
  let active = 0;
  let maximum = 0;
  const executor = fakeExecutor({ hook: async () => { maximum = Math.max(maximum, ++active); await new Promise((resolve) => setTimeout(resolve, 20)); active--; } });
  const { queue, cwd } = setup([feature('first'), feature('second'), feature('third')], executor, { maxParallel: 2 });
  queue.enqueue(['first', 'second', 'third']);
  await until(() => queue.data.runs.every((run) => run.status === 'review'));
  assert.equal(maximum, 2);
  const runs = queue.data.runs;
  assert.deepEqual(runs.map((run) => run.branch), ['feat/first', 'feat/second', 'feat/third']);
  assert.equal(new Set(runs.map((run) => run.worktree)).size, 3);
  for (const run of runs) assert.match(git(run.worktree, 'log', '-1', '--format=%s'), new RegExp(`feat: complete ${run.taskId}`));
  // The person's checkout is untouched until they approve.
  assert.equal(git(cwd, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(cwd, 'status', '--porcelain'), '');
});

test('una dependiente espera al merge humano y parte de una base que ya lo contiene', async () => {
  const calls = [];
  const { queue, cwd } = setup([feature('second', ['first']), feature('first'), feature('unselected')], fakeExecutor({ calls }));
  queue.enqueue(['second', 'first']);
  assert.throws(() => queue.enqueue(['first']), /ejecución pendiente/);
  await until(() => byTask(queue, 'first').status === 'review');
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(byTask(queue, 'second').status, 'queued');
  queue.action(byTask(queue, 'first').id, 'merge');
  assert.equal(byTask(queue, 'first').status, 'done');
  assert.equal(existsSync(byTask(queue, 'first').worktree), false);
  assert.equal(inspectProject(cwd).tasks.find((task) => task.id === 'first').sourceStatus, 'accepted');
  await until(() => byTask(queue, 'second').status === 'review');
  assert.ok(existsSync(join(byTask(queue, 'second').worktree, 'src/first.js')));
  assert.deepEqual(calls, ['first:planner', 'first:implementer', 'first:validator', 'second:planner', 'second:implementer', 'second:validator']);
  assert.equal(inspectProject(cwd).tasks.find((task) => task.id === 'unselected').sourceStatus, 'not_started');
});

test('al integrar una rama, las demás se actualizan combinando feature_list.json y PROGRESS.md', async () => {
  const { queue, cwd } = setup([feature('first'), feature('second')]);
  queue.enqueue(['first', 'second']);
  await until(() => queue.data.runs.every((run) => run.status === 'review'));
  queue.action(byTask(queue, 'first').id, 'merge');
  const second = byTask(queue, 'second');
  assert.ok(second.events.some((event) => /Rama actualizada con la base \(estado combinado en .*PROGRESS.md/.test(event.message)));
  queue.action(second.id, 'merge');
  const tasks = inspectProject(cwd).tasks;
  assert.deepEqual(tasks.map((task) => task.sourceStatus), ['accepted', 'accepted']);
  const progress = readFileSync(join(cwd, 'PROGRESS.md'), 'utf8');
  assert.match(progress, /## first · independent validator accept/);
  assert.match(progress, /## second · independent validator accept/);
  assert.equal(git(cwd, 'status', '--porcelain'), '');
});

test('pedir cambios relanza implementer → validator en la misma rama y hace un commit de corrección', async () => {
  const calls = [];
  const { queue, cwd } = setup([feature('first'), feature('second', ['first'])], fakeExecutor({ calls }));
  queue.enqueue(['first', 'second']);
  await until(() => byTask(queue, 'first').status === 'review');
  const original = byTask(queue, 'first');
  assert.throws(() => queue.action(original.id, 'reject', { feedback: '  ' }), /Describe qué hay que cambiar/);
  queue.action(original.id, 'reject', { feedback: 'Cambia el texto del botón' });
  assert.equal(original.status, 'changes-requested');
  const rework = () => queue.data.runs.find((run) => run.reopen);
  await until(() => rework()?.status === 'review');
  assert.deepEqual(calls.slice(3), ['first:implementer', 'first:validator']);
  assert.equal(rework().branch, original.branch);
  assert.match(git(rework().worktree, 'log', '-1', '--format=%s'), /fix: address review of first/);
  assert.match(readFileSync(join(rework().worktree, 'src/first.js'), 'utf8'), /Cambia el texto del botón/);
  assert.equal(byTask(queue, 'second').status, 'queued');
  queue.action(rework().id, 'merge');
  assert.match(git(cwd, 'log', '--format=%s'), /fix: address review of first/);
  await until(() => byTask(queue, 'second').status === 'review');
});

test('un bloqueo no detiene al resto; cancelar y continuar no duplica la ejecución', async () => {
  const executor = async (context) => context.task.id === 'slow'
    ? new Promise((resolve, reject) => context.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true }))
    : fakeExecutor()(context);
  const { queue } = setup([feature('slow'), feature('fast')], executor);
  queue.enqueue(['slow', 'fast']);
  await until(() => byTask(queue, 'fast').status === 'review');
  queue.action(byTask(queue, 'slow').id, 'stop');
  await until(() => byTask(queue, 'slow').status === 'blocked');
  assert.equal(queue.data.paused, false);
  queue.executor = fakeExecutor();
  queue.action(byTask(queue, 'slow').id, 'retry');
  await until(() => byTask(queue, 'slow').status === 'review');
  assert.equal(queue.data.runs.length, 2);
});

test('pausa deja terminar lo activo y no empieza nada nuevo', async () => {
  const { queue } = setup([feature('first'), feature('second')], undefined, { maxParallel: 1 });
  queue.enqueue(['first', 'second']);
  queue.pause();
  await until(() => !queue.active.size);
  assert.deepEqual(statusOf(queue), { first: 'review', second: 'queued' });
  queue.resume();
  await until(() => byTask(queue, 'second').status === 'review');
});

test('reconecta proyecto, cola y evidencia tras reiniciar; no arranca sola', async () => {
  const { queue, statePath, cwd } = setup([feature('first'), feature('second')], undefined, { maxParallel: 1 });
  queue.enqueue(['first', 'second']);
  queue.pause();
  await until(() => !queue.active.size);
  const restored = new FeatureQueue({ store: new StateStore(statePath), executor: fakeExecutor(), piVersion: 'fixture' });
  assert.equal(restored.snapshot().project.path, cwd);
  assert.equal(restored.snapshot().review.mode, 'local');
  assert.equal(restored.data.paused, true);
  assert.equal(restored.data.runs[0].steps.length, 3);
  restored.resume();
  await until(() => restored.data.runs[1].status === 'review');
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

test('la clave configurada llega al entorno de Pi sin estar en el estado', async () => {
  let seen;
  const credentials = { status: () => ({ configured: true, source: 'ui' }), env: () => ({ DEVEXPERT_API_KEY: 'sk-fixture' }) };
  const base = fakeExecutor();
  const { queue, statePath } = setup([feature()], (context) => { seen = context.env?.DEVEXPERT_API_KEY; return base(context); }, { credentials });
  queue.enqueue(['example']);
  await until(() => queue.data.runs[0].status === 'review');
  assert.equal(seen, 'sk-fixture');
  assert.doesNotMatch(readFileSync(statePath, 'utf8'), /sk-fixture/);
});

test('una ruta de estado relativa no separa el worktree que crea git del que busca el harness', async () => {
  const cwd = fixture([feature()]);
  const home = fixture();
  const previous = process.cwd();
  process.chdir(home);
  try {
    const queue = new FeatureQueue({ store: new StateStore('.harness-data/ensayo/state.json'), executor: fakeExecutor(), piVersion: 'fixture' });
    queue.select(inspectProject(cwd));
    queue.enqueue(['example']);
    await until(() => ['review', 'blocked'].includes(queue.data.runs[0].status));
    assert.equal(queue.data.runs[0].error ?? null, null);
    assert.ok(queue.data.runs[0].worktree.startsWith(realpathSync(home)));
    assert.equal(existsSync(join(cwd, '.harness-data')), false);
  } finally { process.chdir(previous); }
});

test('continuar desde este paso reanuda una cola pausada por un reinicio', async () => {
  const { queue, statePath } = setup([feature()], async () => { throw new Error('proveedor caído'); });
  queue.enqueue(['example']);
  await until(() => queue.data.runs[0].status === 'blocked');
  await queue.close(); // shutdown pauses the queue on purpose
  const restored = new FeatureQueue({ store: new StateStore(statePath), executor: fakeExecutor(), piVersion: 'fixture' });
  assert.equal(restored.data.paused, true);
  restored.action(restored.data.runs[0].id, 'retry');
  await until(() => restored.data.runs[0].status === 'review');
  assert.equal(restored.data.paused, false);
});
