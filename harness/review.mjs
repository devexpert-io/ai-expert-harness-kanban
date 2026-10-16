import { execFileSync } from 'node:child_process';
import { git } from './git-workspace.mjs';
import { syncWithBase } from './branch-sync.mjs';

const run = (command, args, options = {}) => execFileSync(command, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 8_000_000, stdio: [options.input ? 'pipe' : 'ignore', 'pipe', 'pipe'], ...options }).trim();
const tryRun = (command, args, options) => { try { return run(command, args, options); } catch { return null; } };
const reason = (error) => (error.stderr?.toString().trim() || error.message).split('\n').slice(-3).join(' ');

/**
 * Where human review happens. `github` pushes the feature branch and opens a PR with gh;
 * `local` keeps the branch in this repository and merges it when the person approves.
 */
export function detectReview(repo, { exec = run, env = process.env } = {}) {
  const branch = git(repo, 'symbolic-ref', '--short', 'HEAD');
  const remote = tryRun('git', ['remote', 'get-url', 'origin'], { cwd: repo });
  const forced = env.HARNESS_REVIEW;
  const github = forced !== 'local' && remote && /github\.com[/:]/.test(remote) && (() => { try { exec('gh', ['auth', 'status'], { cwd: repo }); return true; } catch { return false; } })();
  if (forced === 'github' && !github) throw new Error('HARNESS_REVIEW=github requiere un remoto origin en GitHub y gh autenticado');
  if (!github) return { mode: 'local', base: branch };
  const remoteHead = tryRun('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: repo });
  return { mode: 'github', base: remoteHead?.replace(/^origin\//, '') ?? branch, remote };
}

export function prBody(run) {
  const validation = [...(run.steps ?? [])].reverse().find((step) => step.role === 'validator' && step.verdict === 'accept');
  return [
    `Feature \`${run.taskId}\` completada por el harness y aceptada por un validator independiente.`,
    `## Qué se ha hecho\n\n${run.summary ?? validation?.summary ?? ''}`,
    `## Evidencia\n\n${(validation?.evidence ?? []).map((item) => `- ${item}`).join('\n') || '- Ver PROGRESS.md'}`,
    `## Cómo probarlo\n\n${run.testing ?? ''}`,
    `## Contexto\n\n- Spec: \`docs/specs/${run.taskId}.md\`\n- Estado: \`feature_list.json\` → \`accepted\`\n- Harness-Run: \`${run.id}\``,
    'Revisión humana pendiente. El harness no hace merge por su cuenta.'
  ].join('\n\n');
}

/** owner/name from a GitHub remote URL (https or ssh). */
export function repoSlug(remote = '') {
  return remote.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

export function createReview(settings, repo, { exec = run } = {}) {
  const github = settings.mode === 'github';
  // Always name the repo: with an `upstream` remote (a fork, as the course sets up), gh would pick upstream.
  const slug = repoSlug(settings.remote ?? (github ? tryRun('git', ['remote', 'get-url', 'origin'], { cwd: repo }) : ''));
  const gh = (args, options) => exec('gh', [...args, ...(slug ? ['--repo', slug] : [])], options);
  return {
    settings,
    /** The ref new feature branches start from; for GitHub it is refreshed first so merged PRs are included. */
    baseRef() {
      if (!github) return `refs/heads/${settings.base}`;
      exec('git', ['fetch', '--quiet', 'origin', settings.base], { cwd: repo });
      return `refs/remotes/origin/${settings.base}`;
    },
    publish(current, { feedback } = {}) {
      if (!github) return { branch: current.branch };
      try {
        exec('git', ['push', '--quiet', '-u', 'origin', `${current.branch}:${current.branch}`], { cwd: current.worktree });
        if (current.pr) {
          if (feedback) gh(['pr', 'comment', String(current.pr.number), '--body-file', '-'], { cwd: current.worktree, input: `Cambios pedidos en la revisión humana, ya aplicados y revalidados:\n\n> ${feedback.replace(/\n/g, '\n> ')}\n\n${current.summary ?? ''}` });
          return current.pr;
        }
        const url = gh(['pr', 'create', '--base', settings.base, '--head', current.branch, '--title', `feat: ${current.title} (${current.taskId})`, '--body-file', '-'], { cwd: current.worktree, input: prBody(current) }).split('\n').at(-1);
        return { url, number: Number(url.match(/\/pull\/(\d+)/)?.[1]) };
      } catch (error) { throw new Error(`No se pudo publicar la PR: ${reason(error)}`); }
    },
    /** open · merged · closed */
    status(current) {
      if (github) {
        const view = JSON.parse(gh(['pr', 'view', String(current.pr.number), '--json', 'state'], { cwd: repo }));
        return view.state === 'MERGED' ? 'merged' : view.state === 'CLOSED' ? 'closed' : 'open';
      }
      try { git(repo, 'rev-parse', '--verify', `refs/heads/${current.branch}`); } catch { return 'closed'; }
      try { git(repo, 'merge-base', '--is-ancestor', current.branch, settings.base); return 'merged'; } catch { return 'open'; }
    },
    /** Integrates base changes (other merged features) so the review stays mergeable. */
    sync(current) {
      const result = syncWithBase(current.worktree, this.baseRef());
      if (result.changed && github) exec('git', ['push', '--quiet', 'origin', `${current.branch}:${current.branch}`], { cwd: current.worktree });
      return result;
    },
    merge(current) {
      if (github) {
        try { gh(['pr', 'merge', String(current.pr.number), '--squash'], { cwd: repo }); } catch (error) { throw new Error(`GitHub no permitió el merge: ${reason(error)}`); }
        return;
      }
      if (git(repo, 'symbolic-ref', '--short', 'HEAD') !== settings.base) throw new Error(`Cambia el repositorio a ${settings.base} para integrar la rama`);
      if (git(repo, 'status', '--porcelain', '--untracked-files=no')) throw new Error(`${settings.base} tiene cambios sin commit; haz el merge de ${current.branch} a mano`);
      try { git(repo, 'merge', '--no-ff', '--no-edit', '-m', `Merge ${current.branch}: ${current.title}`, current.branch); }
      catch (error) { try { git(repo, 'merge', '--abort'); } catch {} throw new Error(`No se pudo integrar ${current.branch}: ${reason(error)}`); }
    }
  };
}
