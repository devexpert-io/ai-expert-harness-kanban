// Paso 5 · Varias features a la vez, cada una en su worktree, y una PR como revisión humana.
// node 05-paralelo-y-pr.mjs <proyecto> [--pr]
import { execFileSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { completeFeature } from './04-el-host-decide.mjs';
import { git, readFeatures, readyFeatures } from './03-la-cola.mjs';

const [project, flag] = process.argv.slice(2);
const ready = readyFeatures(readFeatures(project));
console.log(`Listas en paralelo: ${ready.map((item) => item.id).join(', ') || 'ninguna'}`);

// Misma base para todas: ninguna ve los archivos de las demás.
const base = git(project, 'rev-parse', 'HEAD');
const outcomes = await Promise.allSettled(ready.map(async (feature) => {
  const branch = `feat/${feature.id}`;
  const worktree = join(dirname(project), `${basename(project)}-wt-${feature.id}`);
  git(project, 'worktree', 'add', '-b', branch, worktree, base);
  const accepted = await completeFeature(worktree, feature, { onStep: (role) => console.log(`[${feature.id}] ▶ ${role}`) });
  if (flag === '--pr') {
    git(worktree, 'push', '-u', 'origin', branch);
    const body = `${accepted.summary}\n\n## Evidencia\n${accepted.evidence.map((item) => `- ${item}`).join('\n')}\n\n## Cómo probarlo\n${accepted.testing}`;
    const url = execFileSync('gh', ['pr', 'create', '--head', branch, '--title', `feat: ${feature.title} (${feature.id})`, '--body', body], { cwd: worktree, encoding: 'utf8' }).trim();
    return `${feature.id} → ${url}`;
  }
  return `${feature.id} → rama ${branch} (${accepted.commit})`;
}));

for (const [index, outcome] of outcomes.entries()) {
  console.log(outcome.status === 'fulfilled' ? `✔ ${outcome.value}` : `✕ ${ready[index].id}: ${outcome.reason.message}`);
}
console.log('\nRevisión humana: el merge lo decides tú. Las dependientes esperan a que integres.');
