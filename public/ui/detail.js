import { clockTime, html, list, shortHash } from './html.js';
import { attentionStatuses, byId, repairs } from './model.js';

const statusLabels = { queued: 'En cola', running: 'Ejecutando', blocked: 'Bloqueada', interrupted: 'Interrumpida', review: 'Pendiente de tu revisión', done: 'Revisada', 'changes-requested': 'Cambios pedidos', discarded: 'Descartada' };

function actions(run, busy) {
  if (!run) return '';
  const button = (name, label, style = '') => html`<button class="${style}" data-action="${name}" data-run="${run.id}" ${busy ? 'disabled' : ''}>${label}</button>`;
  const buttons = [
    run.status === 'running' && button('stop', 'Detener ejecución', 'danger'),
    attentionStatuses.includes(run.status) && button('retry', 'Continuar desde este paso', 'primary'),
    ['queued', 'blocked', 'interrupted'].includes(run.status) && button('discard', 'Quitar de la cola', 'quiet'),
    run.status === 'review' && button('reviewed', 'Aprobar revisión', 'primary'),
    run.status === 'review' && button('reject', 'Pedir cambios')
  ].filter(Boolean);
  return buttons.length ? html`<div class="toolbar detail-actions">${buttons}</div>` : '';
}

function dependencies(task, index) {
  return html`<ul class="dependencies">${task.dependsOn.map((id) => {
    const dependency = index.get(id);
    const label = dependency?.run?.status === 'review' ? 'pendiente de tu revisión' : dependency?.live ? 'en curso' : dependency?.gate ?? 'desconocida';
    return html`<li><button class="link" data-detail="${id}">${id}</button> <span class="muted">· ${label}</span></li>`;
  })}</ul>`;
}

function step(item, index) {
  const key = `step-${index}`;
  return html`<details class="step" data-key="${key}">
    <summary><strong>${item.role}</strong> · ${item.verdict ?? item.outcome} <span class="muted">${item.skill} · ${clockTime(item.at)}</span></summary>
    <p>${item.summary}</p>
    ${item.evidence.length ? list(item.evidence) : ''}
    ${item.repairBrief ? html`<h3>Correcciones pedidas</h3><p class="pre-wrap">${item.repairBrief}</p>` : ''}
    ${item.files.length ? html`<h3>Archivos</h3>${list(item.files)}` : ''}
    ${item.output ? html`<h3>Respuesta completa</h3><pre data-scroll="${key}-output">${item.output}</pre>` : ''}
  </details>`;
}

function history(task) {
  const previous = task.history.filter((run) => run !== task.run && run.status !== 'discarded');
  if (!previous.length) return '';
  return html`<h3>Iteraciones anteriores</h3><ol class="history">${previous.map((run) => html`<li>
    <span class="chip">${statusLabels[run.status] ?? run.status}</span>
    ${run.commit ? html` <code>${shortHash(run.commit)}</code>` : ''}
    ${run.feedback ? html`<p class="pre-wrap">${run.feedback}</p>` : ''}
  </li>`)}</ol>`;
}

export function renderDetail(task, { all, busy }) {
  const index = byId(all);
  const run = task.run;
  const fixes = repairs(run);
  return html`<header class="detail-heading">
      <div><p class="eyebrow">${task.id} · ${task.area}</p><h2 id="detail-title">${task.title}</h2>
        <p class="detail-badges"><span class="chip">${task.gate}</span>${run ? html`<span class="chip tone-${run.status}">${statusLabels[run.status] ?? run.status}</span>` : ''}${fixes ? html`<span class="chip">Reparaciones ${fixes}/3</span>` : ''}</p>
      </div>
      <button class="quiet icon" data-close aria-label="Cerrar detalle (Esc)">✕</button>
    </header>
    <p>${task.objective}</p>
    ${task.blocked ? html`<p class="notice error">${task.blocked.reason}</p>` : ''}
    ${task.live && run.error ? html`<p class="notice error">${run.error}</p>` : ''}
    ${run?.humanFeedback && task.live ? html`<p class="notice"><strong>Cambios que pediste:</strong> ${run.humanFeedback}</p>` : ''}
    ${actions(run, busy)}
    ${run?.status === 'review' ? html`<section class="review-box">
      <h3>Revisión humana</h3>
      <p>Commit local <code>${shortHash(run.commit)}</code>${run.files?.length ? html` · ${run.files.length} archivo(s)` : ''}. Sin push ni merge. Las features que dependen de esta esperan tu aprobación.</p>
      ${run.testing ? html`<h3>Cómo probarlo</h3><p class="pre-wrap">${run.testing}</p>` : ''}
      ${run.files?.length ? html`<h3>Archivos del commit</h3>${list(run.files)}` : ''}
    </section>` : ''}
    <div class="detail-grid">
      <div><h3>Verificación esperada</h3>${list(task.criteria)}
        ${task.dependsOn.length ? html`<h3>Dependencias</h3>${dependencies(task, index)}` : ''}</div>
      <div><h3>Evidencia del proyecto</h3>${task.evidence.length ? list(task.evidence) : html`<p class="muted">Todavía no hay evidencia.</p>`}
        ${run?.commit && run.status !== 'review' ? html`<h3>Commit local</h3><code class="wrap">${run.commit}</code>` : ''}
        ${run?.testing && run.status !== 'review' ? html`<h3>Cómo probarlo</h3><p class="pre-wrap">${run.testing}</p>` : ''}</div>
    </div>
    ${history(task)}
    ${run?.steps?.length ? html`<h3>Pasos</h3>${run.steps.map(step)}` : ''}
    ${run?.events?.length ? html`<details class="activity-block" data-key="activity" open>
      <summary>Actividad · ${run.events.length} eventos recientes</summary>
      <ol class="activity" data-scroll="activity" data-stick>${run.events.map((event) => html`<li class="level-${event.level} kind-${event.kind ?? 'info'}"><time>${clockTime(event.at)}</time><span>${event.role ? html`<b>${event.role}</b> ` : ''}${event.message}</span></li>`)}</ol>
    </details>` : ''}`;
}
