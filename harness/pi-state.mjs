import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { pinnedPi, providerExtension } from './pi-config.mjs';

// Read local configuration without inference, project extensions or credential changes.
export function readPiState({ piBin = 'pi', cwd, signal } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Ejecución cancelada'));
  return new Promise((resolve, reject) => {
    const child = spawn(piBin, ['--mode', 'rpc', '--no-session', '--no-approve', '--no-extensions', '--no-skills', '--no-context-files', '--extension', providerExtension, '--provider', pinnedPi.provider, '--model', pinnedPi.model], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let finished = false;
    let buffer = '';
    let stderr = '';
    const decoder = new StringDecoder('utf8');
    const finish = (error, state) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      child.kill();
      error ? reject(error) : resolve(state);
    };
    const abort = () => finish(new Error('Ejecución cancelada'));
    const timer = setTimeout(() => finish(new Error('Pi no respondió al consultar su proveedor configurado')), 5_000);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk).slice(-4_000); });
    child.on('close', () => finish(new Error(stderr || 'Pi terminó sin configuración')));
    child.stdout.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { return finish(new Error('Pi devolvió una configuración RPC inválida')); }
        if (event.id === 'harness-state' && event.type === 'response') finish(event.success ? null : new Error(event.error), event.data);
      }
    });
    child.stdin.write(`${JSON.stringify({ id: 'harness-state', type: 'get_state' })}\n`);
  });
}
