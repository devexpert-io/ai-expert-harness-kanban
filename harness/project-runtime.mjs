import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
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
  // OpenCode is the course project's runtime; Codex stays supported for other repositories.
  const format = existsSync(join(projectPath, '.opencode/agents')) ? 'opencode' : 'codex';
  const agents = format === 'opencode' ? openCodeAgents(projectPath, read) : codexAgents(projectPath, read);
  const roles = {};
  for (const [name, skillName] of Object.entries(roleSkills)) {
    const skill = read(join(projectPath, `.agents/skills/${skillName}/SKILL.md`));
    for (const ref of new Set(skill.text.match(/references\/[\w./-]+\.md/g) ?? [])) read(join(dirname(skill.path), ref));
    roles[name] = { name, skillName, skill, ...agents[name] };
  }
  return { instructions, flow, roles, format, sources, fingerprint: digest(JSON.stringify(sources)) };
}

function codexAgents(projectPath, read) {
  const config = read(join(projectPath, '.codex/config.toml'));
  if (!/^enabled\s*=\s*true\s*$/m.test(config.text)) throw new Error('Los subagentes del proyecto no están habilitados');
  return Object.fromEntries(Object.keys(roleSkills).map((name) => {
    const section = config.text.match(new RegExp(`\\[agents\\.${name}\\]([^]*?)(?=\\n\\[|$)`))?.[1];
    if (!section) throw new Error(`Falta el subagente ${name} en .codex/config.toml`);
    const file = read(resolve(dirname(config.path), scalar(section, 'config_file')));
    const developerInstructions = file.text.match(/^developer_instructions\s*=\s*"""\r?\n?([^]*?)"""\s*$/m)?.[1];
    if (!developerInstructions?.trim()) throw new Error(`Faltan developer_instructions de ${name}`);
    if (scalar(file.text, 'name') !== name) throw new Error(`Nombre incorrecto en el subagente ${name}`);
    const sandbox = scalar(file.text, 'sandbox_mode');
    if (sandbox !== 'workspace-write') throw new Error(`Pi no puede reproducir sandbox_mode=${sandbox} de ${name}`);
    return [name, { model: scalar(file.text, 'model'), thinking: scalar(file.text, 'model_reasoning_effort'), configPath: file.path, developerInstructions }];
  }));
}

/**
 * `.opencode/agents/<role>.md`: YAML frontmatter plus the agent prompt. Only the fields the harness
 * needs are read; permissions stay with OpenCode, and the host checks role boundaries itself.
 */
function openCodeAgents(projectPath, read) {
  return Object.fromEntries(Object.entries(roleSkills).map(([name, skillName]) => {
    const file = read(join(projectPath, `.opencode/agents/${name}.md`));
    const match = file.text.match(/^---\r?\n([^]*?)\r?\n---\r?\n?([^]*)$/);
    if (!match) throw new Error(`.opencode/agents/${name}.md necesita frontmatter YAML`);
    const field = (key) => match[1].match(new RegExp(`^${key}:\\s*['"]?([^'"\\n#]+?)['"]?\\s*(?:#.*)?$`, 'm'))?.[1];
    const developerInstructions = match[2].trim();
    if (!developerInstructions) throw new Error(`Faltan las instrucciones de ${name} en .opencode/agents/${name}.md`);
    if (field('mode') && field('mode') !== 'subagent') throw new Error(`${name} debe ser un subagente (mode: subagent)`);
    if (!developerInstructions.includes(`$${skillName}`) && !new RegExp(`^\\s+${skillName}:\\s*allow`, 'm').test(match[1])) throw new Error(`${name} no usa la skill ${skillName}`);
    return [name, { model: field('model') ?? null, thinking: field('reasoningEffort') ?? 'medium', configPath: file.path, developerInstructions }];
  }));
}

export function runtimeSummary(runtime, error = null) {
  return {
    ready: Boolean(runtime), error, fingerprint: runtime?.fingerprint,
    roles: runtime ? Object.values(runtime.roles).map(({ name, model, thinking, skillName }) => ({ name, model, thinking, skill: skillName })) : [],
    format: runtime?.format ?? null,
    notice: 'Pi ejecuta las instrucciones del proyecto en sesiones separadas. No aplica los permisos de OpenCode ni el sandbox de Codex; solo abre repositorios de confianza.'
  };
}
