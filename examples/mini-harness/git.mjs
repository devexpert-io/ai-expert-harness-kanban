// Lo que el host sabe sin preguntar a nadie: qué ha cambiado en el proyecto, según Git.
import { execFileSync } from 'node:child_process';

export const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trimEnd();

/** Los archivos cambiados respecto al último commit, cada uno con un hash de su contenido. */
export function foto(proyecto) {
  const archivos = git(proyecto, 'status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean).map((linea) => linea.slice(3));
  const hash = (archivo) => { try { return git(proyecto, 'hash-object', '--', archivo); } catch { return 'borrado'; } };
  return new Map(archivos.map((archivo) => [archivo, hash(archivo)]));
}

/** Lo que ha cambiado desde `antes`: lo que ha tocado el último rol, diga lo que diga. */
export function tocadosDesde(proyecto, antes) {
  const ahora = foto(proyecto);
  return [...new Set([...antes.keys(), ...ahora.keys()])].filter((archivo) => antes.get(archivo) !== ahora.get(archivo));
}

/** El commit lo hace el host, solo con los archivos que le pasan. */
export function commit(proyecto, archivos, mensaje) {
  git(proyecto, 'add', '--', ...archivos);
  git(proyecto, 'commit', '-q', '-m', mensaje);
  return git(proyecto, 'rev-parse', '--short', 'HEAD');
}
