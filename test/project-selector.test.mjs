import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { chooseProject } from '../harness/project-selector.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('la selección explícita carga el contrato de esa carpeta', async () => {
  const selectedPath = join(root, 'examples', 'sample-project');
  const project = await chooseProject({ select: async () => selectedPath });
  assert.equal(project.path, selectedPath);
  assert.equal(project.name, 'sample-project');
  assert.equal(project.tasks.length, 3);
});

test('cancelar la selección no autoriza ningún proyecto', async () => {
  assert.equal(await chooseProject({ select: async () => null }), null);
});
