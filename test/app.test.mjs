import assert from 'node:assert/strict';
import test from 'node:test';
import { html } from '../public/ui/html.js';
import { executionOrder, notices, queueSummary, selectable, tasks, toggleSelection, waiting, byId } from '../public/ui/model.js';
import { renderBoard } from '../public/ui/board.js';
import { renderDetail } from '../public/ui/detail.js';

// Pure view-model and markup checks; no browser or screenshot verification is claimed here.
const task = (id, extra = {}) => ({ id, title: `Feature ${id}`, area: 'test', state: 'pending', sourceStatus: 'not_started', objective: 'Works', dependsOn: [], criteria: ['A check'], evidence: [], gate: 'Pendiente', blocked: null, ...extra });
const accepted = (id, extra) => task(id, { state: 'done', sourceStatus: 'accepted', gate: 'Aceptada', ...extra });
const snapshot = (items, runs = []) => ({ project: { path: '/fixture', name: 'Example', tasks: items }, projectPath: '/fixture', runs, error: null,
  runtime: { ready: true, roles: [], notice: 'Fixture runtime' }, pi: { installed: true, version: 'fixture', credentials: { configured: true, source: 'env' } }, paused: false });
const run = (taskId, status, extra = {}) => ({ id: `run-${taskId}-${status}`, taskId, status, stage: status === 'review' ? 'review' : 'pending', events: [], steps: [], ...extra });

test('html escapa interpolaciones pero conserva fragmentos compuestos', () => {
  assert.equal(String(html`<p>${'<script>'}</p>${html`<b>${'&'}</b>`}`), '<p>&lt;script&gt;</p><b>&amp;</b>');
  const board = String(renderBoard(tasks(snapshot([task('one', { title: '<img src=x onerror=alert(1)>' })])), { selection: new Set(), focused: null }));
  assert.match(board, /&lt;img src=x/);
  assert.doesNotMatch(board, /<img/);
});

test('seleccionar añade dependencias pendientes y quitar retira las dependientes', () => {
  const all = tasks(snapshot([task('a'), task('b', { dependsOn: ['a'] }), task('c', { dependsOn: ['b'] }), accepted('d'), task('e', { dependsOn: ['d'] })]));
  const picked = toggleSelection(new Set(), 'c', true, all);
  assert.deepEqual([...picked.selection].sort(), ['a', 'b', 'c']);
  assert.deepEqual(picked.changed.sort(), ['a', 'b']);
  assert.deepEqual(executionOrder(picked.selection, all).map((item) => item.id), ['a', 'b', 'c']);
  const dropped = toggleSelection(picked.selection, 'a', false, all);
  assert.deepEqual([...dropped.selection], []);
  assert.deepEqual(toggleSelection(new Set(), 'e', true, all).changed, []);
});

test('una dependencia aceptada pero en revisión humana sigue bloqueando a sus dependientes', () => {
  const all = tasks(snapshot([accepted('a'), task('b', { dependsOn: ['a'] })], [run('a', 'review', { commit: 'abcdef1234' }), run('b', 'queued')]));
  const index = byId(all);
  assert.deepEqual(waiting(index.get('b'), index), { review: ['a'], other: [] });
  assert.equal(all.find((item) => item.id === 'a').state, 'review');
  const summary = queueSummary(snapshot([], [run('a', 'review'), run('b', 'queued')]), all);
  assert.equal(summary.label, 'La cola espera tu revisión');
  assert.match(String(renderBoard(all, { selection: new Set(), focused: null })), /espera tu revisión de a/);
  assert.match(String(renderBoard(all, { selection: new Set(), focused: null })), /Tu turno/);
});

test('los avisos se derivan del estado y desaparecen al corregirse', () => {
  const broken = snapshot([task('a')]);
  broken.runtime = { ready: false, error: 'Falta AGENTS.md en el proyecto', roles: [] };
  broken.pi.credentials = { configured: false, source: null };
  assert.deepEqual(notices(broken, { online: true }).map((item) => item.level), ['error', 'warn']);
  assert.deepEqual(notices(snapshot([task('a')]), { online: true }), []);
  assert.equal(notices(null, { online: false }).length, 1);
});

test('el detalle en revisión ofrece aprobar o pedir cambios y muestra iteraciones previas', () => {
  const previous = run('a', 'changes-requested', { id: 'old', commit: '1111111111', feedback: 'Cambia <el> botón' });
  const current = run('a', 'review', { id: 'new', commit: '2222222222', testing: 'Abre /health', files: ['src/a.js'], humanFeedback: 'Cambia <el> botón' });
  const all = tasks(snapshot([accepted('a')], [previous, current]));
  const markup = String(renderDetail(all[0], { all, busy: false, review: { mode: 'local', base: 'main' } }));
  assert.match(markup, /data-action="merge"[^>]*>Integrar en main/);
  assert.match(markup, /data-action="reject"/);
  assert.match(markup, /Cambios pedidos/);
  assert.match(markup, /Cambia &lt;el&gt; botón/);
  assert.match(markup, /22222222/);
  assert.equal(selectable(all[0]), false);
});

test('una feature en cola no se puede volver a seleccionar y su tarjeta no inventa actividad', () => {
  const all = tasks(snapshot([task('a')], [run('a', 'queued')]));
  assert.equal(selectable(all[0]), false);
  const board = String(renderBoard(all, { selection: new Set(), focused: null }));
  assert.match(board, /En cola/);
  assert.doesNotMatch(board, /type="checkbox"/);
  assert.match(String(renderBoard([], { selection: new Set(), focused: null, emptyReason: 'Falta feature_list.json' })), /Falta feature_list.json/);
});

test('en GitHub la revisión enlaza la PR y un merge integrado cuenta como aceptada', () => {
  const inReview = run('a', 'review', { commit: '3333333333', pr: { url: 'https://github.com/acme/shop/pull/7', number: 7 }, branch: 'feat/a' });
  const all = tasks(snapshot([task('a'), task('b', { dependsOn: ['a'] })], [inReview]));
  const markup = String(renderDetail(all[0], { all, busy: false, review: { mode: 'github', base: 'main' } }));
  assert.match(markup, /href="https:\/\/github.com\/acme\/shop\/pull\/7"/);
  assert.match(markup, />Mergear PR</);
  assert.match(String(renderBoard(all, { selection: new Set(), focused: null })), /PR #7 · pendiente de tu revisión/);
  const merged = tasks(snapshot([task('a'), task('b', { dependsOn: ['a'] })], [{ ...inReview, status: 'done', stage: 'done' }]));
  assert.equal(merged[0].state, 'done');
  assert.equal(selectable(merged[0]), false);
  assert.deepEqual(waiting(merged[1], byId(merged)), { review: [], other: [] });
});

test('el resumen de cola describe varias features en paralelo', () => {
  const runs = [run('a', 'running', { role: 'planner' }), run('b', 'running', { role: 'implementer' }), run('c', 'queued')];
  const all = tasks(snapshot([task('a'), task('b'), task('c', { dependsOn: ['a'] })], runs));
  const summary = queueSummary({ ...snapshot([], runs), maxParallel: 3 }, all);
  assert.equal(summary.label, '2 features en paralelo');
  assert.match(summary.help, /a · planner · b · implementer · 1 en cola/);
});
