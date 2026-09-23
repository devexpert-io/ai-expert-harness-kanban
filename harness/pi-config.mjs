import { fileURLToPath } from 'node:url';

// Explicit product choice. Never inherit a provider/model from credentials or Pi defaults.
export const pinnedPi = Object.freeze({ provider: 'devexpert', model: 'chat', name: 'DevExpert Inference' });
export const providerExtension = fileURLToPath(new URL('./devexpert-provider.mjs', import.meta.url));

export function piOptions(env = process.env) {
  return { piBin: env.PI_BIN ?? 'pi', provider: pinnedPi.provider, model: pinnedPi.model, timeoutMs: Number(env.PI_TIMEOUT_MS ?? 1_800_000) };
}
