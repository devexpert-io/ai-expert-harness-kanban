import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

const piBin = process.env.PI_BIN ?? 'pi';
const child = spawn(piBin, ['--mode', 'rpc', '--no-session'], { stdio: ['pipe', 'pipe', 'pipe'] });
const decoder = new StringDecoder('utf8');
let buffer = '';
let stderr = '';
let finished = false;

function finish(error, state) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  child.kill();
  if (error) {
    console.error(error.message);
    process.exitCode = 1;
    return;
  }
  console.log(`Pi RPC disponible · modelo ${state.model?.id ?? 'sin configurar'} · streaming ${state.isStreaming}`);
}

function consume() {
  while (true) {
    const newline = buffer.indexOf('\n');
    if (newline === -1) return;
    let line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (!line) continue;
    try {
      const record = JSON.parse(line);
      if (record.id === 'health' && record.type === 'response') {
        if (!record.success) finish(new Error(record.error ?? 'Pi RPC rechazó get_state'));
        else finish(null, record.data);
      }
    } catch {
      finish(new Error('Pi RPC produjo una línea no JSON'));
    }
  }
}

const timeout = setTimeout(() => finish(new Error('Pi RPC no respondió en 5 segundos')), 5_000);
child.on('error', (error) => finish(error));
child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
child.stdout.on('data', (chunk) => { buffer += decoder.write(chunk); consume(); });
child.on('exit', (code) => { if (!finished) finish(new Error(stderr.trim() || `Pi RPC terminó con código ${code}`)); });
child.stdin.write(`${JSON.stringify({ id: 'health', type: 'get_state' })}\n`);
