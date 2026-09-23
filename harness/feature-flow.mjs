import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { inspectProject } from './project-contract.mjs';
import { loadRuntime, roleStages, digest } from './project-runtime.mjs';
import { runPiRole, validateRoleResult } from './pi-role.mjs';
import { pinnedPi } from './pi-config.mjs';
import { assertWorkspace, featureChanges, fileHash, git, sameSnapshot, scopedCommit, snapshot, startWorkspace } from './git-workspace.mjs';

function atomicText(path, text) {
  const temporary = `${path}.harness-tmp`;
  writeFileSync(temporary, text, { flag: 'wx' });
  renameSync(temporary, path);
}
function readFeatures(cwd) { return JSON.parse(readFileSync(join(cwd, 'feature_list.json'), 'utf8')); }
function taskNow(cwd, id) {
  const task = inspectProject(cwd).tasks.find((item) => item.id === id);
  if (!task) throw new Error(`La feature ${id} ya no existe`);
  return task;
}
function checkInventory(cwd, run) {
  const current = readFeatures(cwd);
  if (current.length !== run.inventory.length) throw new Error('El subagente ha cambiado el inventario de features');
  for (let index = 0; index < current.length; index++) {
    const original = run.inventory[index];
    const item = current[index];
    const stable = (feature) => Object.fromEntries(Object.entries(feature).filter(([key]) => !['status', 'evidence', 'notes'].includes(key)));
    if (!isDeepStrictEqual(item.id === run.taskId ? stable(item) : item, original.id === run.taskId ? stable(original) : original)) throw new Error('El subagente ha modificado el contrato o una feature fuera de alcance');
  }
}

async function finalize({ run, cwd, save, emit }) {
  const acceptance = run.acceptance;
  // Recover the narrow crash window after our commit and before recording its hash.
  const head = git(cwd, 'rev-parse', 'HEAD');
  if (head !== run.baseline.head) {
    const message = git(cwd, 'log', '-1', '--format=%B');
    if (message !== acceptance.message || git(cwd, 'rev-parse', 'HEAD^') !== run.baseline.head) throw new Error('HEAD cambió antes del commit de aceptación; revisa Git antes de continuar');
    for (const [path, hash] of Object.entries(acceptance.hashes)) {
      if (fileHash(cwd, path) !== hash) throw new Error(`La aceptación ya no coincide con ${path}`);
    }
    run.commit = head;
  } else {
    assertWorkspace(cwd, run.baseline);
    if (featureChanges(cwd, run.baseline).some((path) => !acceptance.files.includes(path))) throw new Error('Hay cambios nuevos después de la validación; revisa antes de continuar');
    for (const [path, hash] of Object.entries(acceptance.beforeHashes)) {
      const expectedDocument = acceptance.documents[path];
      const alreadyWritten = expectedDocument !== undefined && existsSync(join(cwd, path)) && readFileSync(join(cwd, path), 'utf8') === expectedDocument;
      if (!alreadyWritten && fileHash(cwd, path) !== hash) throw new Error(`Cambió ${path} después de la validación; no se hará commit`);
    }
    // Values are persisted before writes, so a restart can finish without duplicating evidence.
    for (const [path, content] of Object.entries(acceptance.documents)) {
      if (!existsSync(join(cwd, path)) || readFileSync(join(cwd, path), 'utf8') !== content) atomicText(join(cwd, path), content);
    }
    acceptance.hashes = Object.fromEntries(acceptance.files.map((path) => [path, fileHash(cwd, path)]));
    save();
    run.commit = scopedCommit(cwd, acceptance.files, acceptance.message);
  }
  run.stage = 'review';
  run.status = 'review';
  run.error = null;
  save();
  emit({ message: `Aceptación independiente y commit ${run.commit.slice(0, 8)}. Pendiente de revisión humana; sin push ni merge.` });
}

