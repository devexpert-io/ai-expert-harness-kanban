// Dónde está tu proyecto y en qué copia se trabaja.
// El harness no vive en tu proyecto: lo apunta. Aquí lo apunta el enlace `tienda` de esta carpeta
//   ln -s /ruta/a/tu/tienda-m6 tienda
// o, si lo prefieres, `--proyecto <ruta>` en cualquier paso.
// Cada paso trabaja en una copia desechable: tu fork no se toca (el Kanban es quien trabaja sobre él).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trimEnd();

/** Separa `--proyecto <ruta>` del resto de argumentos y comprueba que ahí hay un proyecto con arnés. */
export function projectFrom(argv) {
  const args = [...argv];
  const flag = args.indexOf('--proyecto');
  const given = flag === -1 ? join(here, 'tienda') : args.splice(flag, 2)[1];
  if (!given || !existsSync(join(given, 'feature_list.json'))) {
    throw new Error(flag === -1
      ? 'No encuentro tu proyecto. Enlázalo una vez desde esta carpeta: ln -s /ruta/a/tu/tienda-m6 tienda'
      : `No hay feature_list.json en ${given}`);
  }
  return { project: realpathSync(given), args };
}

/**
 * Una copia desechable del proyecto: lo commiteado, más tus cambios sin commitear en archivos versionados
 * (por ejemplo, una regla nueva en .opencode/agents) y tus .env. El remoto apunta al mismo origin.
 */
export function workingCopy(project) {
  const copy = join(mkdtempSync(join(tmpdir(), 'mini-harness-')), 'tienda');
  git(tmpdir(), 'clone', '-q', project, copy);
  const diff = git(project, 'diff', 'HEAD', '--binary');
  if (diff) execFileSync('git', ['apply', '--whitespace=nowarn'], { cwd: copy, input: `${diff}\n` });
  for (const file of ['.env', '.env.local', '.env.test']) if (existsSync(join(project, file))) copyFileSync(join(project, file), join(copy, file));
  try { git(copy, 'remote', 'set-url', 'origin', git(project, 'remote', 'get-url', 'origin')); } catch {}
  return copy;
}

/** Lo habitual al empezar un paso: resolver el proyecto, copiarlo y decir dónde se trabaja. */
export function start(argv = process.argv.slice(2)) {
  let found;
  try { found = projectFrom(argv); } catch (error) { console.error(error.message); process.exit(1); }
  const { project, args } = found;
  const copy = workingCopy(project);
  console.log(`Copia de trabajo: ${copy}\n`);
  return { project, copy, args };
}

// Para scripts de shell: `node proyecto.mjs copia [--proyecto ruta]` imprime la ruta de una copia nueva.
if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'copia') {
  try { console.log(workingCopy(projectFrom(process.argv.slice(3)).project)); }
  catch (error) { console.error(error.message); process.exit(1); }
}
