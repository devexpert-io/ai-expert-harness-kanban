import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { roleSkills } from '../harness/project-runtime.mjs';
import { featureChanges } from '../harness/git-workspace.mjs';

export function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
}
export function feature(id = 'example', depends_on = []) {
  return { id, area: 'test', title: `Feature ${id}`, user_visible_behavior: `Works: ${id}`, depends_on, status: 'not_started', verification: ['node --test passes'], evidence: [], notes: 'Disposable fixture' };
}
export function fixture(features = [feature()]) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ai-expert-harness-test-')));
  put(root, 'AGENTS.md', 'Follow the configured roles. Do not push or deploy.');
  put(root, 'PROGRESS.md', '# Progress\n');
  put(root, 'feature_list.json', JSON.stringify(features, null, 2));
  put(root, '.agents/skills/feature-flow/SKILL.md', '# Feature flow\nplanner -> implementer -> validator; accept -> commit.');
  let config = '[agents]\nenabled = true\n';
  for (const [role, skill] of Object.entries(roleSkills)) {
    config += `\n[agents.${role}]\nconfig_file = "./agents/${role}.toml"\n`;
    put(root, `.codex/agents/${role}.toml`, `name = "${role}"\nmodel = "fixture-model"\nmodel_reasoning_effort = "max"\nsandbox_mode = "workspace-write"\ndeveloper_instructions = """\nFixture ${role} instructions.\n"""\n`);
    put(root, `.agents/skills/${skill}/SKILL.md`, `# ${skill}\nUse the actual ${role} responsibilities.`);
  }
  put(root, '.codex/config.toml', config);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Harness fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  git('add', '.');
  git('commit', '-m', 'test: fixture baseline');
  return root;
}
export function fakeExecutor({ revise = false, calls = [], hook } = {}) {
  let validations = 0;
  return async (context) => {
    const { cwd, task, role, baseline } = context;
    calls.push(`${task.id}:${role.name}`);
    await hook?.(context);
    const spec = `docs/specs/${task.id}.md`;
    const evidence = ['node --test: 1 passed, 0 failed (fixture)'];
    if (role.name === 'planner') {
      put(cwd, spec, `# ${task.id}\nA bounded specification.\n`);
      return { outcome: 'ready', summary: 'Specification ready', evidence, files: [spec] };
    }
    if (role.name === 'implementer') {
      const features = JSON.parse(readFileSync(join(cwd, 'feature_list.json')));
      Object.assign(features.find((item) => item.id === task.id), { status: 'passing', evidence });
      put(cwd, 'feature_list.json', `${JSON.stringify(features, null, 2)}\n`);
      put(cwd, `src/${task.id}.js`, `// ${context.repairBrief ?? 'implemented'}\n`);
      put(cwd, 'PROGRESS.md', `${readFileSync(join(cwd, 'PROGRESS.md'), 'utf8')}\n${task.id} passing\n`);
      return { outcome: 'passing', summary: 'Implemented', evidence, files: ['feature_list.json', 'PROGRESS.md', `src/${task.id}.js`] };
    }
    return { verdict: revise && validations++ === 0 ? 'revise' : 'accept', summary: 'Independent checks passed', evidence,
      repairBrief: 'Fix the fixture edge case', testing: 'Run node --test; inspect the example', files: featureChanges(cwd, baseline) };
  };
}
export async function until(predicate, timeoutMs = 5_000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('Fixture timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
