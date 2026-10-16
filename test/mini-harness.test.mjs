import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
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

const harness = (...args) => spawnSync(process.execPath, [join(directory, 'harness.mjs'), ...args], { env, encoding: 'utf8', timeout: 20_000 });

test('mini-harness: sin proyecto enlazado explica cómo enlazarlo, sin traza', () => {
  const run = harness('--proyecto', '/tmp');
  assert.equal(run.status, 1);
  assert.match(run.stderr, /No hay feature_list.json en \/tmp/);
  assert.doesNotMatch(run.stderr, /at /);
});

test('mini-harness: el flujo lleva la siguiente feature de planner a commit; tu proyecto no se toca', () => {
  const project = fixture([feature('search'), feature('filters', ['search'])]);
  const run = harness('--proyecto', project, '--ensayo');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /▶ planner[^]*✓ solo toca su spec[^]*▶ implementer[^]*✓ no cambia la spec[^]*▶ validator[^]*✓ no modifica nada[^]*✔ search aceptada/);
  assert.doesNotMatch(run.stdout, /filters/);
  const copy = copyOf(run.stdout);
  assert.deepEqual(git(copy, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['PROGRESS.md', 'docs/specs/search.md', 'feature_list.json', 'src/search.js']);
  assert.equal(JSON.parse(readFileSync(join(copy, 'feature_list.json'), 'utf8'))[0].status, 'accepted');
  assert.match(git(copy, 'show', '--numstat', '--format=', 'HEAD', '--', 'feature_list.json'), /^\d\t[1-3]\tfeature_list\.json$/);
  assert.equal(git(copy, 'status', '--porcelain'), '');
  assert.equal(git(project, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(git(project, 'status', '--porcelain'), '');
});

for (const [role, rule] of [['planner', 'solo toca su spec'], ['implementer', 'no cambia la spec'], ['validator', 'no modifica nada']]) {
  test(`mini-harness: la trampa del ${role} la para «${rule}», sin commit`, () => {
    const project = fixture([feature('search')]);
    const run = harness('--proyecto', project, '--trampa', role);
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, new RegExp(`✕ ${role}: ${rule}[^]*El host para aquí: no hay commit`));
    assert.equal(git(copyOf(run.stdout), 'rev-list', '--count', 'HEAD'), '1');
  });
}

test('mini-harness: la trampa de la dependencia pasa las reglas de serie; con una regla tuya, no', async () => {
  const project = fixture([feature('search')]);
  const run = harness('--proyecto', project, '--trampa', 'dependencia');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(git(copyOf(run.stdout), 'show', '--name-only', '--format=', 'HEAD'), /package\.json/);

  const { completar, reglas } = await import('../examples/mini-harness/harness.mjs');
  const saved = { PI_BIN: process.env.PI_BIN, FAKE_PI_DELAY: process.env.FAKE_PI_DELAY, FAKE_PI_TRAMPA: process.env.FAKE_PI_TRAMPA };
  Object.assign(process.env, { PI_BIN: env.PI_BIN, FAKE_PI_DELAY: '0', FAKE_PI_TRAMPA: 'dependencia' });
  reglas.todos.push(['no toca package.json', (c) => !c.tocados.includes('package.json')]); // la línea que escribe el alumno
  try {
    await assert.rejects(completar(fixture([feature('search')]), feature('search')), /implementer: no toca package\.json/);
  } finally {
    reglas.todos.pop();
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test('mini-harness: --hasta para después de ese rol, sin commit', () => {
  const project = fixture([feature('search')]);
  const run = harness('--proyecto', project, '--ensayo', '--hasta', 'planner');
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.match(run.stdout, /▶ planner[^]*■ El flujo ha parado antes del commit/);
  assert.doesNotMatch(run.stdout, /▶ implementer/);
  assert.equal(git(copyOf(run.stdout), 'status', '--porcelain', '--untracked-files=all'), '?? docs/specs/search.md');
});

test('mini-harness: un paso de la tabla puede esperar a una persona', async () => {
  const project = fixture([feature('search')]);
  const { completar, siguiente } = await import('../examples/mini-harness/harness.mjs');
  const original = siguiente.planner;
  const saved = { PI_BIN: process.env.PI_BIN, FAKE_PI_DELAY: process.env.FAKE_PI_DELAY };
  Object.assign(process.env, { PI_BIN: env.PI_BIN, FAKE_PI_DELAY: '0' });
  const asked = [];
  siguiente.planner = async (result) => { asked.push(result.outcome); return 'parar'; };
  try {
    assert.equal(await completar(project, feature('search')), null);
    assert.deepEqual(asked, ['ready']);
    assert.equal(git(project, 'rev-list', '--count', 'HEAD'), '1');
  } finally {
    siguiente.planner = original;
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : (process.env[key] = value);
  }
});

test('mini-harness: la copia recoge tus cambios sin commitear, como una regla nueva', () => {
  const project = fixture([feature('search')], { format: 'opencode' });
  writeFileSync(join(project, '.opencode/agents/planner.md'), '---\nmode: subagent\npermission:\n  edit: deny\n---\nUse $feature-spec.\n');
  assert.match(step('permisos.mjs', '--proyecto', project, '--probar', 'planner', 'edit', 'docs/specs/search.md'), /✕ edit «deny»/);
  const output = step('permisos.mjs', '--proyecto', project);
  assert.match(readFileSync(join(copyOf(output), '.opencode/agents/planner.md'), 'utf8'), /edit: deny/);
});

test('mini-harness: la extensión de permisos para lo que el planner no puede hacer', () => {
  const role = '---\nmode: subagent\npermission:\n  edit:\n    "*": deny\n    "docs/specs/*": allow\n  bash: deny\n---\nUse $feature-spec.\n';
  const enforced = fixture([feature('search')], { format: 'opencode' });
  const loose = fixture([feature('search')], { format: 'opencode' });
  for (const project of [enforced, loose]) { writeFileSync(join(project, '.opencode/agents/planner.md'), role); git(project, 'commit', '-qam', 'test: planner permissions'); }
  assert.match(step('permisos.mjs', '--proyecto', enforced), /bloqueadas por el arnés: 2[^]*Cambios fuera de docs\/specs\/: ninguno/);
  assert.match(step('permisos.mjs', '--proyecto', loose, '--sin-permisos'), /bloqueadas por el arnés: 0[^]*Cambios fuera de docs\/specs\/: src\/app\/page.tsx/);
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
