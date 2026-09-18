import assert from 'node:assert/strict';
import test from 'node:test';
import { runMockTask } from '../harness/mock-engine.mjs';
import { RunStore } from '../harness/run-store.mjs';

test('el motor mock termina en revisión humana con evidencia', async () => {
  const events = [];
  for await (const event of runMockTask({ delayMs: 0 })) events.push(event);
  assert.deepEqual(events.map((event) => event.stage), ['planning', 'implementing', 'validating', 'review']);
  assert.match(events.at(-1).evidence, /STOP humano/);
});

test('el almacén puede abortar una ejecución activa', () => {
  const store = new RunStore();
  const run = store.create({ taskId: 'EX-1', engine: 'pi' });
  assert.equal(store.abort(run.id), true);
  assert.equal(run.controller.signal.aborted, true);
  assert.equal(store.abort('inexistente'), false);
});
