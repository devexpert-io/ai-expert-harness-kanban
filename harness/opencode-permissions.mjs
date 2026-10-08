// Extensión de Pi: aplica los `permission` de `.opencode/agents/<rol>.md` antes de cada herramienta.
// Pi no trae sandbox; con esto, el motor respeta las reglas que el arnés ya define para OpenCode.
// El rol llega en HARNESS_ROLE. Sin rol o sin archivo, la extensión no bloquea nada.
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';

// Las herramientas de Pi, traducidas a las claves de permiso de OpenCode.
export const keys = { read: 'read', write: 'edit', edit: 'edit', bash: 'bash', grep: 'grep', find: 'glob', ls: 'list' };

/** Las herramientas de Pi que tiene sentido activar: fuera las que el arnés niega del todo. */
export function piTools(permissions = {}) {
  return Object.keys(keys).filter((tool) => (permissions[keys[tool]] ?? permissions['*']) !== 'deny');
}
// Valores por defecto de OpenCode que importan aquí.
const defaults = { external_directory: 'ask', read: { '*': 'allow', '*.env': 'deny', '*.env.*': 'deny', '*.env.example': 'allow' } };

/** El subconjunto de YAML que usan los agentes: mapas indentados con valores escalares. */
export function parsePermissions(markdown) {
  const front = markdown.match(/^---\r?\n([^]*?)\r?\n---/)?.[1] ?? '';
  const lines = front.split(/\r?\n/);
  const start = lines.findIndex((line) => /^permission:\s*$/.test(line));
  if (start === -1) return {};
  const unquote = (text) => text.trim().replace(/^(['"])(.*)\1$/, '$2');
  const root = {};
  const stack = [{ indent: 0, map: root }];
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.match(/^ */)[0].length;
    if (indent === 0) break; // fin del bloque `permission`
    const [, key, value] = line.trim().match(/^((?:"[^"]*"|'[^']*'|[^:])+):\s*(.*)$/) ?? [];
    if (key === undefined) continue;
    while (stack.length > 1 && indent <= stack.at(-1).indent) stack.pop();
    const parent = stack.at(-1).map;
    if (value === '') stack.push({ indent, map: (parent[unquote(key)] = {}) });
    else parent[unquote(key)] = unquote(value.replace(/\s+#.*$/, ''));
  }
  return root;
}

const wildcard = (pattern) => new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);

/** Como en OpenCode: `*` y `?` como comodines, y gana la última regla que encaja. */
export function action(rule, subject) {
  if (rule === undefined) return 'allow';
  if (typeof rule === 'string') return rule;
  let result = 'allow';
  for (const [pattern, value] of Object.entries(rule)) if (wildcard(pattern).test(subject)) result = value;
  return result;
}

const outside = (cwd, path) => {
  const target = resolve(cwd, path.replace(/^~(?=\/|$)/, homedir()));
  const rel = relative(cwd, target);
  return rel.startsWith('..') || isAbsolute(rel);
};
// En bash solo se puede intuir. Se vigilan las rutas de tu carpeta personal (~/… o $HOME/…) fuera
// del proyecto, que es donde están tus credenciales y configuración; /usr, /opt, /tmp o /dev no.
const bashPaths = (command) => [...command.replaceAll('$HOME', homedir()).matchAll(/(?:^|[\s'"=:])((?:~|\/)[^\s'";|&)]*)/g)]
  .map((match) => match[1]).filter((path) => path.startsWith('~') || path.startsWith(homedir()));

/** Decide una llamada. Devuelve null si se permite, o el motivo del bloqueo. */
export function decide(permissions, toolName, input, cwd) {
  const key = keys[toolName];
  if (!key) return null;
  const path = input.path ?? input.file_path;
  const paths = key === 'bash' ? bashPaths(input.command ?? '') : path ? [path] : [];
  const external = paths.find((item) => outside(cwd, item));
  if (external) {
    const verdict = action(permissions.external_directory ?? defaults.external_directory, resolve(cwd, external));
    if (verdict !== 'allow') return `fuera del proyecto (${external}): external_directory es «${verdict}»`;
  }
  const subject = key === 'bash' ? input.command ?? '' : path ? relative(cwd, resolve(cwd, path)) : '*';
  const rule = permissions[key] ?? permissions['*'] ?? defaults[key];
  const verdict = action(rule, subject);
  if (verdict === 'allow') return null;
  // En una sesión sin persona delante, «ask» no puede responderse: se bloquea.
  return `${key} «${verdict}» para ${subject || toolName} según el arnés`;
}

export default function opencodePermissions(pi) {
  const role = process.env.HARNESS_ROLE;
  const file = role && join(process.cwd(), '.opencode/agents', `${role}.md`);
  if (!file || !existsSync(file)) return;
  const permissions = parsePermissions(readFileSync(file, 'utf8'));
  pi.on('tool_call', async (event) => {
    const reason = decide(permissions, event.toolName, event.input ?? {}, process.cwd());
    if (reason) return { block: true, reason: `Bloqueado por .opencode/agents/${role}.md: ${reason}` };
  });
}
