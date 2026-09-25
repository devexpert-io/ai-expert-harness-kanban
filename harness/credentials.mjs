import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const variable = 'DEVEXPERT_API_KEY';
export const modelsUrl = 'https://inference.devexpert.io/v1/models';

/**
 * The DevExpert Inference key for Pi. A key entered in the UI lives in memory, or in a 0600 file
 * next to the state when the person asks to remember it. The value is never sent back to the browser.
 */
export class Credentials {
  constructor({ path = null, env = process.env } = {}) {
    this.path = path;
    this.baseEnv = env;
    this.key = null;
    this.source = null;
    if (path && existsSync(path)) {
      const saved = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof saved.apiKey === 'string' && saved.apiKey) { this.key = saved.apiKey; this.source = 'saved'; }
    }
  }
  status() {
    if (this.key) return { configured: true, source: this.source };
    return { configured: Boolean(this.baseEnv[variable]), source: this.baseEnv[variable] ? 'env' : null };
  }
  set(apiKey, remember = false) {
    if (typeof apiKey !== 'string' || !apiKey.trim() || apiKey.length > 512 || /\s/.test(apiKey.trim())) throw new Error('La API key no tiene un formato válido');
    this.key = apiKey.trim();
    this.source = remember ? 'saved' : 'ui';
    if (this.path) {
      if (remember) {
        mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
        writeFileSync(this.path, JSON.stringify({ apiKey: this.key }), { mode: 0o600 });
        chmodSync(this.path, 0o600);
      } else rmSync(this.path, { force: true });
    }
  }
  clear() {
    this.key = null;
    this.source = null;
    if (this.path) rmSync(this.path, { force: true });
  }
  /** Environment for Pi child processes. */
  env() { return this.key ? { ...this.baseEnv, [variable]: this.key } : this.baseEnv; }
}

/** Checks a key against the provider without running inference. */
export async function verifyKey(apiKey, { fetchImpl = fetch } = {}) {
  let response;
  try { response = await fetchImpl(modelsUrl, { headers: { authorization: `Bearer ${apiKey.trim()}` }, signal: AbortSignal.timeout(8_000) }); }
  catch { throw new Error('No se pudo contactar con DevExpert Inference para comprobar la clave'); }
  if (response.status === 401 || response.status === 403) throw new Error('DevExpert Inference ha rechazado la API key');
  if (!response.ok) throw new Error(`DevExpert Inference respondió ${response.status} al comprobar la clave`);
}
