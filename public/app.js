import { html } from './ui/html.js';
import { attentionStatuses, executionOrder, notices, queueSummary, selectable, tasks, toggleSelection } from './ui/model.js';
import { renderBoard } from './ui/board.js';
import { renderDetail } from './ui/detail.js';
import { patch } from './ui/dom.js';
import { ask } from './ui/dialog.js';

const $ = (id) => document.getElementById(id);
let state = null;
let selection = new Set();
let focused = decodeURIComponent(location.hash.slice(1)) || null;
let busy = false;
let online = true;
let etag = null;
let flashTimer = null;

async function api(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `Error ${response.status}`);
  return result;
}
function flash(text, level = 'info') {
  clearTimeout(flashTimer);
  $('flash').textContent = text;
  $('flash').className = `notice ${level}`;
  $('flash').hidden = !text;
  // Errors stay until the next action; confirmations fade on their own.
  if (text && level !== 'error') flashTimer = setTimeout(() => { $('flash').hidden = true; }, 6_000);
}
function setFocused(id) {
  focused = id;
  history.replaceState(null, '', id ? `#${encodeURIComponent(id)}` : location.pathname);
  render();
}

function renderRuntime() {
  const { runtime, pi } = state;
  const model = pi.modelOverride ? `${pi.provider}/${pi.modelOverride}` : 'modelo del rol';
  const review = state.review;
  const reviewLabel = review?.mode === 'github' ? `PR en GitHub → ${review.base}` : review?.mode === 'local' ? `Ramas locales → ${review.base}` : 'Revisión sin configurar';
  patch($('runtime-strip'), html`
    <span class="${runtime.ready ? 'ok' : 'bad'}">${runtime.ready ? '✓ Configuración válida' : '✕ Configuración incompleta'}</span>
    ${runtime.roles.length ? html`<span>${runtime.roles.map((role) => role.name).join(' → ')}</span>` : ''}
    <span>${model}</span>
    <span>${reviewLabel}</span>
    <span>Hasta ${state.maxParallel} en paralelo</span>
    <span>Pi ${pi.version ?? 'no instalado'}</span>
    <span class="warn" title="${runtime.notice}">⚠ Sin sandbox de Codex</span>
    <button class="link" id="runtime-details">Detalles</button>`);
}
async function showRuntime() {
  const { runtime, pi } = state;
  await ask($('dialog'), { title: 'Harness del proyecto', confirm: 'Entendido', body: html`
    <p>${runtime.error ?? runtime.notice}</p>
    <p>Motor: Pi ${pi.version ?? 'no instalado'}${pi.modelOverride ? ` · modelo fijado ${pi.provider}/${pi.modelOverride}` : ''}${pi.credentials && !pi.credentials.configured ? ' · falta la API key' : ''}</p>
    ${runtime.roles.length ? html`<table class="roles"><thead><tr><th>Rol</th><th>Skill</th><th>Modelo</th><th>Esfuerzo</th></tr></thead><tbody>${runtime.roles.map((role) => html`<tr><td><code>${role.name}</code></td><td><code>${role.skill}</code></td><td>${pi.modelOverride ?? role.model}</td><td>${role.thinking}</td></tr>`)}</tbody></table>` : ''}
    <p class="muted">Cada feature trabaja en su propio worktree y rama <code>feat/&lt;id&gt;</code>. Tras la aceptación independiente se publica para revisión humana (PR en GitHub o rama local). El harness solo integra cuando tú lo pides. Pausar deja terminar lo que está en marcha; detener interrumpe ese rol.</p>` });
}

