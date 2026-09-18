import assert from 'node:assert/strict';
import test from 'node:test';
import { runMockTask } from '../harness/mock-engine.mjs';

test('el motor mock termina en revisión humana con evidencia', async () => {
  const events = [];
  for await (const event of runMockTask({ delayMs: 0 })) events.push(event);
  assert.deepEqual(events.map((event) => event.stage), ['planning', 'implementing', 'validating', 'review']);
  assert.match(events.at(-1).evidence, /STOP humano/);
});
