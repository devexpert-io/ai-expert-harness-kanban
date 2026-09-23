import { readPiState } from '../harness/pi-state.mjs';

try {
  const state = await readPiState({ piBin: process.env.PI_BIN ?? 'pi', cwd: process.cwd() });
  console.log(`Pi RPC disponible · proveedor ${state.model?.provider ?? 'sin configurar'} · modelo ${state.model?.id ?? 'sin configurar'} · streaming ${state.isStreaming}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
