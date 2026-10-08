#!/usr/bin/env node
// Pi de ensayo: habla el mismo protocolo RPC y hace un trabajo mínimo por rol, sin inferencia.
// PI_BIN=examples/mini-harness/fake-pi.mjs  ·  FAKE_PI_DELAY=ms entre pasos (por defecto 400)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decide, parsePermissions } from '../../harness/opencode-permissions.mjs';

if (process.argv.includes('--version')) { console.log('fake-pi 0.0.0 (ensayo)'); process.exit(0); }
const delay = Number(process.env.FAKE_PI_DELAY ?? 400);
const sleep = () => new Promise((resolve) => setTimeout(resolve, delay));
const send = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const write = (path, text) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
const changed = () => execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { encoding: 'utf8' }).split('\n').filter(Boolean).map((line) => line.slice(3));

// Si nos pasan la extensión de permisos, la aplicamos igual que Pi: antes de cada herramienta.
const harnessRole = process.env.HARNESS_ROLE;
const enforced = process.argv.some((arg) => arg.endsWith('opencode-permissions.mjs')) && harnessRole && existsSync(`.opencode/agents/${harnessRole}.md`);
const permissions = enforced ? parsePermissions(readFileSync(`.opencode/agents/${harnessRole}.md`, 'utf8')) : null;

async function tool(toolName, args, action) {
  send({ type: 'tool_execution_start', toolCallId: `${toolName}-${Date.now()}`, toolName, args });
  await sleep();
  const reason = permissions && decide(permissions, toolName, args, process.cwd());
  if (reason) return send({ type: 'tool_execution_end', toolName, isError: true, result: { content: [{ type: 'text', text: `Bloqueado por .opencode/agents/${harnessRole}.md: ${reason}` }] } });
  action?.();
  send({ type: 'tool_execution_end', toolName, isError: false, result: { content: [] } });
}

async function play(message) {
  // Entiende el prompt del mini-harness y el del Kanban.
  const role = message.match(/(?:Tu rol|Your configured role): (\w+)/)?.[1];
  const id = message.match(/(?:^Feature|Selected feature:) ([\w-]+):/m)?.[1];
  const feedback = message.match(/(?:pide estas correcciones|repair brief|requested changes[^:]*):\s*([^\n]+)/)?.[1];
  send({ type: 'agent_start' });
  await tool('read', { path: 'AGENTS.md' });
  let result;
  if (role === 'planner') {
    // El paso 5 le pide saltarse su rol; el planner de ensayo obedece, para que se vea quién lo para.
    if (message.includes('TODO revisar')) {
      await tool('edit', { path: 'src/app/page.tsx' }, () => write('src/app/page.tsx', `// TODO revisar\n${existsSync('src/app/page.tsx') ? readFileSync('src/app/page.tsx', 'utf8') : ''}`));
      await tool('bash', { command: 'pnpm test' });
    }
    const spec = `docs/specs/${id}.md`;
    await tool('write', { path: spec }, () => write(spec, `# ${id}\n\nEscenario comprobable generado en ensayo.\n`));
    result = { outcome: 'ready', summary: `Spec de ${id} lista`, evidence: ['Spec con escenarios comprobables'], files: [spec] };
  } else if (role === 'implementer') {
    const source = `src/${id}.js`;
    await tool('write', { path: source }, () => write(source, `// ${id}: ${feedback ?? 'implementado en ensayo'}\nexport const ready = true;\n`));
    await tool('bash', { command: 'node --test' });
    await tool('edit', { path: 'feature_list.json' }, () => {
      const list = JSON.parse(readFileSync('feature_list.json', 'utf8'));
      Object.assign(list.find((item) => item.id === id), { status: 'passing', evidence: ['node --test: 1 passed (ensayo)'] });
      writeFileSync('feature_list.json', `${JSON.stringify(list, null, 2)}\n`);
    });
    await tool('edit', { path: 'PROGRESS.md' }, () => appendFileSync('PROGRESS.md', `${existsSync('PROGRESS.md') ? '\n' : ''}- ${id}: passing (ensayo)\n`));
    result = { outcome: 'passing', summary: `${id} implementada`, evidence: ['node --test: 1 passed (ensayo)'], files: changed() };
  } else {
    await tool('bash', { command: 'node --test' });
    result = { verdict: 'accept', summary: `${id} cumple su verificación`, evidence: ['Checks repetidos por el validator (ensayo)'], testing: `Abre src/${id}.js`, files: changed() };
  }
  send({ type: 'message_update', assistantMessageEvent: { type: 'text_end', content: 'Trabajo de ensayo terminado.' } });
  send({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: `Hecho.\n<harness-result>${JSON.stringify(result)}</harness-result>` }] } });
  send({ type: 'agent_settled' });
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf('\n');
  if (newline === -1) return;
  const command = JSON.parse(buffer.slice(0, newline));
  buffer = buffer.slice(newline + 1);
  if (command.type === 'prompt') void play(command.message);
});
