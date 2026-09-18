export function unmetDependencies(task, tasks) {
  const byId = new Map(tasks.map((candidate) => [candidate.id, candidate]));
  return (task.dependsOn ?? []).filter((id) => byId.get(id)?.state !== 'done');
}

export function taskReadiness(task, tasks) {
  if (!task) return { ready: false, reason: 'Tarea no encontrada', unmet: [] };
  if (task.blocked) return { ready: false, reason: `Tarea bloqueada: ${task.blocked.reason}`, unmet: [] };
  if (['review', 'done'].includes(task.state)) {
    return { ready: false, reason: `La tarea ya está ${task.state === 'done' ? 'terminada' : 'en revisión humana'}`, unmet: [] };
  }
  const unmet = unmetDependencies(task, tasks);
  if (unmet.length) return { ready: false, reason: `Dependencias pendientes: ${unmet.join(', ')}`, unmet };
  return { ready: true, reason: null, unmet: [] };
}
