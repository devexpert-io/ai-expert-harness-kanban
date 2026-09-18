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
  assert.equal(project.tasks[2].blocked.reason, 'Falta referencia visual; hay que seleccionar una variante.');
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

test('carga el feature_list real con estados y dependencias', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'harness-feature-list-'));
  writeFileSync(join(projectPath, 'feature_list.json'), JSON.stringify([
    {
      id: 'base',
      area: 'bootstrap',
      title: 'Base aceptada',
      user_visible_behavior: 'La base está lista.',
      depends_on: [],
      status: 'accepted',
      verification: ['El gate pasa.'],
      evidence: ['pnpm test -> OK'],
      notes: 'Validada.'
    },
    {
      id: 'next',
      area: 'ai',
      title: 'Siguiente feature',
      user_visible_behavior: 'La persona usa la siguiente feature.',
      depends_on: ['base'],
      status: 'not_started',
      verification: ['Existe una prueba.'],
      evidence: [],
      notes: 'Lista para implementar.'
    }
  ]));
  const project = inspectProject(projectPath);
  assert.equal(project.format, 'feature-list');
  assert.deepEqual(project.tasks.map((task) => task.state), ['done', 'pending']);
  assert.deepEqual(project.tasks[1].dependsOn, ['base']);
  assert.equal(project.tasks[1].objective, 'La persona usa la siguiente feature.');
  assert.deepEqual(project.tasks[0].criteria, ['El gate pasa.']);
});

test('rechaza el antiguo contenedor versionado', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'harness-wrapped-list-'));
  writeFileSync(join(projectPath, 'feature_list.json'), JSON.stringify({ version: 1, tasks: [] }));
  assert.throws(() => inspectProject(projectPath), /lista JSON de features/);
});

test('rechaza campos alternativos aunque expresen la misma información', () => {
  const projectPath = mkdtempSync(join(tmpdir(), 'harness-alternate-fields-'));
  writeFileSync(join(projectPath, 'feature_list.json'), JSON.stringify([{
    id: 'wrong', area: 'test', title: 'Formato incorrecto', user_visible_behavior: 'No se carga.',
    dependsOn: [], status: 'not_started', verification: [], evidence: [], notes: 'Usa dependsOn.'
  }]));
  assert.throws(() => inspectProject(projectPath), /campo no admitido: dependsOn/);
});
