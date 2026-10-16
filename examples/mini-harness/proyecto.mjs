// Tu proyecto: dónde está, en qué copia se trabaja y qué features tiene.
// El harness no vive en tu proyecto: lo apunta. Aquí lo apunta el enlace `tienda` de esta carpeta
//   ln -s /ruta/a/tu/tienda-m6 tienda
// o, si lo prefieres, `--proyecto <ruta>` en cualquier comando.
// Cada ejecución trabaja en una copia desechable: tu fork no se toca (el Kanban es quien trabaja sobre él).
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonLike } from '../../harness/json-text.mjs';

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
  const copy = join(realpathSync(mkdtempSync(join(tmpdir(), 'mini-harness-'))), 'tienda');
  git(tmpdir(), 'clone', '-q', project, copy);
  const diff = git(project, 'diff', 'HEAD', '--binary');
  if (diff) execFileSync('git', ['apply', '--whitespace=nowarn'], { cwd: copy, input: `${diff}\n` });
  for (const file of ['.env', '.env.local', '.env.test']) if (existsSync(join(project, file))) copyFileSync(join(project, file), join(copy, file));
  try { git(copy, 'remote', 'set-url', 'origin', git(project, 'remote', 'get-url', 'origin')); } catch {}
  return copy;
}

export const features = (proyecto) => JSON.parse(readFileSync(join(proyecto, 'feature_list.json'), 'utf8'));
export const estadoDe = (proyecto, id) => features(proyecto).find((feature) => feature.id === id)?.status;

/** La siguiente que se puede empezar: no aceptada, no bloqueada y con todas sus dependencias aceptadas. */
export function siguienteLista(proyecto) {
  const lista = features(proyecto);
  const aceptadas = new Set(lista.filter((feature) => feature.status === 'accepted').map((feature) => feature.id));
  return lista.find((feature) => !['accepted', 'blocked'].includes(feature.status) && feature.depends_on.every((id) => aceptadas.has(id)));
}

/** La aceptación la escribe el host, nunca un rol. */
export function marcarAceptada(proyecto, id, resumen) {
  const original = readFileSync(join(proyecto, 'feature_list.json'), 'utf8');
  const lista = JSON.parse(original);
  const feature = lista.find((item) => item.id === id);
  feature.status = 'accepted';
  feature.evidence.push(`Independent validator accept: ${resumen}`);
  writeFileSync(join(proyecto, 'feature_list.json'), jsonLike(original, lista)); // con el formato del archivo: el diff es solo lo que cambia
}

/** Lo habitual al empezar: resolver el proyecto, copiarlo y decir dónde se trabaja. */
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
