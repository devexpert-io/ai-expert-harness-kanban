import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPiPrompt, mapPiEvent } from '../harness/pi-engine.mjs';

const task = { id: 'EX-1', title: 'Ejemplo', objective: 'Implementar ejemplo', role: 'Implementer', skill: 'feature-implementer' };

test('el prompt de Pi conserva límites operativos', () => {
  const prompt = buildPiPrompt(task);
  assert.match(prompt, /EX-1/);
  assert.match(prompt, /No hagas merge, push, deploy/);
  assert.match(prompt, /feature-implementer/);
});

test('los eventos RPC se traducen a estado y evidencia', () => {
  assert.equal(mapPiEvent({ type: 'agent_start' }, task).stage, 'planning');
  const tool = mapPiEvent({ type: 'tool_execution_start', toolName: 'bash' }, task);
  assert.equal(tool.stage, 'implementing');
  assert.match(tool.evidence, /bash/);
  const result = mapPiEvent({ type: 'tool_execution_end', toolName: 'bash', isError: false }, task);
  assert.equal(result.stage, 'validating');
});
