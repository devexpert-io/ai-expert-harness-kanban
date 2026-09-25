import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { git } from '../harness/git-workspace.mjs';
import { fixture, feature } from './fixtures.mjs';

// The teaching harness runs end to end against the rehearsal Pi, so the class material cannot rot.
const directory = fileURLToPath(new URL('../examples/mini-harness/', import.meta.url));
const env = { ...process.env, PI_BIN: join(directory, 'fake-pi.mjs'), FAKE_PI_DELAY: '0' };
const step = (name, ...args) => execFileSync(process.execPath, [join(directory, name), ...args], { env, encoding: 'utf8' });

test('mini-harness paso 4: cola con dependencias y commits que solo llevan lo de cada feature', () => {
  const project = fixture([feature('search'), feature('filters', ['search'])]);
  writeFileSync(join(project, 'notas.txt'), 'trabajo ajeno');
  const output = step('04-el-host-decide.mjs', project);
  assert.match(output, /✔ search aceptada[^]*✔ filters aceptada/);
  assert.deepEqual(git(project, 'log', '--format=%s').split('\n'), ['feat: complete filters', 'feat: complete search', 'test: fixture baseline']);
  assert.equal(git(project, 'status', '--porcelain'), '?? notas.txt');
});

test('mini-harness paso 5: las features listas avanzan en paralelo en sus worktrees', () => {
  const project = fixture([feature('search'), feature('cart'), feature('filters', ['search'])]);
  const output = step('05-paralelo-y-pr.mjs', project);
  assert.match(output, /Listas en paralelo: search, cart/);
  assert.match(git(project, 'branch', '--list', 'feat/*'), /feat\/cart[^]*feat\/search/);
  assert.equal(git(project, 'rev-list', '--count', 'main'), '1');
});

test('el Kanban completa una feature con el adaptador Pi real contra el Pi de ensayo', async () => {
  const { FeatureQueue } = await import('../harness/queue.mjs');
  const { StateStore } = await import('../harness/state-store.mjs');
  const { inspectProject } = await import('../harness/project-contract.mjs');
  const { until } = await import('./fixtures.mjs');
  const project = fixture([feature('search')]);
  const queue = new FeatureQueue({ store: new StateStore(join(fixture(), 'state.json')), piVersion: 'fake', piOptions: { piBin: env.PI_BIN, env } });
  queue.select(inspectProject(project));
  queue.enqueue(['search']);
  await until(() => ['review', 'blocked'].includes(queue.data.runs[0].status), 20_000);
  assert.equal(queue.data.runs[0].error ?? null, null);
  assert.deepEqual(queue.data.runs[0].steps.map((item) => item.role), ['planner', 'implementer', 'validator']);
  assert.ok(queue.data.runs[0].events.some((event) => event.message === 'write · src/search.js'));
  await queue.close();
});
