import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, readlinkSync, realpathSync } from 'node:fs';
import { join, relative } from 'node:path';
import { digest } from './project-runtime.mjs';

export function git(cwd, ...args) {
  return execFileSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 8_000_000, stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}
const paths = (text) => text.split('\0').filter(Boolean);
export function fileHash(cwd, path) {
  try {
    const full = join(cwd, path);
    const stat = lstatSync(full);
    if (stat.isSymbolicLink()) return digest(`symlink:${readlinkSync(full)}`);
    if (!stat.isFile()) throw new Error(`No se admiten submódulos o directorios en el diff: ${path}`);
    if (relative(cwd, realpathSync(full)).startsWith('..')) throw new Error(`Archivo fuera del proyecto: ${path}`);
    return digest(Buffer.concat([Buffer.from(`${stat.mode}:`), readFileSync(full)]));
  } catch (error) { if (error.code === 'ENOENT') return 'deleted'; throw error; }
}
export function snapshot(cwd) {
  const changed = new Set([...paths(git(cwd, 'diff', 'HEAD', '--name-only', '-z')), ...paths(git(cwd, 'ls-files', '--others', '--exclude-standard', '-z'))]);
  return Object.fromEntries([...changed].sort().map((path) => [path, fileHash(cwd, path)]));
}
export function assertUnstaged(cwd) {
  if (git(cwd, 'diff', '--cached', '--name-only')) throw new Error('Hay cambios staged. Revísalos antes de ejecutar el harness; no se incluirán automáticamente');
}
export function startWorkspace(cwd) {
  if (realpathSync(git(cwd, 'rev-parse', '--show-toplevel')) !== cwd) throw new Error('Selecciona la raíz del repositorio Git');
  assertUnstaged(cwd);
  const baseline = { head: git(cwd, 'rev-parse', 'HEAD'), branch: git(cwd, 'symbolic-ref', '--short', 'HEAD'), dirty: snapshot(cwd) };
  if (Object.keys(baseline.dirty).some((path) => ['feature_list.json', 'PROGRESS.md'].includes(path))) throw new Error('feature_list.json o PROGRESS.md tienen cambios previos. Revísalos antes de ejecutar para no mezclar trabajo');
  return baseline;
}
export function assertWorkspace(cwd, baseline) {
  if (git(cwd, 'rev-parse', 'HEAD') !== baseline.head || git(cwd, 'symbolic-ref', '--short', 'HEAD') !== baseline.branch) throw new Error('HEAD o la rama han cambiado fuera del orquestador. Se requiere revisión');
  assertUnstaged(cwd);
  for (const [path, hash] of Object.entries(baseline.dirty)) {
    if (fileHash(cwd, path) !== hash) throw new Error(`Ha cambiado trabajo previo ajeno a la ejecución: ${path}`);
  }
}
export function featureChanges(cwd, baseline) {
  return Object.keys(snapshot(cwd)).filter((path) => !Object.hasOwn(baseline.dirty, path));
}
export function sameSnapshot(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

export function scopedCommit(cwd, files, message) {
  assertUnstaged(cwd);
  git(cwd, 'add', '--', ...files);
  // Preserve staged changes on failure; never reset a user's index as a recovery shortcut.
  git(cwd, 'commit', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}
