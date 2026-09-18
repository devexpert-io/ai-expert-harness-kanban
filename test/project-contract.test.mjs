import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectProject } from '../harness/project-contract.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('carga tareas, estados, bloqueos y configuración del proyecto seleccionado', () => {
  const project = inspectProject(join(root, 'examples', 'sample-project'));
  assert.equal(project.tasks.length, 3);
  assert.equal(project.tasks[1].state, 'validating');
  assert.equal(project.tasks[2].blocked.reason, 'Falta referencia visual');
  assert.equal(project.config.defaultEngine, 'mock');
  assert.deepEqual(project.files, { tasks: true, config: true });
});

test('una carpeta sin contrato produce un estado vacío sin inventar tareas', () => {
  const project = inspectProject(mkdtempSync(join(tmpdir(), 'harness-empty-')));
  assert.deepEqual(project.tasks, []);
  assert.equal(project.emptyReason, 'Falta feature_list.json');
});

test('rechaza rutas no absolutas', () => {
  assert.throws(() => inspectProject('examples/sample-project'), /ruta.*absoluta/i);
});

test('rechaza una configuración que omita la revisión humana', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'harness-unsafe-'));
  const configPath = join(projectPath, '.harness');
  mkdirSync(configPath);
  writeFileSync(join(configPath, 'config.json'), JSON.stringify({ version: 1, autoMerge: true }));
  assert.throws(() => inspectProject(projectPath), /prohíbe autoMerge/i);
});
