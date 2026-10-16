import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeFeatureLists } from '../harness/branch-sync.mjs';
import { createReview, detectReview, prBody } from '../harness/review.mjs';
import { fixture } from './fixtures.mjs';

const entry = (id, status) => ({ id, status });

test('la fusión de feature_list conserva lo que cambió cada rama', () => {
  const base = [entry('a', 'not_started'), entry('b', 'not_started')];
  const ours = [entry('a', 'not_started'), entry('b', 'accepted')];
  const theirs = [entry('a', 'accepted'), entry('b', 'not_started'), entry('c', 'not_started')];
  assert.deepEqual(mergeFeatureLists(base, ours, theirs), [entry('a', 'accepted'), entry('b', 'accepted'), entry('c', 'not_started')]);
});

test('sin remoto de GitHub o sin gh autenticado se revisa en ramas locales', () => {
  const cwd = fixture();
  assert.deepEqual(detectReview(cwd, { env: {} }), { mode: 'local', base: 'main' });
  assert.throws(() => detectReview(cwd, { env: { HARNESS_REVIEW: 'github' } }), /requiere un remoto/);
});

test('GitHub: publica rama y PR con evidencia, comenta el feedback y sigue su estado', () => {
  const calls = [];
  const replies = { 'gh pr create': 'https://github.com/acme/shop/pull/42', 'gh pr view': '{"state":"MERGED"}' };
  const exec = (command, args, options) => {
    calls.push({ command: `${command} ${args.join(' ')}`, input: options.input, cwd: options.cwd });
    return Object.entries(replies).find(([prefix]) => `${command} ${args.join(' ')}`.startsWith(prefix))?.[1] ?? '';
  };
  const review = createReview({ mode: 'github', base: 'main', remote: 'https://github.com/acme/shop.git' }, '/repo', { exec });
  const run = { id: 'run-1', taskId: 'cart-add', title: 'Añadir al carrito', branch: 'feat/cart-add', worktree: '/wt', summary: 'Carrito listo', testing: 'pnpm dev y añade un producto',
    steps: [{ role: 'validator', verdict: 'accept', summary: 'OK', evidence: ['init.sh verde'] }] };
  assert.equal(review.baseRef(), 'refs/remotes/origin/main');
  const pr = review.publish(run);
  assert.deepEqual(pr, { url: 'https://github.com/acme/shop/pull/42', number: 42 });
  const create = calls.find((call) => call.command.startsWith('gh pr create'));
  assert.match(create.command, /--base main --head feat\/cart-add --title feat: Añadir al carrito \(cart-add\) --body-file - --repo acme\/shop$/);
  assert.match(create.input, /init.sh verde/);
  assert.match(create.input, /pnpm dev y añade un producto/);
  assert.ok(calls.some((call) => call.command === 'git push --quiet -u origin feat/cart-add:feat/cart-add' && call.cwd === '/wt'));
  review.publish({ ...run, pr }, { feedback: 'Falta el contador' });
  assert.match(calls.find((call) => call.command.startsWith('gh pr comment 42')).input, /> Falta el contador/);
  assert.equal(review.status({ ...run, pr }), 'merged');
  review.merge({ ...run, pr });
  assert.ok(calls.some((call) => call.command === 'gh pr merge 42 --squash --repo acme/shop'));
  assert.match(prBody(run), /Revisión humana pendiente/);
});

test('gh siempre apunta al fork (origin), aunque exista un remoto upstream', async () => {
  const { repoSlug } = await import('../harness/review.mjs');
  assert.equal(repoSlug('https://github.com/antoniolg/tienda-m6.git'), 'antoniolg/tienda-m6');
  assert.equal(repoSlug('git@github.com:antoniolg/tienda-m6.git'), 'antoniolg/tienda-m6');
  assert.equal(repoSlug('https://github.com/devexpert-io/ai-expert-project'), 'devexpert-io/ai-expert-project');
  const calls = [];
  const exec = (command, args) => { calls.push(`${command} ${args.join(' ')}`); return args[1] === 'view' ? '{"state":"OPEN"}' : ''; };
  const review = createReview({ mode: 'github', base: 'main', remote: 'https://github.com/antoniolg/tienda-m6.git' }, '/repo', { exec });
  review.status({ pr: { number: 3 } });
  assert.deepEqual(calls, ['gh pr view 3 --json state --repo antoniolg/tienda-m6']);
});
