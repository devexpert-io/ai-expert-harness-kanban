import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runPiTask } from '../harness/pi-engine.mjs';

const projectPath = mkdtempSync(join(tmpdir(), 'harness-pi-e2e-'));
const events = [];
const task = {
  id: 'E2E-PI',
  title: 'Prueba aislada del motor',
  objective: 'Crea pi-proof.txt con el contenido exacto HARNESS_PI_OK y no modifiques nada más.',
  role: 'Implementer',
  skill: 'feature-implementer'
};

try {
  await runPiTask({ task, cwd: projectPath, timeoutMs: 180_000, emit: (event) => events.push(event) });
  assert.equal(readFileSync(join(projectPath, 'pi-proof.txt'), 'utf8'), 'HARNESS_PI_OK');
  assert.equal(events.at(-1)?.stage, 'review');
  assert.match(events.at(-1)?.evidence ?? '', /STOP antes de merge/);
  console.log(`Pi E2E OK · ${events.length} eventos · revisión humana`);
} finally {
  const cleanup = spawnSync('trash', [projectPath], { encoding: 'utf8' });
  if (cleanup.status !== 0) console.warn(`Fixture temporal conservada en ${projectPath}`);
}
