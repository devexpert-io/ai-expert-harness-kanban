import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { buildPiPrompt, mapPiEvent, runPiTask } from '../harness/pi-engine.mjs';

const task = { id: 'EX-1', title: 'Ejemplo', objective: 'Implementar ejemplo', role: 'Implementer', skill: 'feature-implementer', criteria: ['La prueba enfocada pasa.'] };

test('el prompt de Pi conserva límites operativos', () => {
  const prompt = buildPiPrompt(task);
  assert.match(prompt, /EX-1/);
  assert.match(prompt, /No hagas merge, push, deploy/);
  assert.match(prompt, /feature-implementer/);
  assert.match(prompt, /La prueba enfocada pasa/);
});

test('los eventos RPC se traducen a estado y evidencia', () => {
  assert.equal(mapPiEvent({ type: 'agent_start' }, task).stage, 'planning');
  const tool = mapPiEvent({ type: 'tool_execution_start', toolName: 'bash' }, task);
  assert.equal(tool.stage, 'implementing');
  assert.match(tool.evidence, /bash/);
  const result = mapPiEvent({ type: 'tool_execution_end', toolName: 'bash', isError: false }, task);
  assert.equal(result.stage, 'validating');
  const failure = mapPiEvent({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Credencial caducada' } }, task);
  assert.equal(failure.level, 'error');
  assert.match(failure.evidence, /Credencial caducada/);
});

test('una respuesta fallida del proveedor no se presenta como revisión lista', async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.killed = false;
    child.kill = () => { child.killed = true; };
    queueMicrotask(() => {
      child.stdout.write(`${JSON.stringify({ type: 'agent_start' })}\n`);
      child.stdout.write(`${JSON.stringify({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'Provided authentication token is expired.' } })}\n`);
      child.stdout.write(`${JSON.stringify({ type: 'agent_settled' })}\n`);
    });
    return child;
  };
  const events = [];
  await assert.rejects(
    () => runPiTask({ task, cwd: '/tmp', emit: (event) => events.push(event), spawnImpl, timeoutMs: 1_000 }),
    /authentication token is expired/
  );
  assert.equal(events.some((event) => event.stage === 'review'), false);
});