function render() {
  patch($('notices'), html`${notices(state, { online }).map((item) => html`<p class="notice ${item.level}" role="alert">${item.text}${item.action ? html` <button class="link" data-notice-action="${item.action}">${item.actionLabel}</button>` : ''}</p>`)}`);
  if (!state) return;
  const project = state.project;
  $('project-name').textContent = project?.name ?? (state.projectPath ? 'No se pudo cargar el proyecto' : 'Abre un proyecto');
  $('project-path').textContent = project?.path ?? state.projectPath ?? 'Elige la raíz de un repositorio con feature_list.json para ver su backlog.';
  $('workspace').hidden = !project;
  $('empty').hidden = Boolean(project) || Boolean(state.projectPath);
  $('runtime-strip').hidden = !project;
  $('open').disabled = busy || state.runs.some((run) => ['queued', 'running', ...attentionStatuses].includes(run.status));
  const all = tasks(state);
  for (const id of selection) if (!all.some((task) => task.id === id && selectable(task))) selection.delete(id);
  if (project) {
    renderRuntime();
    const summary = queueSummary(state, all);
    const blocked = state.runs.some((run) => attentionStatuses.includes(run.status));
    const pending = state.runs.some((run) => ['queued', 'running'].includes(run.status));
    $('queue-dot').className = `dot tone-${summary.tone}`;
    $('queue-label').textContent = summary.label;
    $('queue-help').textContent = summary.help;
    $('pause').hidden = !pending;
    $('pause').textContent = state.paused ? 'Reanudar cola' : 'Pausar cola';
    $('pause').disabled = busy || blocked;
    $('execute').textContent = selection.size ? `Ejecutar selección (${selection.size})` : 'Selecciona features';
    $('execute').disabled = busy || !online || !selection.size || !state.pi.installed || !state.runtime.ready || blocked;
    patch($('board'), renderBoard(all, { selection, focused, emptyReason: project.emptyReason }));
  }
  const task = all.find((item) => item.id === focused);
  $('detail').hidden = !task;
  $('scrim').hidden = !task;
  document.body.classList.toggle('with-detail', Boolean(task));
  if (task) patch($('detail'), renderDetail(task, { all, busy, review: state.review }));
  const key = state.pi.credentials;
  $('credentials').hidden = !key;
  $('credentials').textContent = key?.configured ? { env: 'API key · entorno', ui: 'API key · esta sesión', saved: 'API key · guardada' }[key.source] : 'Configurar API key';
  $('credentials').classList.toggle('attention', Boolean(key && !key.configured));
  $('check-reviews').hidden = state.review?.mode !== 'github' || !state.runs.some((run) => run.status === 'review');
}

async function mutate(path, body) {
  busy = true;
  if ($('flash').classList.contains('error')) flash('');
  render();
  try { state = await api(path, body); online = true; etag = null; return true; }
  catch (error) { flash(error.message, 'error'); return false; }
  finally { busy = false; render(); }
}

