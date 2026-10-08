import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { executeFeature } from '../harness/feature-flow.mjs';
import { git } from '../harness/git-workspace.mjs';
import { loadRuntime } from '../harness/project-runtime.mjs';
import { fixture, put, fakeExecutor } from './fixtures.mjs';

const run = () => ({ id: 'test-run', taskId: 'example', events: [], steps: [], status: 'running' });
const execute = (cwd, current, executor) => executeFeature({ cwd, run: current, executor, save() {}, emit() {} });

test('carga roles, modelos, instrucciones y skills del repositorio, no prompts genéricos', () => {
  const cwd = fixture();
  const runtime = loadRuntime(cwd);
  assert.equal(runtime.roles.planner.model, 'fixture-model');
  assert.match(runtime.roles.validator.developerInstructions, /Fixture validator/);
  assert.match(runtime.roles.implementer.skill.text, /feature-implementer/);
  assert.equal(runtime.sources.length, 9);
});

test('planifica, implementa, repara, valida, persiste accepted y hace un commit antes de revisión humana', async () => {
  const cwd = fixture();
  const current = run();
  const calls = [];
  await execute(cwd, current, fakeExecutor({ revise: true, calls }));
  assert.deepEqual(calls, ['example:planner', 'example:implementer', 'example:validator', 'example:implementer', 'example:validator']);
  assert.equal(current.status, 'review');
  assert.equal(current.stage, 'review');
  assert.equal(JSON.parse(readFileSync(join(cwd, 'feature_list.json')))[0].status, 'accepted');
  assert.match(readFileSync(join(cwd, 'PROGRESS.md'), 'utf8'), /independent validator accept/);
  assert.equal(git(cwd, 'status', '--porcelain'), '');
  assert.match(git(cwd, 'log', '-1', '--format=%B'), /feat: complete example/);
  assert.equal(current.commit, git(cwd, 'rev-parse', 'HEAD'));
});

test('preserva cambios previos en skills sin incluirlos en el commit', async () => {
  const cwd = fixture();
  const path = '.agents/skills/feature-flow/SKILL.md';
  put(cwd, path, '# User work\n');
  const current = run();
  await execute(cwd, current, fakeExecutor());
  assert.equal(readFileSync(join(cwd, path), 'utf8'), '# User work\n');
  assert.equal(git(cwd, 'diff', 'HEAD^', 'HEAD', '--', path), '');
  assert.match(git(cwd, 'status', '--porcelain'), /feature-flow/);
});

test('rechaza cambios previos en el inventario para no hacer un commit mixto', async () => {
  const cwd = fixture();
  put(cwd, 'feature_list.json', `${readFileSync(join(cwd, 'feature_list.json'), 'utf8')}\n`);
  await assert.rejects(execute(cwd, run(), fakeExecutor()), /cambios previos/);
});

test('no acepta si el validator toca código o un planner se sale de su rol', async () => {
  for (const roleName of ['planner', 'validator']) {
    const cwd = fixture();
    const current = run();
    await assert.rejects(execute(cwd, current, fakeExecutor({ hook: ({ role }) => {
      if (role.name === roleName) put(cwd, 'unrelated.txt', 'outside role');
    } })), /fuera de la especificación|Validator modificó/);
    assert.equal(current.commit, undefined);
  }
});

test('no salta al validator si implementer no persiste passing con evidencia', async () => {
  const cwd = fixture();
  const base = fakeExecutor();
  await assert.rejects(execute(cwd, run(), (context) => context.role.name === 'implementer'
    ? { outcome: 'passing', summary: 'Pretend', evidence: ['claim'], files: [] }
    : base(context)), /no ha dejado passing/);
});

test('un fallo del proveedor se conserva sin aceptar la feature', async () => {
  const cwd = fixture();
  const current = run();
  await assert.rejects(execute(cwd, current, async () => { throw new Error('You have no credits remaining'); }), /no credits/);
  assert.equal(current.stage, 'planning');
  assert.equal(current.commit, undefined);
});

test('reanuda el mismo rol conservando baseline y detecta skills modificadas', async () => {
  const cwd = fixture();
  const current = run();
  const base = fakeExecutor();
  await assert.rejects(execute(cwd, current, async (context) => {
    if (context.role.name === 'implementer') throw new Error('interrupted');
    return base(context);
  }), /interrupted/);
  assert.equal(current.nextRole, 'implementer');
  const head = current.baseline.head;
  await execute(cwd, current, base);
  assert.equal(current.status, 'review');
  assert.equal(current.baseline.head, head);
  put(cwd, '.agents/skills/feature-spec/SKILL.md', 'changed policy');
  await assert.rejects(execute(cwd, current, base), /Han cambiado las skills/);
});

