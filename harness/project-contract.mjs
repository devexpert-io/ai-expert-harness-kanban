import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

const states = new Set(['pending', 'planning', 'implementing', 'validating', 'review', 'done']);
const legacyStates = new Map([
  ['not_started', 'pending'],
  ['planned', 'planning'],
  ['planning', 'planning'],
  ['in_progress', 'implementing'],
  ['implementing', 'implementing'],
  ['passing', 'validating'],
  ['validating', 'validating'],
  ['review', 'review'],
  ['accepted', 'done'],
  ['done', 'done'],
  ['blocked', 'pending']
]);
const legacyGates = new Map([
  ['not_started', 'Pendiente'],
  ['planned', 'Planificada'],
  ['planning', 'Planificando'],
  ['in_progress', 'Implementando'],
  ['implementing', 'Implementando'],
  ['passing', 'Autoverificación superada'],
  ['validating', 'Validando'],
  ['review', 'Revisión humana'],
  ['accepted', 'Aceptada'],
  ['done', 'Terminada'],
  ['blocked', 'Bloqueada']
]);
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

function stringList(value, field, index) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`tasks[${index}].${field} debe ser una lista de textos`);
  }
  return [...value];
}

function validateTask(task, index, legacy = false) {
  if (!task || typeof task !== 'object') throw new Error(`tasks[${index}] debe ser un objeto`);
  if (typeof task.id !== 'string' || !task.id.trim()) throw new Error(`tasks[${index}].id es obligatorio`);
  if (typeof task.title !== 'string' || !task.title.trim()) throw new Error(`tasks[${index}].title es obligatorio`);
  const sourceStatus = legacy ? task.status : task.state;
  const state = legacy ? legacyStates.get(sourceStatus) : sourceStatus;
  if (!states.has(state)) throw new Error(`tasks[${index}].${legacy ? 'status' : 'state'} no es válido: ${sourceStatus}`);
  if (task.blocked != null && (typeof task.blocked !== 'object' || typeof task.blocked.reason !== 'string')) {
    throw new Error(`tasks[${index}].blocked debe incluir reason`);
  }
  const blocked = task.blocked
    ? { reason: task.blocked.reason, resolution: task.blocked.resolution ?? null }
    : legacy && sourceStatus === 'blocked'
      ? { reason: task.notes || 'Marcada como bloqueada en feature_list.json', resolution: null }
      : null;
  return {
    id: task.id.trim(),
    title: task.title.trim(),
    state,
    sourceStatus,
    area: typeof task.area === 'string' ? task.area : null,
    objective: typeof task.user_visible_behavior === 'string' ? task.user_visible_behavior : null,
    role: typeof task.role === 'string' ? task.role : null,
    skill: typeof task.skill === 'string' ? task.skill : null,
    gate: typeof task.gate === 'string' ? task.gate : legacyGates.get(sourceStatus) ?? null,
    blocked,
    dependsOn: stringList(task.dependsOn ?? task.depends_on, 'dependsOn', index),
    criteria: stringList(task.criteria ?? task.verification, 'criteria', index),
    evidence: stringList(task.evidence, 'evidence', index),
    notes: typeof task.notes === 'string' ? task.notes : null
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

  const legacy = Array.isArray(taskDocument);
  if (taskDocument && !legacy && (taskDocument.version !== 1 || !Array.isArray(taskDocument.tasks))) {
    throw new Error('feature_list.json debe ser una lista de features o usar { "version": 1, "tasks": [...] }');
  }
  const config = validateConfig(configDocument);

  const sourceTasks = taskDocument ? (legacy ? taskDocument : taskDocument.tasks) : [];
  const tasks = sourceTasks.map((task, index) => validateTask(task, index, legacy));
  const duplicate = tasks.find((task, index) => tasks.findIndex((candidate) => candidate.id === task.id) !== index);
  if (duplicate) throw new Error(`ID de tarea duplicado: ${duplicate.id}`);
  const ids = new Set(tasks.map((task) => task.id));
  const unknownDependency = tasks.flatMap((task) => task.dependsOn.map((id) => ({ task: task.id, id }))).find(({ id }) => !ids.has(id));
  if (unknownDependency) throw new Error(`${unknownDependency.task} depende de un ID desconocido: ${unknownDependency.id}`);

  return {
    path: projectPath,
    name: basename(projectPath),
    tasks,
    format: legacy ? 'feature-list' : 'harness-v1',
    config,
    files: { tasks: Boolean(taskDocument), config: Boolean(configDocument) },
    emptyReason: taskDocument ? (tasks.length ? null : 'feature_list.json no contiene tareas') : 'Falta feature_list.json'
  };
}