$('open').addEventListener('click', async () => {
  flash('Elige la raíz del proyecto en el selector de carpetas…');
  $('open').textContent = 'Abriendo…';
  const previous = state?.projectPath;
  const ok = await mutate('/api/projects/select');
  $('open').textContent = 'Abrir proyecto…';
  if (state?.projectPath !== previous) { selection.clear(); setFocused(null); }
  if (ok && state?.project) flash(`${state.project.tasks.length} features cargadas desde feature_list.json.`);
  else if (ok) flash('');
});
async function configureCredentials() {
  const current = state?.pi.credentials;
  const answer = await ask($('dialog'), { title: 'API key de DevExpert Inference', confirm: 'Comprobar y guardar', body: html`
    <p>Pi la usa para llamar al modelo <code>chat</code>. Se comprueba contra DevExpert Inference y nunca se vuelve a mostrar en el navegador.</p>
    ${current?.source === 'env' ? html`<p class="muted">Ahora mismo se usa la del entorno del servidor. La que escribas aquí tiene prioridad.</p>` : ''}`,
  input: { type: 'password', label: 'API key', placeholder: 'sk-…' }, checkbox: { label: 'Recordarla en este equipo (archivo local con permisos 600)' } });
  if (answer?.value && await mutate('/api/credentials', { apiKey: answer.value, remember: answer.checked })) flash('API key comprobada. Pi ya puede ejecutar los roles.');
}
$('credentials').addEventListener('click', async () => {
  if (!state?.pi.credentials?.configured || state.pi.credentials.source === 'env') return configureCredentials();
  const choice = await ask($('dialog'), { title: 'API key configurada', confirm: 'Cambiar clave', body: html`<p>${state.pi.credentials.source === 'saved' ? 'Está guardada en este equipo.' : 'Solo está en memoria: se olvida al reiniciar el servidor.'}</p><p><button class="link" data-forget>Olvidar la clave</button></p>` });
  if (choice) await configureCredentials();
});
$('dialog').addEventListener('click', async (event) => {
  if (!event.target.closest('[data-forget]')) return;
  $('dialog').close('cancel');
  if (await mutate('/api/credentials/clear')) flash('Clave olvidada.');
});
$('notices').addEventListener('click', (event) => { if (event.target.closest('[data-notice-action=credentials]')) void configureCredentials(); });
$('check-reviews').addEventListener('click', () => mutate('/api/reviews/refresh'));
$('pause').addEventListener('click', () => mutate(`/api/queue/${state.paused ? 'resume' : 'pause'}`));
$('execute').addEventListener('click', async () => {
  const ordered = executionOrder(selection, tasks(state));
  const confirmed = await ask($('dialog'), { title: `Ejecutar ${ordered.length} feature(s)`, confirm: 'Ejecutar', body: html`
    <p>Se ejecutarán en este orden en <strong>${state.project.name}</strong>, una cada vez:</p>
    <ol class="order">${ordered.map((task) => html`<li><code>${task.id}</code> ${task.title}</li>`)}</ol>
    <p class="muted">Las independientes avanzan a la vez, cada una en su worktree. Al aceptarse, cada una queda en revisión humana (${state.review?.mode === 'github' ? 'una PR' : 'una rama local'}). Las dependientes esperan a que la integres.</p>` });
  if (confirmed && await mutate('/api/queue', { taskIds: ordered.map((task) => task.id) })) { selection.clear(); render(); }
});
$('runtime-strip').addEventListener('click', (event) => { if (event.target.closest('#runtime-details')) void showRuntime(); });
$('board').addEventListener('change', (event) => {
  const id = event.target.dataset.select;
  if (!id) return;
  const all = tasks(state);
  const result = toggleSelection(selection, id, event.target.checked, all);
  selection = result.selection;
  if (result.changed.length) flash(event.target.checked ? `También se ha seleccionado lo que necesita: ${result.changed.join(', ')}` : `También se ha quitado lo que dependía de ella: ${result.changed.join(', ')}`);
  render();
});
document.addEventListener('click', (event) => {
  const detail = event.target.closest('[data-detail]');
  if (detail) setFocused(detail.dataset.detail);
});
$('scrim').addEventListener('click', () => setFocused(null));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && focused && !$('dialog').open) setFocused(null);
});
window.addEventListener('hashchange', () => { focused = decodeURIComponent(location.hash.slice(1)) || null; render(); });
$('detail').addEventListener('click', async (event) => {
  if (event.target.closest('[data-close]')) return setFocused(null);
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const { action, run } = button.dataset;
  const path = `/api/runs/${run}/${action}`;
  if (action === 'discard') {
    const ok = await ask($('dialog'), { title: 'Quitar de la cola', confirm: 'Quitar', tone: 'danger', body: html`<p>Quitar esta ejecución no borra ni revierte sus archivos. Revísalos antes de lanzar otra.</p>` });
    if (ok) await mutate(path);
  } else if (action === 'reject') {
    const feedback = await ask($('dialog'), { title: 'Pedir cambios', confirm: 'Enviar al implementer', body: html`
      <p>Se conserva el commit actual. El implementer recibirá tu feedback, el validator volverá a revisar y se hará un commit de corrección.</p>`,
    input: { label: '¿Qué hay que cambiar?', placeholder: 'Describe qué falla o qué esperabas ver…', maxLength: 4000 } });
    if (feedback && await mutate(path, { feedback })) flash('Cambios enviados. La feature vuelve a la cola.');
  } else if (action === 'merge') {
    const run = state.runs.find((item) => item.id === button.dataset.run);
    const github = state.review?.mode === 'github';
    const ok = await ask($('dialog'), { title: github ? `Mergear PR #${run.pr?.number}` : `Integrar ${run.branch}`, confirm: github ? 'Mergear (squash)' : 'Integrar', body: html`
      <p>${github ? html`Se hará squash merge de la PR contra <code>${state.review.base}</code> con tu cuenta de <code>gh</code>. También puedes mergearla desde GitHub: el tablero lo detecta.` : html`Se hará un merge <code>--no-ff</code> de <code>${run.branch}</code> en <code>${state.review?.base}</code> en tu repositorio.`}</p>
      <p class="muted">Antes se actualiza la rama con la base. Después, las features que dependen de esta pueden empezar.</p>` });
    if (ok && await mutate(path)) flash('Integrada. Las features que dependían de esta ya pueden continuar.');
  } else await mutate(path);
});

async function poll() {
  try {
    if (!busy) {
      const response = await fetch('/api/state', { cache: 'no-store', headers: etag ? { 'if-none-match': etag } : {} });
      if (response.status !== 304) {
        if (!response.ok) throw new Error(`Error ${response.status}`);
        state = await response.json();
        etag = response.headers.get('etag');
      }
      online = true;
      const pi = state.pi;
      $('connection').className = `connection ${pi.installed ? 'ok' : 'bad'}`;
      $('connection-text').textContent = pi.installed ? `Pi · ${pi.provider ?? ''}${pi.modelOverride ? `/${pi.modelOverride}` : ''}` : 'Pi no instalado';
      render();
    }
  } catch {
    online = false;
    etag = null;
    $('connection').className = 'connection bad';
    $('connection-text').textContent = 'Servidor desconectado';
    render();
  } finally { setTimeout(poll, 1_200); }
}
void poll();
