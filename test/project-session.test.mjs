import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectSession } from '../harness/project-session.mjs';

test('conserva el proyecto elegido durante la sesión', async () => {
  const session = new ProjectSession();
  const project = { path: '/tmp/example', name: 'example', tasks: [] };
  assert.equal(session.get(), null);
  assert.equal(await session.choose(async () => project), project);
  assert.equal(session.get(), project);
});

test('cancelar mantiene el proyecto actual y limpiar lo elimina', async () => {
  const session = new ProjectSession();
  const project = { path: '/tmp/example', name: 'example', tasks: [] };
  await session.choose(async () => project);
  assert.equal(await session.choose(async () => null), null);
  assert.equal(session.get(), project);
  session.clear();
  assert.equal(session.get(), null);
});
