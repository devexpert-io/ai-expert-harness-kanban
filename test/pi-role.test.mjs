import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { buildPiPrompt, mapPiEvent, parseRoleResult, runPiRole } from '../harness/pi-role.mjs';

const task = { id: 'example', title: 'Example', objective: 'Works', criteria: ['Check works'], dependsOn: [] };
const role = { name: 'implementer', model: 'configured-model', thinking: 'max', developerInstructions: 'Project implementer instructions', skillName: 'feature-implementer', skill: { path: '/tmp/SKILL.md', text: 'Project skill' } };
const runtime = { instructions: { text: 'Repo AGENTS.md' }, flow: { text: 'Project feature-flow' } };
const result = { outcome: 'passing', summary: 'Checks passed', evidence: ['test passed'], files: ['test.js'] };
function fakeSpawn(records, inspect = () => {}) {
  return (binary, args) => {
    inspect(binary, args);
    const child = new EventEmitter();
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => { for (const event of records) child.stdout.write(`${JSON.stringify(event)}\n`); });
    return child;
  };
}
test('herramientas no adelantan las fases ni fabrican aceptación', () => {
  assert.equal(mapPiEvent({ type: 'tool_execution_end', toolName: 'bash' }, role).stage, 'implementing');
  assert.equal(mapPiEvent({ type: 'agent_settled' }, role), null);
  assert.equal(mapPiEvent({ type: 'tool_execution_end', toolName: 'bash', isError: true }, role).level, 'error');
});
test('el handoff conserva límites, baseline y repair brief', () => {
  const prompt = buildPiPrompt({ task, role, repairBrief: 'Fix boundary', baseline: { head: 'abc', dirty: { 'user.txt': 'hash' } } });
  assert.match(prompt, /No hagas merge, push, deploy/);
  assert.match(prompt, /Fix boundary/);
  assert.match(prompt, /user.txt/);
  assert.match(prompt, /feature-implementer/);
});
test('RPC usa el modelo del rol y las instrucciones reales, no el modelo por defecto', async () => {
  const records = [{ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `<harness-result>${JSON.stringify(result)}</harness-result>` }] } }, { type: 'agent_settled' }];
  const actual = await runPiRole({ task, role, runtime, cwd: '/tmp', provider: 'fixture', model: role.model, spawnImpl: fakeSpawn(records, (binary, args) => {
    assert.equal(args[args.indexOf('--model') + 1], 'configured-model');
    assert.equal(args[args.indexOf('--thinking') + 1], 'max');
    const system = args[args.indexOf('--append-system-prompt') + 1];
    for (const text of ['Repo AGENTS.md', 'Project feature-flow', 'Project implementer instructions', 'Project skill']) assert.ok(system.includes(text));
  }) });
  assert.equal(actual.outcome, 'passing');
});
test('settled sin resultado y error del proveedor fallan, no pasan a revisión', async () => {
  for (const records of [[{ type: 'agent_settled' }], [{ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: 'No credits remaining' } }, { type: 'agent_settled' }]]) {
    await assert.rejects(runPiRole({ task, role, runtime, cwd: '/tmp', provider: 'fixture', spawnImpl: fakeSpawn(records) }), /resultado estructurado|No credits/);
  }
});
test('salida estructurada exige evidencia y repair brief', () => {
  assert.throws(() => parseRoleResult('<harness-result>{"verdict":"accept","summary":"ok","files":[],"evidence":[]}</harness-result>', 'validator'), /evidencias/);
  assert.throws(() => parseRoleResult('<harness-result>{"verdict":"revise","summary":"ok","files":[],"evidence":["fail"]}</harness-result>', 'validator'), /correcciones/);
});
test('JSONL viaja por un proceso real y conserva Unicode y salida completa', async () => {
  const output = `<harness-result>${JSON.stringify({ ...result, summary: 'Revisión ñ ✅' })}</harness-result>`;
  const program = `process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({type:'message_end',message:{role:'assistant',content:[{type:'text',text:${JSON.stringify(output)}}]}})+'\\n');process.stdout.write(JSON.stringify({type:'agent_settled'})+'\\n');});`;
  const actual = await runPiRole({ task, role, runtime, cwd: '/tmp', provider: 'fixture', spawnImpl: (binary, args, options) => spawn(process.execPath, ['-e', program], options) });
  assert.equal(actual.summary, 'Revisión ñ ✅');
  assert.equal(actual.output, output);
});

test('ejecución sin override siempre envía devexpert/chat y registra su extensión', async () => {
  const records = [{ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `<harness-result>${JSON.stringify(result)}</harness-result>` }] } }, { type: 'agent_settled' }];
  await runPiRole({ task, role, runtime, cwd: '/tmp', spawnImpl: fakeSpawn(records, (binary, args) => {
    assert.equal(args[args.indexOf('--provider') + 1], 'devexpert');
    assert.equal(args[args.indexOf('--model') + 1], 'chat');
    assert.match(args[args.indexOf('--extension') + 1], /devexpert-provider\.mjs$/);
  }) });
});
