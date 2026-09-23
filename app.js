const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const stages = [['pending', 'Pendientes'], ['planning', 'Planificación'], ['implementing', 'Implementación'], ['validating', 'Validación'], ['review', 'Revisión humana'], ['done', 'Aceptadas']];
let state = null;
let selection = new Set();
let focused = null;
let busy = false;
let lastVersion = '';
let online = false;
let connectionError = false;

async function api(path, body) {
  const response = await fetch(path, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Error ${response.status}`);
  return result;
}
function announce(text, error = false) {
  $(error ? 'error' : 'message').textContent = text;
  $(error ? 'error' : 'message').hidden = !text;
}
function tasks() {
  return (state?.project?.tasks ?? []).map((task) => {
    const run = [...state.runs].reverse().find((item) => item.taskId === task.id && item.status !== 'discarded');
    const current = run && run.status !== 'done';
    return { ...task, run, state: current ? run.stage : task.state };
  });
}
function selectable(task) { return task.sourceStatus !== 'accepted' && !task.blocked && !task.run; }
function waiting(task) {
  return task.dependsOn.filter((id) => state.project.tasks.find((item) => item.id === id)?.sourceStatus !== 'accepted');
}
function render() {
  if (!state) return;
  const project = state.project;
  $('project-name').textContent = project?.name ?? (state.projectPath ? 'No se pudo cargar el proyecto' : 'Tus features, de principio a fin.');
  $('project-path').textContent = project?.path ?? state.projectPath ?? 'Abre un repositorio para ver su backlog y ejecutar el harness de AI Expert.';
  $('workspace').hidden = !project;
  $('empty').hidden = Boolean(project) || Boolean(state.projectPath);
  $('refresh').hidden = !state.projectPath;
  $('open').disabled = busy || state.runs.some((run) => ['queued', 'running', 'blocked', 'interrupted'].includes(run.status));
  if (state.error) announce(state.error, true);
  if (!project) return;
  if (!state.runtime.ready) announce(`El backlog está cargado, pero no se puede ejecutar: ${state.runtime.error}`, true);
  else if (!state.pi.installed) announce('El backlog está cargado. Instala Pi para poder ejecutar las features.', true);
  const all = tasks();
  for (const id of selection) if (!all.some((task) => task.id === id && selectable(task))) selection.delete(id);
  const active = all.find((task) => task.run?.status === 'running');
  const queued = state.runs.filter((run) => run.status === 'queued');
  const blocked = state.runs.find((run) => ['blocked', 'interrupted'].includes(run.status));
  $('queue-label').textContent = active ? `${active.title} · ${active.run.role ?? 'Preparando'}` : blocked ? 'La ejecución necesita atención' : state.paused && queued.length ? 'Cola pausada' : queued.length ? `${queued.length} en cola` : `${all.filter((task) => task.sourceStatus !== 'accepted').length} features pendientes`;
  $('queue-help').textContent = active ? `${active.run.events.at(-1)?.message ?? 'Preparando ejecución…'} · ${queued.length} en espera` : blocked ? blocked.error : 'Selecciona las features que quieres implementar. Se respetará el orden de dependencias.';
  $('pause').hidden = !active && !queued.length;
  $('pause').textContent = state.paused ? 'Reanudar cola' : 'Pausar cola';
  $('pause').disabled = busy || Boolean(blocked);
  $('execute').textContent = selection.size ? `Ejecutar selección (${selection.size})` : 'Selecciona features';
  $('execute').disabled = busy || !online || !selection.size || !state.pi.installed || !state.runtime.ready || Boolean(blocked);
  const boardFocus = document.activeElement?.dataset.focusKey;
  $('board').innerHTML = stages.map(([stage, title]) => {
    const items = all.filter((task) => task.state === stage);
    return `<section class="column" data-stage="${stage}"><h2>${title} <span>${items.length}</span></h2><div class="cards">${items.length ? items.map(card).join('') : '<p class="column-empty">—</p>'}</div></section>`;
  }).join('');
  if (boardFocus) [...$('board').querySelectorAll('[data-focus-key]')].find((element) => element.dataset.focusKey === boardFocus)?.focus({ preventScroll: true });
  renderDetail(all.find((task) => task.id === focused));
  $('runtime-status').textContent = state.runtime.ready ? '· conectado' : '· incompleto';
  $('runtime').innerHTML = `<p>${escapeHtml(state.runtime.error ?? state.runtime.notice)}</p><p>Motor: Pi ${escapeHtml(state.pi.version ?? 'no instalado')}${state.pi.modelOverride ? ` · Modelo fijado: ${escapeHtml(state.pi.provider)}/${escapeHtml(state.pi.modelOverride)}` : ''}</p>${state.runtime.roles.map((role) => `<p><code>${escapeHtml(role.name)}</code> → <code>${escapeHtml(role.skill)}</code> · ${escapeHtml(state.pi.modelOverride ?? role.model)} · ${escapeHtml(role.thinking)}</p>`).join('')}<p class="muted">Las ejecuciones modifican el repositorio seleccionado y crean un commit local después de la aceptación independiente. Nunca hacen push, deploy ni merge. Pausar deja terminar la feature actual; detener interrumpe el rol.</p>`;
}
function card(task) {
  const run = task.run;
  const problem = ['blocked', 'interrupted'].includes(run?.status) || task.blocked;
  const dependencies = waiting(task);
  const label = problem ? 'Necesita atención' : run?.status === 'queued' ? 'En cola' : run?.status === 'running' ? `${run.role ?? 'Preparando'} · ${run.skill ?? 'feature-flow'}` : task.state === 'review' ? 'Commit listo para revisar' : dependencies.length ? `Espera: ${dependencies.join(', ')}` : task.state === 'pending' ? 'Lista para iniciar' : task.gate;
  return `<article class="card ${focused === task.id ? 'selected' : ''} ${problem ? 'problem' : ''}"><div class="card-heading"><code>${escapeHtml(task.id)}</code>${selectable(task) ? `<input type="checkbox" data-select="${escapeHtml(task.id)}" data-focus-key="select-${escapeHtml(task.id)}" aria-label="Seleccionar ${escapeHtml(task.title)}" ${selection.has(task.id) ? 'checked' : ''}>` : ''}</div><button class="card-title" data-detail="${escapeHtml(task.id)}" data-focus-key="detail-${escapeHtml(task.id)}">${escapeHtml(task.title)}</button><p class="card-status ${problem ? 'danger-text' : ''}">${escapeHtml(label)}</p></article>`;
}
function renderDetail(task) {
  $('detail').hidden = !task;
  if (!task) return;
  const expanded = new Set([...$('detail').querySelectorAll('details[open]')].map((node) => node.dataset.key));
  const run = task.run;
  const action = (name, label, style = '') => `<button class="${style}" data-action="${name}" data-run="${escapeHtml(run.id)}" ${busy ? 'disabled' : ''}>${label}</button>`;
  const list = (items) => `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
  $('detail').innerHTML = `<div class="detail-heading"><div><p class="eyebrow">${escapeHtml(task.id)}</p><h2>${escapeHtml(task.title)}</h2></div><button class="quiet" data-close aria-label="Cerrar detalle">Cerrar</button></div><p>${escapeHtml(task.objective)}</p>${task.blocked ? `<p class="notice error">${escapeHtml(task.blocked.reason)}</p>` : ''}${run?.error ? `<p class="notice error">${escapeHtml(run.error)}</p>` : ''}<div class="toolbar">${run?.status === 'running' ? action('stop', 'Detener ejecución') : ''}${['blocked', 'interrupted'].includes(run?.status) ? action('retry', 'Continuar desde este paso', 'primary') : ''}${['queued', 'blocked', 'interrupted'].includes(run?.status) ? action('discard', 'Quitar de la cola') : ''}${run?.status === 'review' ? action('reviewed', 'Marcar revisión humana hecha', 'primary') : ''}</div><div class="detail-grid"><div><h3>Verificación esperada</h3>${list(task.criteria)}${task.dependsOn.length ? `<h3>Dependencias</h3>${list(task.dependsOn)}` : ''}</div><div><h3>Evidencia del proyecto</h3>${task.evidence.length ? list(task.evidence) : '<p class="muted">Todavía no hay evidencia.</p>'}${run?.commit ? `<h3>Commit local</h3><code class="wrap">${escapeHtml(run.commit)}</code>` : ''}${run?.testing ? `<h3>Cómo probarlo</h3><p class="pre-wrap">${escapeHtml(run.testing)}</p>` : ''}</div></div>${(run?.steps ?? []).map((step, index) => `<details class="step" data-key="step-${index}" ${expanded.has(`step-${index}`) ? 'open' : ''}><summary>${escapeHtml(step.role)} · ${escapeHtml(step.verdict ?? step.outcome)} <span class="muted">${escapeHtml(step.skill)}</span></summary><p>${escapeHtml(step.summary)}</p>${list(step.evidence)}${step.repairBrief ? `<h3>Correcciones pedidas</h3><p class="pre-wrap">${escapeHtml(step.repairBrief)}</p>` : ''}${step.files.length ? `<h3>Archivos</h3>${list(step.files)}` : ''}${step.output ? `<pre>${escapeHtml(step.output)}</pre>` : ''}</details>`).join('')}${run?.events?.length ? `<details data-key="activity" ${expanded.has('activity') ? 'open' : ''}><summary>Actividad · ${run.events.length} eventos recientes</summary><ol class="activity">${run.events.map((event) => `<li class="${event.level === 'error' ? 'danger-text' : ''}"><time>${escapeHtml(new Date(event.at).toLocaleTimeString('es'))}</time> ${escapeHtml(event.message)}</li>`).join('')}</ol></details>` : ''}`;
}
async function mutate(path, body = {}) {
  busy = true;
  announce('');
  announce('', true);
  render();
  try { state = await api(path, body); online = true; lastVersion = ''; render(); return true; }
  catch (error) { announce(error.message, true); return false; }
  finally { busy = false; render(); }
}
$('open').addEventListener('click', async () => {
  announce('Elige la raíz del proyecto en el selector de carpetas…');
  $('open').textContent = 'Abriendo…';
  const previous = state?.projectPath;
  await mutate('/api/projects/select');
  $('open').textContent = 'Abrir proyecto…';
  if (state?.projectPath !== previous) { selection.clear(); focused = null; }
  if (state?.project) announce(`${state.project.tasks.length} features cargadas desde feature_list.json.`);
  render();
});
$('refresh').addEventListener('click', () => mutate('/api/project/reload'));
$('pause').addEventListener('click', () => mutate(`/api/queue/${state.paused ? 'resume' : 'pause'}`));
$('execute').addEventListener('click', async () => {
  if (!confirm(`Ejecutar ${selection.size} feature(s) con Pi en ${state.project.name}. Se modificarán archivos y se creará un commit local por feature aceptada. No se hará push ni merge. ¿Continuar?`)) return;
  if (await mutate('/api/queue', { taskIds: [...selection] })) selection.clear();
  render();
});
$('board').addEventListener('change', (event) => {
  const id = event.target.dataset.select;
  if (!id) return;
  event.target.checked ? selection.add(id) : selection.delete(id);
  render();
});
$('board').addEventListener('click', (event) => {
  const id = event.target.closest('[data-detail]')?.dataset.detail;
  if (!id) return;
  focused = id;
  render();
  $('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('detail').addEventListener('click', (event) => {
  if (event.target.closest('[data-close]')) { focused = null; render(); return; }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'discard' && !confirm('Quitar esta ejecución de la cola no borra ni revierte sus archivos. ¿Continuar?')) return;
  void mutate(`/api/runs/${button.dataset.run}/${button.dataset.action}`);
});
async function poll() {
  try {
    if (!busy) {
      const next = await api('/api/state');
      const wasOffline = !online;
      online = true;
      if (connectionError) { announce('', true); connectionError = false; }
      $('connection').textContent = next.pi.installed ? `Pi · ${next.pi.provider ?? ''}${next.pi.modelOverride ? `/${next.pi.modelOverride}` : ' instalado'}` : 'Pi no instalado';
      const version = JSON.stringify(next);
      if (lastVersion !== version || wasOffline) { state = next; lastVersion = version; render(); }
    }
  } catch {
    online = false;
    connectionError = true;
    $('connection').textContent = 'Servidor desconectado';
    $('execute').disabled = true;
    announce('No se puede conectar con el servidor. El último estado no está actualizado; la ejecución no depende de esta pestaña.', true);
  } finally { setTimeout(poll, 1_200); }
}
void poll();
