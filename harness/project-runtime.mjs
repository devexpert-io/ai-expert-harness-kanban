import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const roleSkills = { planner: 'feature-spec', implementer: 'feature-implementer', validator: 'feature-validator' };
export const roleStages = { planner: 'planning', implementer: 'implementing', validator: 'validating' };
export const digest = (value) => createHash('sha256').update(value).digest('hex');

// Only the scalar subset used by project agent files; unsupported syntax fails closed.
function scalar(document, key) {
  const match = document.match(new RegExp(`^${key}\\s*=\\s*("[^"\\n]*"|'[^'\\n]*')\\s*(?:#.*)?$`, 'm'));
  if (!match) throw new Error(`La configuración del agente requiere ${key} como texto simple`);
  return match[1][0] === '"' ? JSON.parse(match[1]) : match[1].slice(1, -1);
}

export function loadRuntime(projectPath) {
  projectPath = realpathSync(projectPath);
  const sources = [];
  const read = (path) => {
    let actual;
    try { actual = realpathSync(path); } catch (error) {
      if (error.code === 'ENOENT') throw new Error(`Falta ${relative(projectPath, path)} en el proyecto`);
      throw error;
    }
    if (relative(projectPath, actual).startsWith('..')) throw new Error(`Instrucción fuera del proyecto: ${path}`);
    if (statSync(actual).size > 250_000) throw new Error(`Instrucción demasiado grande: ${path}`);
    const text = readFileSync(actual, 'utf8');
    sources.push({ path: relative(projectPath, actual), hash: digest(text) });
    return { path: actual, text };
  };
  const instructions = read(join(projectPath, 'AGENTS.md'));
  const flow = read(join(projectPath, '.agents/skills/feature-flow/SKILL.md'));
  const config = read(join(projectPath, '.codex/config.toml'));
  if (!/^enabled\s*=\s*true\s*$/m.test(config.text)) throw new Error('Los subagentes del proyecto no están habilitados');
  const roles = {};
  for (const [name, skillName] of Object.entries(roleSkills)) {
    const section = config.text.match(new RegExp(`\\[agents\\.${name}\\]([^]*?)(?=\\n\\[|$)`))?.[1];
    if (!section) throw new Error(`Falta el subagente ${name} en .codex/config.toml`);
    const file = read(resolve(dirname(config.path), scalar(section, 'config_file')));
    const developerInstructions = file.text.match(/^developer_instructions\s*=\s*"""\r?\n?([^]*?)"""\s*$/m)?.[1];
    if (!developerInstructions?.trim()) throw new Error(`Faltan developer_instructions de ${name}`);
    if (scalar(file.text, 'name') !== name) throw new Error(`Nombre incorrecto en el subagente ${name}`);
    const sandbox = scalar(file.text, 'sandbox_mode');
    if (sandbox !== 'workspace-write') throw new Error(`Pi no puede reproducir sandbox_mode=${sandbox} de ${name}`);
    const skill = read(join(projectPath, `.agents/skills/${skillName}/SKILL.md`));
    for (const ref of new Set(skill.text.match(/references\/[\w./-]+\.md/g) ?? [])) read(join(dirname(skill.path), ref));
    roles[name] = { name, model: scalar(file.text, 'model'), thinking: scalar(file.text, 'model_reasoning_effort'), configPath: file.path, developerInstructions, skillName, skill };
  }
  return { instructions, flow, roles, sources, fingerprint: digest(JSON.stringify(sources)) };
}

export function runtimeSummary(runtime, error = null) {
  return {
    ready: Boolean(runtime), error, fingerprint: runtime?.fingerprint,
    roles: runtime ? Object.values(runtime.roles).map(({ name, model, thinking, skillName }) => ({ name, model, thinking, skill: skillName })) : [],
    notice: 'Pi ejecuta las instrucciones del proyecto en sesiones separadas. No aplica el sandbox de Codex; solo abre repositorios de confianza.'
  };
}
