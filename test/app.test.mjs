import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Unit-test UI state/rendering without claiming browser or screenshot verification.
test('la UI muestra el proyecto y permite seleccionar una feature sin inventar actividad', async () => {
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, { textContent: '', innerHTML: '', hidden: false, disabled: false, events: {},
      querySelectorAll: () => [], addEventListener(name, callback) { this.events[name] = callback; } });
    return elements.get(id);
  };
  const state = { project: { path: '/fixture', name: 'Example', tasks: [{ id: 'one', title: '<script>unsafe</script>', state: 'pending', sourceStatus: 'not_started', objective: 'Works', dependsOn: [], criteria: ['A check'], evidence: [], gate: 'Pending' }] },
    projectPath: '/fixture', runs: [], runtime: { ready: true, roles: [], notice: 'Fixture runtime' }, pi: { installed: true, version: 'fixture' }, paused: false };
  const document = { getElementById: get, activeElement: null };
  runInNewContext(readFileSync(new URL('../app.js', import.meta.url), 'utf8'), { document, fetch: async () => ({ ok: true, json: async () => state }), setTimeout() {}, confirm: () => false });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(get('project-name').textContent, 'Example');
  assert.equal(get('workspace').hidden, false);
  assert.equal(get('execute').disabled, true);
  assert.match(get('board').innerHTML, /&lt;script&gt;unsafe/);
  assert.doesNotMatch(get('board').innerHTML, /<script>/);
  get('board').events.change({ target: { dataset: { select: 'one' }, checked: true } });
  assert.equal(get('execute').textContent, 'Ejecutar selección (1)');
  assert.equal(get('execute').disabled, false);
  assert.doesNotMatch(get('board').innerHTML, /Sesión iniciada|Pi planificando/);
});
