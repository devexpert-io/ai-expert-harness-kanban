import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pinnedPi, piOptions } from '../harness/pi-config.mjs';
import registerDevExpert from '../harness/devexpert-provider.mjs';

test('proveedor y modelo fijados no cambian por variables de entorno', () => {
  const options = piOptions({ PI_PROVIDER: 'openai', PI_MODEL: 'another-model', OPENAI_API_KEY: 'test-placeholder', PI_TIMEOUT_MS: '5000' });
  assert.equal(options.provider, 'devexpert');
  assert.equal(options.model, 'chat');
  assert.equal(options.timeoutMs, 5000);
  assert.equal(pinnedPi.name, 'DevExpert Inference');
});

test('extensión registra solo chat contra DevExpert usando referencia de entorno', () => {
  const calls = [];
  registerDevExpert({ registerProvider: (...args) => calls.push(args) });
  assert.equal(calls.length, 1);
  const [provider, config] = calls[0];
  assert.equal(provider, 'devexpert');
  assert.equal(config.baseUrl, 'https://inference.devexpert.io/v1');
  assert.equal(config.apiKey, '$DEVEXPERT_API_KEY');
  assert.deepEqual(config.models.map((model) => model.id), ['chat']);
});

test('PI_BIN relativo se resuelve, porque Pi se ejecuta dentro del worktree', () => {
  assert.equal(piOptions({ PI_BIN: 'examples/mini-harness/fake-pi.mjs' }).piBin, resolve('examples/mini-harness/fake-pi.mjs'));
  assert.equal(piOptions({ PI_BIN: '/opt/pi' }).piBin, '/opt/pi');
  assert.equal(piOptions({}).piBin, 'pi');
});
