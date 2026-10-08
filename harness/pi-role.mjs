import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { roleStages } from './project-runtime.mjs';
import { pinnedPi, providerExtension } from './pi-config.mjs';
import { piTools } from './opencode-permissions.mjs';

const permissionsExtension = fileURLToPath(new URL('./opencode-permissions.mjs', import.meta.url));

export function buildPiPrompt({ task, role, repairBrief, humanFeedback, baseline, files = [] }) {
  const schema = role.name === 'validator'
    ? '{"verdict":"accept|revise|block","summary":"...","evidence":["check and actual result"],"repairBrief":"required for revise","testing":"concrete local testing steps","files":["every reviewed changed path"]}'
    : `{"outcome":"${role.name === 'planner' ? 'ready' : 'passing'}|block","summary":"...","evidence":["actual result"],"files":["every path changed by you"],"testing":"concrete local testing steps"}`;
  return [
    `Selected feature: ${task.id}: ${task.title}. Objective: ${task.objective}`,
    `Your configured role: ${role.name}. Use $${role.skillName}.`,
    `Spec: docs/specs/${task.id}.md. Read it if present; planner must confirm it is current or update it.`,
    `Verification: ${JSON.stringify(task.criteria)}. Dependencies: ${JSON.stringify(task.dependsOn)}.`,
    `Baseline HEAD: ${baseline?.head ?? 'unknown'}. Existing user changes (do not edit or stage): ${JSON.stringify(Object.keys(baseline?.dirty ?? {}))}.`,
    `Feature changes to inspect: ${JSON.stringify(files)}.`,
    humanFeedback ? `Human review requested changes to the previously accepted commit: ${humanFeedback}` : '',
    repairBrief && repairBrief !== humanFeedback ? `Independent validator repair brief: ${repairBrief}` : '',
    'Read AGENTS.md and PROGRESS.md in the repository root. Resolve repository artifacts from cwd and skill references relative to their SKILL.md.',
    'Work on this feature only. Do not create further subagents. The host orchestrates the three independent roles.',
    'No hagas merge, push, deploy, cambios de credenciales ni operaciones de producción. Do not commit, stage, switch branches, or alter Git configuration/hooks. The host owns acceptance and the scoped commit.',
    role.name === 'planner' ? 'Change only the selected specification. Do not change feature_list.json, PROGRESS.md, or product code.' : '',
    role.name === 'implementer' ? 'Update only the selected feature to passing after actual verification, with evidence; update PROGRESS.md. Never set accepted.' : '',
    role.name === 'validator' ? 'Inspect independently and rerun checks. Do not modify any tracked or untracked file; return validation in the response. A failed or unrun required gate cannot be accept.' : '',
    `End your final response with exactly one <harness-result>${schema}</harness-result> JSON object, replacing placeholders with actual results. Include all changed/reviewed file paths. If unable to proceed, return block and explain why. This structured handoff does not replace the project skill.`
  ].filter(Boolean).join('\n\n');
}

export function resultReminder(role, problem) {
  return `Tu respuesta final no se puede usar: ${problem}. No repitas el trabajo ni cambies archivos. Responde solo con un único bloque <harness-result>{...}</harness-result> con el contrato de tu rol (${role}), con lo que ya has hecho y comprobado.`;
}

export function parseRoleResult(text, role) {
  const matches = [...text.matchAll(/<harness-result>\s*([^]*?)\s*<\/harness-result>/g)];
  if (matches.length !== 1) throw new Error(`${role}: falta un único resultado estructurado; no se avanzará de fase`);
  let result;
  try { result = JSON.parse(matches[0][1]); } catch { throw new Error(`${role}: resultado JSON inválido`); }
  return validateRoleResult(result, role);
}

export function validateRoleResult(result, role) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(`${role}: resultado incompleto`);
  if (result.verdict === 'blocked') result.verdict = 'block';
  if (result.outcome === 'blocked') result.outcome = 'block';
  const outcome = role === 'validator' ? result.verdict : result.outcome;
  const allowed = role === 'validator' ? ['accept', 'revise', 'block'] : [role === 'planner' ? 'ready' : 'passing', 'block'];
  if (!allowed.includes(outcome) || typeof result.summary !== 'string' || !result.summary.trim()) throw new Error(`${role}: resultado incompleto`);
  for (const key of ['evidence', 'files']) {
    if (!Array.isArray(result[key]) || result[key].some((item) => typeof item !== 'string' || !item.trim())) throw new Error(`${role}: ${key} debe ser una lista de textos`);
  }
  if (outcome !== 'block' && !result.evidence.length) throw new Error(`${role}: faltan evidencias`);
  if (outcome === 'revise' && !result.repairBrief?.trim()) throw new Error('Validator: falta el informe de correcciones');
  if (outcome === 'accept' && !result.testing?.trim()) throw new Error('Validator: faltan instrucciones para probar la feature');
  const { outcome: roleOutcome, verdict, summary, evidence, files, repairBrief, testing } = result;
  return { outcome: roleOutcome, verdict, summary, evidence, files, repairBrief, testing };
}