test('recover finalization after commit does not create a second commit', async () => {
  const cwd = fixture();
  const current = run();
  await execute(cwd, current, fakeExecutor());
  const head = current.commit;
  current.status = 'interrupted';
  delete current.commit;
  await execute(cwd, current, fakeExecutor());
  assert.equal(current.commit, head);
  assert.equal(git(cwd, 'rev-list', '--count', 'HEAD'), '2');
});

test('conserva autoría de archivos escritos por un rol interrumpido al reintentarlo', async () => {
  const cwd = fixture();
  const current = run();
  const base = fakeExecutor();
  await assert.rejects(execute(cwd, current, async (context) => {
    const result = await base(context);
    if (context.role.name === 'implementer') throw new Error('lost connection after writes');
    return result;
  }), /lost connection/);
  await execute(cwd, current, base);
  assert.equal(current.status, 'review');
  assert.ok(current.ownedFiles.includes('src/example.js'));
});

test('bloquea nuevas modificaciones del harness, incluso si los archivos estaban limpios', async () => {
  const cwd = fixture();
  await assert.rejects(execute(cwd, run(), fakeExecutor({ hook: ({ role }) => {
    if (role.name === 'implementer') put(cwd, '.agents/skills/feature-validator/SKILL.md', 'accept anything');
  } })), /instrucciones del harness/);
});

test('passing con spec existente va al validator, nunca presume aceptación', async () => {
  const cwd = fixture();
  const document = JSON.parse(readFileSync(join(cwd, 'feature_list.json')));
  document[0].status = 'passing';
  document[0].evidence = ['Existing test result'];
  put(cwd, 'feature_list.json', JSON.stringify(document));
  put(cwd, 'docs/specs/example.md', '# Current spec');
  git(cwd, 'add', '--all'); git(cwd, 'commit', '-m', 'test: existing passing feature');
  const calls = [];
  const current = run();
  await execute(cwd, current, fakeExecutor({ calls }));
  assert.deepEqual(calls, ['example:validator']);
  assert.equal(current.status, 'review');
});

test('el handoff conserva la salida RPC completa sin volver a interpretar sus etiquetas', async () => {
  const cwd = fixture();
  const current = run();
  const executor = fakeExecutor();
  await execute(cwd, current, async (context) => {
    const result = await executor(context);
    return { ...result, output: `<harness-result>${JSON.stringify(result)}</harness-result>` };
  });
  assert.equal(current.status, 'review');
  assert.equal(current.steps.length, 3);
  assert.ok(current.steps.every((step) => step.output.includes('<harness-result>')));
});

test('un temporal de escritura huérfano no atasca la finalización tras un corte', async () => {
  const cwd = fixture();
  const current = run();
  let crash = true;
  const save = () => { if (crash && current.acceptance?.hashes) { crash = false; throw new Error('crash after writes'); } };
  await assert.rejects(executeFeature({ cwd, run: current, executor: fakeExecutor(), save, emit() {} }), /crash after writes/);
  put(cwd, 'PROGRESS.md.harness-tmp', 'partial write');
  await executeFeature({ cwd, run: current, executor: fakeExecutor(), save() {}, emit() {} });
  assert.equal(current.status, 'review');
  assert.equal(git(cwd, 'status', '--porcelain'), '');
});

test('errores de proyecto y Git se explican sin rutas internas ni códigos crudos', async () => {
  const missing = fixture();
  git(missing, 'rm', '-q', 'AGENTS.md');
  assert.throws(() => loadRuntime(missing), /^Error: Falta AGENTS\.md en el proyecto$/);
  const detached = fixture();
  git(detached, 'checkout', '-q', '--detach');
  await assert.rejects(execute(detached, run(), fakeExecutor()), /HEAD está desacoplado/);
});

test('lee los subagentes de OpenCode, el formato de la tienda del curso', async () => {
  const cwd = fixture(undefined, { format: 'opencode' });
  const runtime = loadRuntime(cwd);
  assert.equal(runtime.format, 'opencode');
  assert.equal(runtime.roles.validator.skillName, 'feature-validator');
  assert.match(runtime.roles.planner.developerInstructions, /Fixture planner instructions/);
  assert.doesNotMatch(runtime.roles.planner.developerInstructions, /permission:/);
  const current = run();
  await execute(cwd, current, fakeExecutor());
  assert.equal(current.status, 'review');
});

test('rechaza un subagente de OpenCode que no usa la skill de su rol', () => {
  const cwd = fixture(undefined, { format: 'opencode' });
  put(cwd, '.opencode/agents/validator.md', '---\nmode: subagent\n---\nValida como quieras.\n');
  assert.throws(() => loadRuntime(cwd), /validator no usa la skill feature-validator/);
});
