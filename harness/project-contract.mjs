import { readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, join } from 'node:path';

const sourceStates = new Map([
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
const sourceGates = new Map([
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
const featureFields = new Set([
  'id',
  'area',
  'title',
  'user_visible_behavior',
  'depends_on',
  'status',
  'verification',
  'evidence',
  'notes'
]);

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
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`feature_list[${index}].${field} debe ser una lista de textos`);
  }
  return [...value];
}

function requiredText(task, field, index) {
  if (typeof task[field] !== 'string' || !task[field].trim()) {
    throw new Error(`feature_list[${index}].${field} debe ser un texto no vacío`);
  }
  return task[field].trim();
}

function validateTask(task, index) {
  if (!task || typeof task !== 'object' || Array.isArray(task)) throw new Error(`feature_list[${index}] debe ser un objeto`);
  const unknownField = Object.keys(task).find((field) => !featureFields.has(field));
  if (unknownField) throw new Error(`feature_list[${index}] contiene un campo no admitido: ${unknownField}`);
  const missingField = [...featureFields].find((field) => !Object.hasOwn(task, field));
  if (missingField) throw new Error(`feature_list[${index}] no incluye el campo obligatorio: ${missingField}`);
  const sourceStatus = requiredText(task, 'status', index);
  const state = sourceStates.get(sourceStatus);
  if (!state) throw new Error(`feature_list[${index}].status no es válido: ${sourceStatus}`);
  return {
    id: requiredText(task, 'id', index),
    title: requiredText(task, 'title', index),
    state,
    sourceStatus,
    area: requiredText(task, 'area', index),
    objective: requiredText(task, 'user_visible_behavior', index),
    role: null,
    skill: null,
    gate: sourceGates.get(sourceStatus),
    blocked: sourceStatus === 'blocked' ? { reason: task.notes, resolution: null } : null,
    dependsOn: stringList(task.depends_on, 'depends_on', index),
    criteria: stringList(task.verification, 'verification', index),
    evidence: stringList(task.evidence, 'evidence', index),
    notes: requiredText(task, 'notes', index)
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

  if (taskDocument && !Array.isArray(taskDocument)) throw new Error('feature_list.json debe ser una lista JSON de features');
  const config = validateConfig(configDocument);

  const tasks = (taskDocument ?? []).map(validateTask);
  const duplicate = tasks.find((task, index) => tasks.findIndex((candidate) => candidate.id === task.id) !== index);
  if (duplicate) throw new Error(`ID de tarea duplicado: ${duplicate.id}`);
  const ids = new Set(tasks.map((task) => task.id));
  const unknownDependency = tasks.flatMap((task) => task.dependsOn.map((id) => ({ task: task.id, id }))).find(({ id }) => !ids.has(id));
  if (unknownDependency) throw new Error(`${unknownDependency.task} depende de un ID desconocido: ${unknownDependency.id}`);

  return {
    path: projectPath,
    name: basename(projectPath),
    tasks,
    format: 'feature-list',
    config,
    files: { tasks: Boolean(taskDocument), config: Boolean(configDocument) },
    emptyReason: taskDocument ? (tasks.length ? null : 'feature_list.json no contiene tareas') : 'Falta feature_list.json'
  };
}
