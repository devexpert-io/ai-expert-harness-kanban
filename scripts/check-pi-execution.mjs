import assert from 'node:assert/strict';
import { chmodSync, cpSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { executeFeature } from '../harness/feature-flow.mjs';
import { loadRuntime } from '../harness/project-runtime.mjs';
import { git } from '../harness/git-workspace.mjs';
import { fixture, feature, put } from '../test/fixtures.mjs';
import { piOptions } from '../harness/pi-config.mjs';

// This is an opt-in paid provider check. Never operates on the source repository.
if (!process.env.HARNESS_SOURCE_PROJECT) throw new Error('Indica HARNESS_SOURCE_PROJECT para copiar sus skills y roles a una fixture desechable');
const source = realpathSync(process.env.HARNESS_SOURCE_PROJECT);
const runtime = loadRuntime(source);
const task = feature('greeting');
task.user_visible_behavior = 'Export hello(name) from greeting.mjs. hello("AI Expert") returns exactly "Hello, AI Expert!". Add a Node test. No UI, dependencies, network, or server.';
task.verification = ['CI=true ./init.sh passes a real Node test of hello("AI Expert")'];
const cwd = fixture([task]);
for (const entry of runtime.sources) {
  if (entry.path !== 'AGENTS.md') cpSync(join(source, entry.path), join(cwd, entry.path), { recursive: true });
}
put(cwd, 'AGENTS.md', '# Disposable smoke fixture\n\nUse configured planner, implementer and validator and their skills. This repository is a tiny Node module, not the source product. Work only here. No dependencies, network, push or deploy. Standard gate: CI=true ./init.sh. Never change init.sh or the harness configuration. The main orchestrator owns commits.\n');
put(cwd, 'CONSTRAINTS.md', '# Constraints\nNo dependencies or external services.\n');
put(cwd, 'ARCHITECTURE.md', '# Architecture\nA Node ES module with a node:test test.\n');
put(cwd, 'init.sh', '#!/bin/sh\nset -eu\nnode --test greeting.test.mjs\n');
chmodSync(join(cwd, 'init.sh'), 0o755);
git(cwd, 'add', '--all');
git(cwd, 'commit', '-m', 'test: prepare independent Pi flow smoke');
const run = { id: `smoke-${Date.now()}`, taskId: task.id, steps: [], events: [], status: 'running' };
console.log(`Fixture: ${cwd}`);
try {
  await executeFeature({ cwd, run, save() {}, emit: (event) => console.log(event.message), piOptions: { ...piOptions(), timeoutMs: 180_000 } });
  assert.equal(run.status, 'review');
  assert.equal(JSON.parse(readFileSync(join(cwd, 'feature_list.json')))[0].status, 'accepted');
  assert.ok(run.commit);
  const { hello } = await import(join(cwd, 'greeting.mjs'));
  assert.equal(hello('AI Expert'), 'Hello, AI Expert!');
  console.log(`Pi E2E OK · ${run.steps.length} roles · revisión humana · commit ${run.commit}`);
} finally {
  console.log(`Fixture conservada para inspección: ${cwd}`);
}