export async function executeFeature({ run, cwd, signal, save, emit, executor = runPiRole, piOptions = {}, maxRepairs = 3 }) {
  const runtime = loadRuntime(cwd);
  if (run.runtimeHash && run.runtimeHash !== runtime.fingerprint) throw new Error('Han cambiado las skills o los subagentes durante la ejecución. Revisa la ejecución antes de descartarla y empezar otra');
  if (!run.baseline) {
    run.baseline = startWorkspace(cwd);
    run.inventory = readFeatures(cwd);
    run.runtimeHash = runtime.fingerprint;
    run.sources = runtime.sources;
    run.ownedFiles = [];
    run.steps = [];
    save();
  }
  if (run.acceptance) return finalize({ run, cwd, save, emit });
  assertWorkspace(cwd, run.baseline);
  checkInventory(cwd, run);
  let task = taskNow(cwd, run.taskId);
  const spec = `docs/specs/${task.id}.md`;
  const featureIdentity = digest(JSON.stringify({ id: task.id, objective: task.objective, criteria: task.criteria, dependsOn: task.dependsOn }));
  // An existing unproven specification is checked by planner, not presumed current.
  let roleName = run.nextRole ?? (task.sourceStatus === 'passing' && existsSync(join(cwd, spec)) ? 'validator' : 'planner');
  if (run.specHash && (fileHash(cwd, spec) !== run.specHash || run.featureIdentity !== featureIdentity)) throw new Error('La especificación cambió desde el handoff. Revisa y reinicia esta ejecución');
  let repairs = 0;
  while (true) {
    if (signal?.aborted) throw new Error('Ejecución cancelada');
    assertWorkspace(cwd, run.baseline);
    const role = runtime.roles[roleName];
    run.nextRole = roleName;
    run.stage = roleStages[roleName];
    run.role = roleName;
    run.skill = role.skillName;
    run.model = piOptions.model ?? pinnedPi.model;
    run.provider = piOptions.provider ?? pinnedPi.provider;
    run.error = null;
    save();
    emit({ message: `${roleName} · ${role.skillName} · ${run.model}` });
    const before = run.roleBaseline?.role === roleName ? run.roleBaseline.files : snapshot(cwd);
    run.roleBaseline = { role: roleName, files: before };
    save();
    let result = await executor({ task, role, runtime, cwd, signal, emit, baseline: run.baseline, repairBrief: run.repairBrief, files: featureChanges(cwd, run.baseline), ...piOptions });
    // Validate the same contract even for injected test adapters.
    result = { ...validateRoleResult(result, roleName), output: result.output ?? '' };
    run.steps.push({ role: roleName, skill: role.skillName, provider: run.provider, model: run.model, at: new Date().toISOString(), ...result });
    save();
    assertWorkspace(cwd, run.baseline);
    if (loadRuntime(cwd).fingerprint !== run.runtimeHash) throw new Error('El subagente cambió las instrucciones del harness; se requiere revisión');
    checkInventory(cwd, run);
    const after = snapshot(cwd);
    const touched = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]);
    if (roleName === 'validator' && !sameSnapshot(before, after)) throw new Error('Validator modificó archivos: se requiere revisión, no se aceptará la feature');
    if (roleName === 'planner' && touched.some((path) => path !== spec)) throw new Error('Planner cambió archivos fuera de la especificación');
    if (roleName === 'implementer' && touched.includes(spec)) throw new Error('Implementer cambió la especificación aceptada; requiere nueva planificación');
    if (touched.some((path) => !result.files.includes(path))) throw new Error('El resultado del subagente no declara todos los archivos que modificó');
    run.ownedFiles = [...new Set([...run.ownedFiles, ...touched])];
    if (result.outcome === 'block' || result.verdict === 'block') throw new Error(result.summary);
    task = taskNow(cwd, task.id);
    if (roleName !== 'validator' && task.sourceStatus === 'accepted') throw new Error('Un subagente aceptó la feature sin validación independiente');
    if (roleName === 'planner') {
      if (!existsSync(join(cwd, spec)) || !readFileSync(join(cwd, spec), 'utf8').trim()) throw new Error(`Planner no ha generado ${spec}`);
      run.specHash = fileHash(cwd, spec);
      run.featureIdentity = featureIdentity;
      roleName = task.sourceStatus === 'passing' ? 'validator' : 'implementer';
    } else if (roleName === 'implementer') {
      if (task.sourceStatus !== 'passing' || !task.evidence.length) throw new Error('Implementer no ha dejado passing con evidencia en feature_list.json');
      if (!existsSync(join(cwd, 'PROGRESS.md'))) throw new Error('Implementer no ha dejado PROGRESS.md');
      roleName = 'validator';
    } else if (result.verdict === 'revise') {
      run.repairBrief = result.repairBrief;
      run.nextRole = 'implementer';
      save();
      if (++repairs > maxRepairs) throw new Error(`Se alcanzó el límite de ${maxRepairs} reparaciones. Revisa el informe antes de continuar`);
      roleName = 'implementer';
    } else {
      if (task.sourceStatus !== 'passing') throw new Error('Solo una feature passing puede recibir aceptación independiente');
      const files = featureChanges(cwd, run.baseline);
      if (files.some((path) => !run.ownedFiles.includes(path) || !result.files.includes(path))) throw new Error('Hay cambios sin autoría o sin revisión del validator; no se hará un commit mixto');
      const features = readFeatures(cwd);
      const selected = features.find((item) => item.id === task.id);
      selected.status = 'accepted';
      selected.evidence = [...new Set([...selected.evidence, `Independent validator accept: ${result.summary}`, ...result.evidence])];
      const progress = existsSync(join(cwd, 'PROGRESS.md')) ? readFileSync(join(cwd, 'PROGRESS.md'), 'utf8') : '';
      const allFiles = [...new Set([...files, 'feature_list.json', 'PROGRESS.md'])].sort();
      run.acceptance = {
        files: allFiles, beforeHashes: Object.fromEntries(allFiles.map((path) => [path, fileHash(cwd, path)])),
        message: `feat: complete ${task.id}\n\nHarness-Run: ${run.id}`,
        documents: {
          'feature_list.json': `${JSON.stringify(features, null, 2)}\n`,
          'PROGRESS.md': `${progress.trimEnd()}\n\n## ${task.id} · independent validator accept\n\n${result.summary}\n\n${result.evidence.map((item) => `- ${item}`).join('\n')}\n\nCómo probarlo: ${result.testing}\n`
        }
      };
      run.testing = result.testing;
      run.summary = result.summary;
      save();
      return finalize({ run, cwd, save, emit });
    }
    delete run.roleBaseline;
    run.nextRole = roleName;
    save();
  }
}
