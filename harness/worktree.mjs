import { copyFileSync, existsSync, mkdirSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { git } from './git-workspace.mjs';

// Local-only files a feature usually needs to run checks; they are ignored by Git, so worktrees lack them.
const environmentFiles = ['.env', '.env.local', '.env.test'];

export const branchExists = (repo, branch) => {
  try { git(repo, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`); return true; } catch { return false; }
};
export function uniqueBranch(repo, id) {
  for (let index = 1; ; index++) {
    const branch = index === 1 ? `feat/${id}` : `feat/${id}-${index}`;
    if (!branchExists(repo, branch)) return branch;
  }
}

/** One isolated checkout per feature, created from the shared base so parallel runs never see each other's files. */
export function addWorktree(repo, path, branch, baseRef) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  git(repo, 'worktree', 'add', '-b', branch, path, baseRef);
  for (const file of environmentFiles) if (existsSync(join(repo, file))) copyFileSync(join(repo, file), join(path, file));
  return realpathSync(path);
}

/** Removes a finished checkout. Never forced: uncommitted work keeps the worktree in place. */
export function removeWorktree(repo, path) {
  if (!path || !existsSync(path)) return true;
  try { git(repo, 'worktree', 'remove', path); return true; } catch { return false; }
}
