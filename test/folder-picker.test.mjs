import assert from 'node:assert/strict';
import test from 'node:test';
import { selectProjectFolder } from '../harness/folder-picker.mjs';

test('devuelve únicamente la carpeta elegida por el selector nativo', async () => {
  const calls = [];
  const path = await selectProjectFolder({
    platform: 'darwin',
    execute: async (...args) => {
      calls.push(args);
      return { stdout: '/tmp/proyecto elegido/\n', stderr: '' };
    }
  });
  assert.equal(path, '/tmp/proyecto elegido/');
  assert.equal(calls[0][0], '/usr/bin/osascript');
  assert.match(calls[0][1][1], /choose folder/);
});

test('trata la cancelación del diálogo como una decisión sin error', async () => {
  const execute = async () => {
    const error = new Error('Command failed');
    error.stderr = 'execution error: User canceled. (-128)';
    throw error;
  };
  assert.equal(await selectProjectFolder({ platform: 'darwin', execute }), null);
});

test('rechaza el selector nativo fuera de macOS', async () => {
  await assert.rejects(() => selectProjectFolder({ platform: 'linux' }), /macOS/);
});
