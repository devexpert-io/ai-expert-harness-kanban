import { html, shortHash } from './html.js';
import { attentionStatuses, byId, repairs, selectable, stages, waiting } from './model.js';

function status(task, index) {
  const run = task.run;
  if (task.live && attentionStatuses.includes(run.status)) return { tone: 'error', text: run.error ?? 'Necesita atención' };
  if (task.blocked) return { tone: 'error', text: task.blocked.reason || 'Bloqueada en feature_list.json' };
  if (task.live && run.status === 'running') return { tone: 'live', text: run.events.at(-1)?.message ?? `${run.role ?? 'Preparando'}…` };
  if (task.live && run.status === 'review') return { tone: 'review', text: `Commit ${shortHash(run.commit)} · revisa y aprueba o pide cambios` };
  const { review, other } = waiting(task, index);
  if (task.live && run.status === 'queued') {
    if (review.length) return { tone: 'idle', text: `En cola · espera tu revisión de ${review.join(', ')}` };
    if (other.length) return { tone: 'idle', text: `En cola · espera ${other.join(', ')}` };
    return { tone: 'idle', text: run.reopen ? 'En cola · cambios pedidos en revisión' : 'En cola' };
  }
  if (other.length || review.length) return { tone: 'idle', text: `Depende de ${[...other, ...review].join(', ')}` };
  if (task.state === 'pending') return { tone: 'idle', text: 'Lista para iniciar' };
  if (task.sourceStatus === 'passing') return { tone: 'idle', text: 'Autoverificada · falta validación independiente' };
  return { tone: 'idle', text: task.gate };
}

function card(task, { index, selection, focused }) {
  const run = task.run;
  const state = status(task, index);
  const fixes = task.live ? repairs(run) : 0;
  const role = task.live && run.status === 'running' ? run.role : null;
  const classes = ['card', focused === task.id && 'focused', state.tone === 'error' && 'problem', state.tone === 'review' && 'awaiting', role && 'running'].filter(Boolean).join(' ');
  return html`<article class="${classes}">
    <div class="card-heading">
      <code>${task.id}</code><span class="chip">${task.area}</span>
      ${selectable(task) ? html`<input type="checkbox" data-select="${task.id}" data-focus-key="select-${task.id}" aria-label="Seleccionar ${task.title}" ${selection.has(task.id) ? 'checked' : ''}>` : ''}
    </div>
    <button class="card-title" data-detail="${task.id}" data-focus-key="detail-${task.id}">${task.title}</button>
    ${role ? html`<p class="card-role"><span class="pulse" aria-hidden="true"></span>${role} · ${run.skill ?? ''}</p>` : ''}
    <p class="card-status tone-${state.tone}">${state.text}</p>
    ${fixes ? html`<p class="card-meta">Reparaciones ${fixes}/3</p>` : ''}
  </article>`;
}

export function renderBoard(all, { selection, focused, emptyReason }) {
  if (!all.length) return html`<p class="board-empty">${emptyReason ?? 'feature_list.json no contiene features.'}</p>`;
  const index = byId(all);
  return html`${stages.map(([stage, title]) => {
    const items = all.filter((task) => task.state === stage);
    const attention = stage === 'review' && items.some((task) => task.run?.status === 'review');
    return html`<section class="column ${attention ? 'attention' : ''}" data-stage="${stage}">
      <h2>${title} <span class="count">${items.length}</span>${attention ? html`<span class="your-turn">Tu turno</span>` : ''}</h2>
      <div class="cards">${items.length ? items.map((task) => card(task, { index, selection, focused })) : html`<p class="column-empty">—</p>`}</div>
    </section>`;
  })}`;
}
