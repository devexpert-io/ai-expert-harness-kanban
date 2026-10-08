import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { action, decide, parsePermissions } from '../harness/opencode-permissions.mjs';

// Frontmatter copied from the course shop (.opencode/agents/*.md at modulo-5).
const planner = `---
description: Wrapper agent that delegates planning work to $feature-spec.
mode: subagent
permission:
  read: allow
  glob: allow
  edit:
    "*": deny
    "docs/specs/*": allow
    feature_list.json: allow
  bash: deny
  skill:
    "*": deny
    feature-spec: allow
  task: deny
  external_directory: deny
---

You are the planner subagent.`;
const validator = `---
mode: subagent
permission:
  read: allow
  edit: deny
  bash: allow
  external_directory: deny
---
Validate.`;
const cwd = join(homedir(), 'Projects', 'tienda');

test('lee los permisos anidados del frontmatter de OpenCode', () => {
  assert.deepEqual(parsePermissions(planner), {
    read: 'allow', glob: 'allow', edit: { '*': 'deny', 'docs/specs/*': 'allow', 'feature_list.json': 'allow' },
    bash: 'deny', skill: { '*': 'deny', 'feature-spec': 'allow' }, task: 'deny', external_directory: 'deny'
  });
  assert.deepEqual(parsePermissions('---\nmode: subagent\n---\nbody'), {});
});

test('como en OpenCode, gana la última regla que encaja', () => {
  const rule = { '*': 'deny', 'docs/specs/*': 'allow' };
  assert.equal(action(rule, 'docs/specs/cart-add.md'), 'allow');
  assert.equal(action(rule, 'src/app/page.tsx'), 'deny');
  assert.equal(action({ 'docs/specs/*': 'allow', '*': 'deny' }, 'docs/specs/cart-add.md'), 'deny');
  assert.equal(action({ 'git push*': 'ask' }, 'git status'), 'allow');
});

test('el planner solo escribe specs y no ejecuta bash', () => {
  const rules = parsePermissions(planner);
  assert.equal(decide(rules, 'write', { path: 'docs/specs/cart-add.md' }, cwd), null);
  assert.equal(decide(rules, 'edit', { path: join(cwd, 'feature_list.json') }, cwd), null);
  assert.match(decide(rules, 'edit', { path: 'src/app/page.tsx' }, cwd), /edit «deny» para src\/app\/page.tsx/);
  assert.match(decide(rules, 'bash', { command: 'pnpm test' }, cwd), /bash «deny»/);
  assert.equal(decide(rules, 'read', { path: 'AGENTS.md' }, cwd), null);
});

test('nadie sale del proyecto a tu carpeta personal, ni leyendo ni por bash', () => {
  const rules = parsePermissions(validator);
  assert.match(decide(rules, 'read', { path: '~/.codex/skills/x/SKILL.md' }, cwd), /fuera del proyecto/);
  assert.match(decide(rules, 'bash', { command: 'ls ~/.pi/agent' }, cwd), /fuera del proyecto \(~\/.pi\/agent\)/);
  assert.match(decide(rules, 'bash', { command: 'cat $HOME/.ssh/id_rsa' }, cwd), /fuera del proyecto/);
  // System paths and the project itself stay usable: agents rely on them constantly.
  assert.equal(decide(rules, 'bash', { command: `cd ${cwd} && pnpm test 2>/dev/null` }, cwd), null);
  assert.equal(decide(rules, 'bash', { command: 'PATH=/opt/homebrew/opt/node@22/bin:$PATH ./init.sh' }, cwd), null);
  assert.match(decide(rules, 'write', { path: 'src/x.ts' }, cwd), /edit «deny»/);
});

test('sin reglas propias se aplican los valores por defecto de OpenCode', () => {
  assert.match(decide({}, 'read', { path: '.env' }, cwd), /read «deny» para .env/);
  assert.equal(decide({}, 'read', { path: '.env.example' }, cwd), null);
  assert.match(decide({}, 'read', { path: '/etc/hosts' }, cwd), /external_directory es «ask»/);
  assert.match(decide({ bash: { '*': 'allow', 'git push*': 'ask' } }, 'bash', { command: 'git push origin main' }, cwd), /bash «ask»/);
});
