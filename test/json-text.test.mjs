import assert from 'node:assert/strict';
import test from 'node:test';
import { jsonLike, prettierJson } from '../harness/json-text.mjs';

const features = [
  { id: 'cart-add', depends_on: ['product-detail'], status: 'not_started', verification: ['Una frase de verificación bastante larga para que no quepa en una sola línea de ochenta.'], evidence: [] },
  { id: 'cart-manage', depends_on: ['cart-add', 'product-detail'], status: 'not_started', verification: ['Corta'], evidence: [] }
];

test('estilo Prettier: listas cortas en una línea, las largas desplegadas', () => {
  const text = prettierJson(features);
  assert.match(text, /^ {4}"depends_on": \["product-detail"\],$/m);
  assert.match(text, /^ {4}"depends_on": \["cart-add", "product-detail"\],$/m);
  assert.match(text, /^ {4}"verification": \[\n {6}"Una frase/m);
  assert.match(text, /^ {4}"verification": \["Corta"\],$/m);
  assert.ok(text.endsWith('}\n]\n'));
});

test('respeta el estilo del archivo que reemplaza: cambiar un estado es un diff de una línea', () => {
  for (const original of [prettierJson(features), `${JSON.stringify(features, null, 2)}\n`]) {
    const changed = structuredClone(features);
    changed[0].status = 'accepted';
    const before = original.split('\n');
    const after = jsonLike(original, changed).split('\n');
    assert.equal(after.length, before.length);
    assert.deepEqual(after.filter((line, index) => line !== before[index]), ['    "status": "accepted",']);
  }
});
