import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';

export function buildPiPrompt(task) {
  return [
    `Ejecuta el slice ${task.id}: ${task.title}.`,
    `Objetivo: ${task.objective}`,
    `Rol principal: ${task.role}. Skill de referencia: ${task.skill}.`,
    'Trabaja únicamente dentro del repositorio actual y mantén el cambio acotado.',
    'Inspecciona primero, implementa, ejecuta verificaciones enfocadas y deja evidencia reproducible.',
    'No hagas merge, push, deploy, cambios de credenciales ni operaciones de producción.',
    'Termina con un resumen breve de archivos modificados, checks y riesgos para revisión humana.'
  ].join('\n');
}

export function mapPiEvent(event, task) {
  if (event.type === 'agent_start') {
    return { stage: 'planning', role: 'Planner', skill: task.skill, gate: 'Pi planificando', evidence: 'Pi · sesión iniciada' };
  }
  if (event.type === 'tool_execution_start') {
    return { stage: 'implementing', role: task.role, skill: task.skill, gate: `Pi · ${event.toolName}`, evidence: `Pi · herramienta ${event.toolName} iniciada` };
  }
  if (event.type === 'tool_execution_end') {
    return {
      stage: event.isError ? 'implementing' : 'validating',
      role: event.isError ? task.role : 'Validator',
      skill: event.isError ? task.skill : 'feature-validator',
      gate: event.isError ? `Error en ${event.toolName}` : `${event.toolName} completada`,
      evidence: `Pi · ${event.toolName} ${event.isError ? 'falló' : 'completada'}`,
      level: event.isError ? 'error' : 'info'
    };
  }
  if (event.type === 'extension_error') {
    return { stage: 'implementing', role: task.role, skill: task.skill, gate: 'Error de extensión', evidence: `Pi · ${event.error ?? 'error de extensión'}`, level: 'error' };
  }
  if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.stopReason === 'error') {
    return { stage: 'implementing', role: task.role, skill: task.skill, gate: 'Pi no pudo ejecutar la tarea', evidence: `Pi · ${event.message.errorMessage ?? 'error del proveedor'}`, level: 'error' };
  }
  return null;
}

function attachJsonlReader(stream, onRecord, onMalformed) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const consume = () => {
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      let line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) continue;
      try { onRecord(JSON.parse(line)); } catch { onMalformed(line); }
    }
  };
  stream.on('data', (chunk) => { buffer += decoder.write(chunk); consume(); });
  stream.on('end', () => { buffer += decoder.end(); consume(); });
}

export async function runPiTask({ task, cwd, emit, signal, piBin = 'pi', provider, model, timeoutMs = 600_000, spawnImpl = spawn }) {
  const args = ['--mode', 'rpc', '--no-session', '--name', `harness-${task.id}`];
  if (provider) args.push('--provider', provider);
  if (model) args.push('--model', model);

  return new Promise((resolve, reject) => {
    const child = spawnImpl(piBin, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let assistantText = '';
    let stderr = '';
    let agentError = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (!child.killed) child.kill();
      error ? reject(error) : resolve();
    };
    const timeout = setTimeout(() => finish(new Error(`Pi excedió ${timeoutMs} ms`)), timeoutMs);

    signal?.addEventListener('abort', () => {
      child.stdin.write(`${JSON.stringify({ type: 'abort' })}\n`);
      finish(new Error('Ejecución Pi cancelada'));
    }, { once: true });

    child.on('error', finish);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    attachJsonlReader(child.stdout, (event) => {
      const mapped = mapPiEvent(event, task);
      if (mapped) emit(mapped);
      if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
        assistantText += event.assistantMessageEvent.delta;
      }
      if (event.type === 'response' && event.command === 'prompt' && event.success === false) {
        finish(new Error(event.error ?? 'Pi rechazó el prompt'));
      }
      if (event.type === 'message_end' && event.message?.role === 'assistant' && event.message.stopReason === 'error') {
        agentError = new Error(event.message.errorMessage ?? 'Pi no pudo completar la tarea');
      }
      if (event.type === 'agent_settled') {
        if (agentError) return finish(agentError);
        const summary = assistantText.trim().replace(/\s+/g, ' ').slice(0, 220);
        emit({ stage: 'validating', role: 'Validator', skill: 'feature-validator', gate: 'Ejecución Pi finalizada', evidence: summary ? `Pi · ${summary}` : 'Pi · ejecución finalizada' });
        emit({ stage: 'review', role: 'Validator', skill: 'feature-validator', gate: 'Revisión humana requerida', evidence: 'Pi · STOP antes de merge, push o deploy' });
        finish();
      }
    }, (line) => emit({ stage: 'implementing', role: task.role, skill: task.skill, gate: 'Salida Pi no estructurada', evidence: `Pi · salida omitida (${line.length} caracteres)`, level: 'warning' }));

    child.on('exit', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Pi terminó con código ${code}`));
    });
    child.stdin.write(`${JSON.stringify({ id: `task-${task.id}`, type: 'prompt', message: buildPiPrompt(task) })}\n`);
  });
}
