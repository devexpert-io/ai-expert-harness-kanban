import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { git } from './git-workspace.mjs';

// Parallel branches always collide here: each one marks its own feature accepted and appends to the log.
export const stateFiles = ['feature_list.json', 'PROGRESS.md'];

/** Three-way merge by feature id: start from the base branch and keep every entry this branch changed. */
export function mergeFeatureLists(base, ours, theirs) {
  const byId = (list) => new Map(list.map((item) => [item.id, item]));
  const original = byId(base);
  const changed = byId(ours.filter((item) => JSON.stringify(item) !== JSON.stringify(original.get(item.id))));
  const present = new Set(theirs.map((item) => item.id));
  return [...theirs.map((item) => changed.get(item.id) ?? item), ...[...changed.values()].filter((item) => !present.has(item.id))];
}

const stage = (cwd, number, path) => { try { return git(cwd, 'show', `:${number}:${path}`); } catch { return ''; } };

function unionMerge(ours, base, theirs) {
  const directory = mkdtempSync(join(tmpdir(), 'harness-merge-'));
  try {
    const files = { ours, base, theirs };
    for (const [name, text] of Object.entries(files)) writeFileSync(join(directory, name), `${text.trimEnd()}\n`);
    return execFileSync('git', ['merge-file', '-p', '--union', join(directory, 'ours'), join(directory, 'base'), join(directory, 'theirs')], { encoding: 'utf8' });
  } catch (error) {
    // merge-file exits with the number of conflicts; --union resolves them, so stdout is the result.
    if (typeof error.stdout === 'string') return error.stdout;
    throw error;
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function resolve(cwd, path) {
  const [base, ours, theirs] = [1, 2, 3].map((number) => stage(cwd, number, path));
  const text = path === 'feature_list.json'
    ? `${JSON.stringify(mergeFeatureLists(JSON.parse(base || '[]'), JSON.parse(ours), JSON.parse(theirs)), null, 2)}\n`
    : unionMerge(ours, base, theirs);
  writeFileSync(join(cwd, path), text);
  git(cwd, 'add', '--', path);
}

/**
 * Brings a feature branch up to date with its base. State-file conflicts are resolved deterministically;
 * any other conflict aborts the merge and is reported for a human to resolve.
 */
export function syncWithBase(cwd, baseRef) {
  try { git(cwd, 'merge-base', '--is-ancestor', baseRef, 'HEAD'); return { changed: false, conflicts: [] }; } catch {}
  const message = `chore: sync with ${baseRef.replace(/^refs\/(heads|remotes)\//, '')}`;
  try {
    git(cwd, 'merge', '--no-ff', '-m', message, baseRef);
    return { changed: true, conflicts: [] };
  } catch {
    const conflicts = git(cwd, 'diff', '--name-only', '--diff-filter=U').split('\n').filter(Boolean);
    if (!conflicts.length || conflicts.some((path) => !stateFiles.includes(path))) {
      try { git(cwd, 'merge', '--abort'); } catch {}
      return { changed: false, conflicts: conflicts.filter((path) => !stateFiles.includes(path)) };
    }
    for (const path of conflicts) resolve(cwd, path);
    git(cwd, 'commit', '--no-edit');
    return { changed: true, conflicts: [], resolved: conflicts };
  }
}
