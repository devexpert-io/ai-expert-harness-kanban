// Paso 1 · Un agente es un proceso: le mandamos JSON por stdin y nos devuelve eventos JSON por stdout.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const provider = fileURLToPath(new URL('../../harness/devexpert-provider.mjs', import.meta.url));
// Paso 5: la extensión que hace que Pi respete los permisos de .opencode/agents/<rol>.md.
const permissions = fileURLToPath(new URL('../../harness/opencode-permissions.mjs', import.meta.url));
const skills = { planner: 'feature-spec', implementer: 'feature-implementer', validator: 'feature-validator' };

/** Lo que ya construisteis en los módulos 2–4: AGENTS.md, el subagente y su skill. */
export function loadRole(project, name) {
  const read = (path) => readFileSync(join(project, path), 'utf8');
  // La tienda define los subagentes para OpenCode (.md con frontmatter); otros repos, para Codex (.toml).
  const instructions = existsSync(join(project, '.opencode/agents'))
    ? read(`.opencode/agents/${name}.md`).replace(/^---[^]*?\n---\n/, '').trim()
    : read(`.codex/agents/${name}.toml`).match(/developer_instructions\s*=\s*"""([^]*?)"""/)?.[1].trim();
  const skillPath = join(project, `.agents/skills/${skills[name]}/SKILL.md`);
  return { name, skill: skills[name], thinking: 'medium', skillPath, system: [read('AGENTS.md'), instructions].join('\n\n') };
}

/** El contrato de salida: sin un resultado estructurado, el host no avanza. */
export function parseResult(text) {
  const match = text.match(/<harness-result>\s*([^]*?)\s*<\/harness-result>/);
  if (!match) throw new Error('El rol no devolvió <harness-result>');
  return JSON.parse(match[1]);
}

// La clave: la del entorno o la que guardaste en el Kanban («Recordarla»). Así no hay que teclearla en clase.
const saved = fileURLToPath(new URL('../../.harness-data/credentials.json', import.meta.url));
export function withApiKey(env = process.env) {
  if (env.DEVEXPERT_API_KEY || !existsSync(saved)) return env;
  const { apiKey } = JSON.parse(readFileSync(saved, 'utf8'));
  return apiKey ? { ...env, DEVEXPERT_API_KEY: apiKey } : env;
}

export function runRole({ cwd, role, prompt, onEvent = () => {}, env = withApiKey(), enforce = false }) {
  const args = ['--mode', 'rpc', '--no-session', '--no-approve', '--no-extensions', '--no-skills', '--no-context-files',
    '--tools', 'read,bash,edit,write,grep,find,ls',
    '--extension', provider, '--provider', 'devexpert', '--model', 'chat', '--thinking', role.thinking,
    '--skill', role.skillPath, '--append-system-prompt', role.system];
  if (enforce) { args.push('--extension', permissions); env = { ...env, HARNESS_ROLE: role.name }; }
  // Una ruta relativa en PI_BIN se resuelve aquí: Pi arranca dentro del proyecto, no donde estás tú.
  const bin = env.PI_BIN?.includes('/') ? resolve(env.PI_BIN) : env.PI_BIN ?? 'pi';
  const pi = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'inherit'] });
  return new Promise((resolve, reject) => {
    let text = '';
    let buffer = '';
    pi.on('error', reject);
    pi.stdout.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const event = JSON.parse(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        onEvent(event);
        if (event.type === 'response' && event.success === false) { pi.kill(); reject(new Error(event.error)); }
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          text = event.message.content.filter((part) => part.type === 'text').map((part) => part.text).join('\n') || text;
          if (event.message.stopReason === 'error') { pi.kill(); reject(new Error(event.message.errorMessage ?? 'Error del proveedor')); }
        }
        if (event.type === 'agent_settled') {
          pi.kill();
          try { resolve({ text, result: parseResult(text) }); } catch (error) { reject(error); }
        }
      }
    });
    pi.stdin.write(`${JSON.stringify({ type: 'prompt', message: prompt })}\n`);
  });
}

/** Un evento → una línea legible. Es exactamente lo que el Kanban pinta en "Actividad". */
export function logEvent(prefix) {
  return (event) => {
    if (event.type === 'tool_execution_start') console.log(`  ${prefix} ▸ ${event.toolName} ${JSON.stringify(event.args).slice(0, 90)}`);
    if (event.type === 'tool_execution_end' && event.isError) {
      const text = (event.result?.content ?? []).map((part) => part.text ?? '').join(' ');
      console.log(`  ${prefix} ✕ ${event.toolName} ${/Bloqueado por/.test(text) ? text.slice(text.indexOf('Bloqueado por'), text.indexOf('Bloqueado por') + 140) : 'falló'}`);
    }
  };
}

export const contract = (role) => role === 'validator'
  ? 'Termina con <harness-result>{"verdict":"accept|revise|block","summary":"...","evidence":["..."],"repairBrief":"si revise","testing":"cómo probarlo","files":["..."]}</harness-result>'
  : `Termina con <harness-result>{"outcome":"${role === 'planner' ? 'ready' : 'passing'}|block","summary":"...","evidence":["..."],"files":["archivos que cambiaste"]}</harness-result>`;

export function rolePrompt(feature, role, extra = '') {
  return [`Feature ${feature.id}: ${feature.title}. ${feature.user_visible_behavior}`,
    `Verificación: ${JSON.stringify(feature.verification)}. Spec: docs/specs/${feature.id}.md.`,
    `Tu rol: ${role}. Usa la skill $${skills[role]}. No hagas commit, push ni merge: eso lo hace el host.`, extra, contract(role)].filter(Boolean).join('\n\n');
}
