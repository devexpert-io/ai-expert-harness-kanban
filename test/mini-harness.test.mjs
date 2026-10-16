import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { git } from '../harness/git-workspace.mjs';
import { fixture, feature } from './fixtures.mjs';

// The teaching harness runs end to end against the rehearsal Pi, so the class material cannot rot.
const directory = fileURLToPath(new URL('../examples/mini-harness/', import.meta.url));
const env = { ...process.env, PI_BIN: join(directory, 'fake-pi.mjs'), FAKE_PI_DELAY: '0' };
const step = (name, ...args) => execFileSync(process.execPath, [join(directory, name), ...args], { env, encoding: 'utf8' });

const copyOf = (output) => output.match(/Copia de trabajo: (.+)/)[1].trim();

test('mini-harness: sin proyecto enlazado explica cómo enlazarlo, sin traza', () => {
  assert.throws(() => execFileSync(process.execPath, [join(directory, '03-la-cola.mjs'), '--proyecto', '/tmp'], { env, encoding: 'utf8', stdio: 'pipe' }), /No hay feature_list.json en \/tmp/);
});

test('mini-harness paso 2: el loop lleva la siguiente feature lista de planner a accept', () => {
  const project = fixture([feature('search'), feature('filters', ['search'])]);
  const output = execFileSync(process.execPath, [join(directory, '02-el-loop.mjs'), '--proyecto', project], { env, encoding: 'utf8', timeout: 20_000 });
  assert.match(output, /▶ planner[^]*▶ implementer[^]*▶ validator[^]*✔ aceptada por el validator/);
  assert.doesNotMatch(output, /filters/);
});

test('mini-harness paso 3: el commit ingenuo se lleva las notas privadas; tu proyecto no se toca', () => {
  const project = fixture([feature('search'), feature('filters', ['search'])]);
  const output = step('03-la-cola.mjs', '--proyecto', project);
  assert.match(output, /✔ search aceptada[^]*⚠ notas-privadas.txt se ha colado/);
  assert.doesNotMatch(output, /filters aceptada/);
  assert.match(git(copyOf(output), 'show', '--name-only', '--format=', 'HEAD'), /notas-privadas.txt/);
  assert.equal(git(project, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(project, 'status', '--porcelain'), '');
});

test('mini-harness paso 4: cola con dependencias y commits que solo llevan lo de cada feature', () => {
  const project = fixture([feature('search'), feature('filters', ['search'])]);
  const output = step('04-el-host-decide.mjs', '--proyecto', project, '--todas');
  assert.match(output, /✔ search aceptada[^]*✓ notas-privadas.txt se ha quedado fuera[^]*✔ filters aceptada/);
  const copy = copyOf(output);
  assert.deepEqual(git(copy, 'log', '--format=%s').split('\n'), ['feat: complete filters', 'feat: complete search', 'test: fixture baseline']);
  assert.equal(git(copy, 'status', '--porcelain'), '?? notas-privadas.txt');
});

test('mini-harness: la copia recoge tus cambios sin commitear, como una regla nueva', () => {
  const project = fixture([feature('search')], { format: 'opencode' });
  writeFileSync(join(project, '.opencode/agents/planner.md'), '---\nmode: subagent\npermission:\n  edit: deny\n---\nUse $feature-spec.\n');
  assert.match(step('05-el-motor-respeta.mjs', '--proyecto', project, '--probar', 'planner', 'edit', 'docs/specs/search.md'), /✕ edit «deny»/);
  const output = step('05-el-motor-respeta.mjs', '--proyecto', project);
  assert.match(readFileSync(join(copyOf(output), '.opencode/agents/planner.md'), 'utf8'), /edit: deny/);
});

test('mini-harness paso 6: las features listas avanzan en paralelo en sus worktrees', () => {
  const project = fixture([feature('search'), feature('cart'), feature('filters', ['search'])]);
  const output = step('06-paralelo-y-pr.mjs', '--proyecto', project);
  assert.match(output, /Listas en paralelo: search, cart/);
  assert.match(git(copyOf(output), 'branch', '--list', 'feat/*'), /feat\/cart[^]*feat\/search/);
  assert.equal(git(project, 'branch', '--list', 'feat/*'), '');
});

test('mini-harness paso 5: la extensión de permisos para lo que el planner no puede hacer', () => {
  const role = '---\nmode: subagent\npermission:\n  edit:\n    "*": deny\n    "docs/specs/*": allow\n  bash: deny\n---\nUse $feature-spec.\n';
  const enforced = fixture([feature('search')], { format: 'opencode' });
  const loose = fixture([feature('search')], { format: 'opencode' });
  for (const project of [enforced, loose]) { writeFileSync(join(project, '.opencode/agents/planner.md'), role); git(project, 'commit', '-qam', 'test: planner permissions'); }
  assert.match(step('05-el-motor-respeta.mjs', '--proyecto', enforced), /bloqueadas por el arnés: 2[^]*Cambios fuera de docs\/specs\/: ninguno/);
  assert.match(step('05-el-motor-respeta.mjs', '--proyecto', loose, '--sin-permisos'), /bloqueadas por el arnés: 0[^]*Cambios fuera de docs\/specs\/: src\/app\/page.tsx/);
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
