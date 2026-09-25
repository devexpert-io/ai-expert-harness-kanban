// Pure view model: derives everything the UI shows from a server snapshot.
export const stages = [
  ['pending', 'Pendientes'], ['planning', 'Planificación'], ['implementing', 'Implementación'],
  ['validating', 'Validación'], ['review', 'Revisión humana'], ['done', 'Aceptadas']
];
export const activeStatuses = ['queued', 'running', 'blocked', 'interrupted'];
export const attentionStatuses = ['blocked', 'interrupted'];
const inactive = ['discarded', 'closed'];

/**
 * Tasks joined with their latest meaningful run. A merged run makes the feature accepted even when
 * the local checkout has not pulled the base yet (GitHub reviews).
 */
export function tasks(state) {
  const runs = state?.runs ?? [];
  return (state?.project?.tasks ?? []).map((task) => {
    const history = runs.filter((run) => run.taskId === task.id);
    const run = [...history].reverse().find((item) => !inactive.includes(item.status));
    const live = Boolean(run) && !['done', 'changes-requested'].includes(run.status);
    const merged = run?.status === 'done';
    const settled = run ? merged : task.sourceStatus === 'accepted';
    return { ...task, run, history, live, settled, sourceStatus: merged ? 'accepted' : task.sourceStatus, gate: merged ? 'Integrada' : task.gate, state: live ? run.stage : merged ? 'done' : task.state };
  });
}
export const byId = (all) => new Map(all.map((task) => [task.id, task]));

export function selectable(task) {
  return !task.settled && task.sourceStatus !== 'accepted' && !task.blocked && !task.live;
}

/** Dependencies not yet usable, split by whether the human review is the only thing missing. */
export function waiting(task, index) {
  const blockers = task.dependsOn.map((id) => index.get(id)).filter(Boolean).filter((dependency) => !dependency.settled);
  return {
    review: blockers.filter((dependency) => dependency.run?.status === 'review').map((dependency) => dependency.id),
    other: blockers.filter((dependency) => dependency.run?.status !== 'review').map((dependency) => dependency.id)
  };
}

const dependencyClosure = (id, index, next) => {
  const seen = new Set();
  const visit = (current) => {
    for (const other of next(current)) if (!seen.has(other)) { seen.add(other); visit(other); }
  };
  visit(id);
  return seen;
};

/** Checking a feature adds its pending dependencies; unchecking removes whatever depended on it. */
export function toggleSelection(selection, id, checked, all) {
  const index = byId(all);
  const next = new Set(selection);
  const added = [];
  if (checked) {
    next.add(id);
    for (const dependency of dependencyClosure(id, index, (current) => index.get(current)?.dependsOn ?? [])) {
      const task = index.get(dependency);
      if (task && selectable(task) && !next.has(dependency)) { next.add(dependency); added.push(dependency); }
    }
  } else {
    next.delete(id);
    const dependents = dependencyClosure(id, index, (current) => all.filter((task) => task.dependsOn.includes(current)).map((task) => task.id));
    for (const dependent of dependents) if (next.delete(dependent)) added.push(dependent);
  }
  return { selection: next, changed: added };
}

/** Selected features in the order the queue will run them (dependencies first, then file order). */
export function executionOrder(selection, all) {
  const index = byId(all);
  const ordered = [];
  const visit = (id) => {
    if (ordered.includes(id) || !selection.has(id)) return;
    for (const dependency of index.get(id)?.dependsOn ?? []) visit(dependency);
    ordered.push(id);
  };
  for (const task of all) visit(task.id);
  return ordered.map((id) => index.get(id));
}

/** State-derived problems. Recomputed on every render, so they disappear once fixed. */
export function notices(state, { online }) {
  const items = [];
  if (!online) items.push({ level: 'error', text: 'No se puede conectar con el servidor. El estado mostrado puede estar desactualizado; la ejecución no depende de esta pestaña.' });
  if (!state) return items;
  if (state.error) items.push({ level: 'error', text: `No se pudo cargar el proyecto: ${state.error}` });
  if (!state.project) return items;
  if (!state.runtime.ready) items.push({ level: 'error', text: `El backlog está cargado, pero no se puede ejecutar: ${state.runtime.error}` });
  if (!state.pi.installed) items.push({ level: 'error', text: 'El backlog está cargado. Instala Pi para poder ejecutar las features.' });
  if (state.pi.credentials && !state.pi.credentials.configured) items.push({ level: 'warn', text: 'Falta la API key de DevExpert Inference. Configúrala para que Pi pueda ejecutar los roles.', action: 'credentials', actionLabel: 'Configurar API key' });
  if (state.review?.error) items.push({ level: 'error', text: state.review.error });
  return items;
}

export function queueSummary(state, all) {
  const running = all.filter((task) => task.run?.status === 'running');
  const queued = state.runs.filter((run) => run.status === 'queued');
  const blocked = state.runs.filter((run) => attentionStatuses.includes(run.status));
  const reviews = all.filter((task) => task.run?.status === 'review');
  const index = byId(all);
  const waitingReview = queued.filter((run) => index.get(run.taskId) && waiting(index.get(run.taskId), index).review.length);
  const extra = [queued.length && `${queued.length} en cola`, reviews.length && `${reviews.length} en revisión`, blocked.length && `${blocked.length} necesita(n) atención`].filter(Boolean).join(' · ');
  if (running.length === 1) return { tone: 'live', label: `${running[0].title} · ${running[0].run.role ?? 'preparando'}`, help: `${running[0].run.events.at(-1)?.message ?? 'Preparando ejecución…'}${extra ? ` · ${extra}` : ''}` };
  if (running.length) return { tone: 'live', label: `${running.length} features en paralelo`, help: `${running.map((task) => `${task.id} · ${task.run.role ?? 'preparando'}`).join(' · ')}${extra ? ` · ${extra}` : ''}` };
  if (blocked.length && !queued.length) return { tone: 'error', label: 'Una ejecución necesita atención', help: blocked[0].error ?? '' };
  if (queued.length && waitingReview.length === queued.length) return { tone: 'review', label: 'La cola espera tu revisión', help: `Integra ${reviews.map((task) => task.id).join(', ')} para continuar con ${queued.length} feature(s) dependiente(s).` };
  if (queued.length) return { tone: state.paused ? 'idle' : 'live', label: state.paused ? `Cola pausada · ${queued.length} en espera` : `${queued.length} en cola`, help: state.paused ? 'Lo que estaba en marcha ha terminado. Reanuda para continuar.' : 'Preparando las siguientes features…' };
  if (reviews.length) return { tone: 'review', label: `${reviews.length} pendiente(s) de tu revisión`, help: state.review?.mode === 'github' ? 'Revisa cada PR en GitHub; al mergearla, el tablero lo detecta y desbloquea sus dependientes.' : 'Abre la tarjeta para ver la rama, cómo probarla e integrarla o pedir cambios.' };
  const pending = all.filter((task) => !task.settled).length;
  return { tone: 'idle', label: pending ? `${pending} features pendientes` : 'Todo integrado', help: pending ? `Marca las features que quieres implementar. Las independientes avanzan a la vez (hasta ${state.maxParallel ?? 1}); sus dependencias se añaden solas.` : 'No quedan features por implementar en feature_list.json.' };
}

export const repairs = (run) => (run?.steps ?? []).filter((step) => step.verdict === 'revise').length;
