import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

const states = new Set(['pending', 'planning', 'implementing', 'validating', 'review', 'done']);
const maxFileBytes = 1_000_000;

function readOptionalJson(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile()) throw new Error(`${path} no es un archivo`);
    if (stat.size > maxFileBytes) throw new Error(`${path} supera ${maxFileBytes} bytes`);
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function validateTask(task, index) {
  if (!task || typeof task !== 'object') throw new Error(`tasks[${index}] debe ser un objeto`);
  if (typeof task.id !== 'string' || !task.id.trim()) throw new Error(`tasks[${index}].id es obligatorio`);
  if (typeof task.title !== 'string' || !task.title.trim()) throw new Error(`tasks[${index}].title es obligatorio`);
  if (!states.has(task.state)) throw new Error(`tasks[${index}].state no es válido`);
  if (task.evidence != null && (!Array.isArray(task.evidence) || task.evidence.some((item) => typeof item !== 'string'))) {
    throw new Error(`tasks[${index}].evidence debe ser una lista de textos`);
  }
  if (task.blocked != null && (typeof task.blocked !== 'object' || typeof task.blocked.reason !== 'string')) {
    throw new Error(`tasks[${index}].blocked debe incluir reason`);
  }
  return {
    id: task.id.trim(),
    title: task.title.trim(),
    state: task.state,
    role: typeof task.role === 'string' ? task.role : null,
    skill: typeof task.skill === 'string' ? task.skill : null,
    gate: typeof task.gate === 'string' ? task.gate : null,
    blocked: task.blocked ? { reason: task.blocked.reason, resolution: task.blocked.resolution ?? null } : null,
    evidence: task.evidence ? [...task.evidence] : []
  };
}

function validateConfig(document) {
  if (!document) return null;
  if (document.version !== 1 || typeof document !== 'object') {
    throw new Error('.harness/config.json debe usar version 1');
  }
  if (document.defaultEngine != null && !['mock', 'pi'].includes(document.defaultEngine)) {
    throw new Error('.harness/config.json contiene un motor no válido');
  }
  if (document.reviewRequired === false || document.autoMerge === true) {
    throw new Error('El contrato exige revisión humana y prohíbe autoMerge');
  }
  return {
    version: 1,
    defaultEngine: document.defaultEngine ?? 'mock',
    reviewRequired: true,
    autoMerge: false
  };
}

export function inspectProject(explicitPath) {
  if (typeof explicitPath !== 'string' || !isAbsolute(explicitPath)) throw new Error('La ruta del proyecto debe ser absoluta');
  const projectPath = realpathSync(explicitPath);
  if (!statSync(projectPath).isDirectory()) throw new Error('La ruta seleccionada no es una carpeta');

  const taskFile = join(projectPath, 'feature_list.json');
  const configFile = join(projectPath, '.harness', 'config.json');
  const taskDocument = readOptionalJson(taskFile);
  const configDocument = readOptionalJson(configFile);

  if (taskDocument && (taskDocument.version !== 1 || !Array.isArray(taskDocument.tasks))) {
    throw new Error('feature_list.json debe usar { "version": 1, "tasks": [...] }');
  }
  const config = validateConfig(configDocument);

  const tasks = taskDocument ? taskDocument.tasks.map(validateTask) : [];
  const duplicate = tasks.find((task, index) => tasks.findIndex((candidate) => candidate.id === task.id) !== index);
  if (duplicate) throw new Error(`ID de tarea duplicado: ${duplicate.id}`);

  return {
    path: projectPath,
    name: basename(projectPath),
    tasks,
    config,
    files: { tasks: Boolean(taskDocument), config: Boolean(configDocument) },
    emptyReason: taskDocument ? (tasks.length ? null : 'feature_list.json no contiene tareas') : 'Falta feature_list.json'
  };
}