const clip = (value, length = 160) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
};
// Short, human-readable description of what a tool is doing; never the full payload.
export function describeTool(name, args = {}) {
  const target = args.path ?? args.file_path ?? args.filePath ?? args.pattern ?? args.query ?? args.url;
  if (name === 'bash' && args.command) return `bash · ${clip(args.command, 140)}`;
  return target ? `${name} · ${clip(target, 140)}` : name;
}
const resultText = (result) => (result?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');

export function mapPiEvent(event, role) {
  const base = { stage: roleStages[role.name], role: role.name, skill: role.skillName };
  if (event.type === 'agent_start') return { ...base, message: `Sesión ${role.name} iniciada` };
  if (event.type === 'tool_execution_start') return { ...base, kind: 'tool', message: describeTool(event.toolName, event.args) };
  if (event.type === 'tool_execution_end' && event.isError) return { ...base, kind: 'tool', level: 'error', message: `${event.toolName} falló${resultText(event.result) ? `: ${clip(resultText(event.result))}` : ''}` };
  if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_end' && event.assistantMessageEvent.content?.trim()) {
    const text = event.assistantMessageEvent.content.replace(/<harness-result>[^]*$/, '').trim();
    return text ? { ...base, kind: 'note', message: clip(text, 240) } : null;
  }
  if (event.type === 'auto_retry_start') return { ...base, level: 'warn', message: 'Error transitorio del proveedor; Pi reintenta' };
  if (event.type === 'compaction_start') return { ...base, message: 'Pi compacta el contexto de la sesión' };
  return null;
}

export async function runPiRole({ task, role, runtime, cwd, emit = () => {}, signal, repairBrief, humanFeedback, baseline, files, piBin = 'pi', provider = pinnedPi.provider, model = pinnedPi.model, timeoutMs = 1_800_000, env = process.env, spawnImpl = spawn }) {
  if (signal?.aborted) throw new Error('Ejecución cancelada');
  emit({ stage: roleStages[role.name], role: role.name, skill: role.skillName, message: `Pi · ${provider}/${model ?? role.model} · ${role.thinking}` });
  const system = [runtime.instructions.text, runtime.flow.text, role.developerInstructions, `Skill source: ${role.skill.path}\n${role.skill.text}`].join('\n\n');
  const args = ['--mode', 'rpc', '--no-session', '--name', `harness-${task.id}-${role.name}`,
    '--no-approve', '--no-extensions', '--no-skills', '--no-prompt-templates', '--no-themes', '--no-context-files',
    '--skill', role.skill.path, '--append-system-prompt', system, '--model', model ?? role.model, '--thinking', role.thinking];
  if (provider) args.push('--provider', provider);
  if (provider === pinnedPi.provider) args.push('--extension', providerExtension);
  // OpenCode roles carry permissions: drop the tools they deny outright and enforce the rest per call.
  args.push('--tools', piTools(role.permissions).join(','));
  if (role.permissions) {
    args.push('--extension', permissionsExtension);
    env = { ...env, HARNESS_ROLE: role.name };
  }
  return new Promise((resolve, reject) => {
    const child = spawnImpl(process.execPath, [fileURLToPath(new URL('./pi-supervisor.mjs', import.meta.url)), piBin, ...args], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    let finished = false;
    let finalText = '';
    let stderr = '';
    let agentError = null;
    let reminded = false;
    let report = '';
    const decoder = new StringDecoder('utf8');
    let buffer = '';
    const finish = (error, result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      if (child.pid && process.platform !== 'win32') { try { process.kill(-child.pid, 'SIGKILL'); } catch {} }
      else child.kill();
      error ? reject(error) : resolve({ ...result, output: report ? `${report}\n\n${finalText}` : finalText });
    };
    const abort = () => finish(new Error('Ejecución cancelada; la cola está pausada'));
    const timeout = setTimeout(() => finish(new Error(`Pi excedió ${Math.round(timeoutMs / 60_000)} minutos; se ha detenido`)), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (error) => finish(error));
    child.stdin.on('error', (error) => finish(error));
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString()).slice(-8_000); });
    const onRecord = (event) => {
      if (finished) return;
      const mapped = mapPiEvent(event, role);
      if (mapped) emit(mapped);
      if (event.type === 'response' && event.success === false) return finish(new Error(event.error ?? 'Pi rechazó la petición'));
      if (event.type === 'extension_ui_request') return finish(new Error('Pi solicita una interacción no compatible; revisa la configuración del proyecto'));
      if (event.type === 'message_end' && event.message?.role === 'assistant') {
        if (['error', 'aborted'].includes(event.message.stopReason)) agentError = new Error(event.message.errorMessage ?? 'Pi no pudo completar el rol');
        const text = (event.message.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        if (text) finalText = text;
      }
      if (event.type === 'agent_settled') {
        if (agentError) return finish(agentError);
        try { finish(null, parseRoleResult(finalText, role.name)); } catch (error) {
          // A role that did the work but forgot the handoff gets one reminder in the same session.
          if (reminded) return finish(error);
          reminded = true;
          report = finalText;
          emit({ stage: roleStages[role.name], role: role.name, skill: role.skillName, level: 'warn', message: `${role.name} no devolvió <harness-result>; el host se lo pide una vez` });
          // Deferred so the reminder never re-enters the stdout handler that is still parsing this line.
          setImmediate(() => { if (!finished) child.stdin.write(`${JSON.stringify({ id: `${task.id}-${role.name}-result`, type: 'prompt', message: resultReminder(role.name, error.message) })}\n`); });
        }
      }
    };
    child.stdout.on('data', (chunk) => {
      buffer += decoder.write(chunk);
      if (buffer.length > 8_000_000) return finish(new Error('Salida RPC de Pi demasiado grande'));
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let event;
        try { event = JSON.parse(line); } catch { finish(new Error('Pi devolvió salida RPC inválida')); return; }
        try { onRecord(event); } catch (error) { finish(error); }
      }
    });
    child.on('close', (code) => { if (!finished) finish(new Error(stderr.trim() || `Pi terminó sin resultado (código ${code})`)); });
    child.stdin.write(`${JSON.stringify({ id: `${task.id}-${role.name}`, type: 'prompt', message: buildPiPrompt({ task, role, repairBrief, humanFeedback, baseline, files }) })}\n`);
  });
}
