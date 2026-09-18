const stages = [
  { id: 'pending', label: 'Pendiente', color: '#7180a7' },
  { id: 'planning', label: 'Planificando', color: '#b18aff' },
  { id: 'implementing', label: 'Implementando', color: '#ff8b4d' },
  { id: 'validating', label: 'Validando', color: '#59d6aa' },
  { id: 'review', label: 'Revisión humana', color: '#f5ca65' },
  { id: 'done', label: 'Terminada', color: '#75d7a7' }
];

const initialTasks = [
  {
    id: 'DX-184', title: 'Wishlist persistente', state: 'pending', role: 'Planner', avatar: 'P', avatarClass: 'planner', skill: 'feature-spec', gate: 'Criterios definidos',
    trace: ['Feature seleccionada de feature_list.json', 'Dependencias: ninguna', 'Lista para iniciar la oleada']
  },
  {
    id: 'DX-185', title: 'Filtro por tallas', state: 'pending', role: 'Planner', avatar: 'P', avatarClass: 'planner', skill: 'feature-spec', gate: 'Slice independiente',
    trace: ['Feature seleccionada de feature_list.json', 'Dependencias: ninguna', 'Worktree planificado: filter-sizes']
  },
  {
    id: 'DX-179', title: 'Resumen de pedido', state: 'implementing', role: 'Implementer', avatar: 'I', avatarClass: 'builder', skill: 'feature-implementer', gate: 'Tests de componente',
    trace: ['Plan aceptado · 2 criterios verificables', 'worktree: wave-042/order-summary', 'pnpm test OrderSummary · passing']
  },
  {
    id: 'DX-180', title: 'Estado vacío del carrito', state: 'validating', role: 'Validator', avatar: 'V', avatarClass: 'validator', skill: 'feature-validator', gate: 'Verificación independiente',
    trace: ['Commit: 64d3f21 · estado vacío', 'pnpm lint · passing', 'Captura de navegador · 1440px']
  },
  {
    id: 'DX-176', title: 'Ordenar por precio', state: 'review', role: 'Validator', avatar: 'V', avatarClass: 'validator', skill: 'feature-validator', gate: 'PR simulada #42',
    trace: ['pnpm test · 18 tests passing', 'pnpm lint · passing', 'PR simulada #42 creada', 'STOP: espera de revisión humana']
  },
  {
    id: 'DX-171', title: 'Imagen alternativa de producto', state: 'pending', blocked: { reason: 'Falta referencia de diseño', resolution: 'Esperando decisión de diseño' }, role: 'Planner', avatar: 'P', avatarClass: 'planner', skill: 'build-brief', gate: 'Esperando referencia de diseño',
    trace: ['Condición bloqueante: falta una decisión de diseño', 'Permanece pendiente; no se inicia hasta tener referencia', 'Sin worktree ni PR creados']
  }
];

let tasks = structuredClone(initialTasks);
let selectedId = 'DX-176';
let running = false;
let paused = false;
let intervalId = null;
let ticks = 0;

const board = document.querySelector('#board');
const template = document.querySelector('#taskTemplate');
const waveButton = document.querySelector('#waveButton');
const pauseButton = document.querySelector('#pauseButton');
const resetButton = document.querySelector('#resetButton');

function stageFor(state) { return stages.find((stage) => stage.id === state); }
function statusFor(task) { return task.blocked ? { label: 'Bloqueada · pendiente', color: '#f07185' } : stageFor(task.state); }
function liveTasks() { return tasks.filter((task) => !task.blocked && !['pending', 'review', 'done'].includes(task.state)); }
function totalWaveTasks() { return tasks.filter((task) => !task.blocked).length; }

function renderBoard() {
  const visibleStages = stages;
  board.innerHTML = '';
  visibleStages.forEach((stage) => {
    const stageTasks = tasks.filter((task) => task.state === stage.id);
    const column = document.createElement('section');
    column.className = 'column';
    column.innerHTML = `<header class="column-header"><span class="column-title"><i class="column-dot" style="background:${stage.color}"></i>${stage.label}</span><span class="column-count">${stageTasks.length}</span></header>`;
    const list = document.createElement('div');
    list.className = 'task-list';
    if (!stageTasks.length) list.innerHTML = '<div class="empty-column">Sin tareas</div>';
    stageTasks.forEach((task) => list.append(renderTask(task)));
    column.append(list);
    board.append(column);
  });
}

function renderTask(task) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.id = task.id;
  card.classList.toggle('selected', task.id === selectedId);
  card.classList.toggle('is-blocked', Boolean(task.blocked));
  card.querySelector('.issue').textContent = task.id;
  card.querySelector('.card-alert').textContent = task.blocked ? 'Bloqueada' : '';
  card.querySelector('h3').textContent = task.title;
  card.querySelector('.skill').textContent = task.skill;
  card.querySelector('.gate').textContent = task.gate;
  const gateIcon = card.querySelector('.gate-icon');
  gateIcon.textContent = task.blocked ? '!' : '✓';
  gateIcon.classList.toggle('gate-blocked', Boolean(task.blocked));
  card.querySelector('.owner').textContent = task.role;
  const avatar = card.querySelector('footer .avatar');
  avatar.textContent = task.avatar; avatar.classList.add(`avatar-${task.avatarClass}`);
  card.addEventListener('click', () => selectTask(task.id));
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTask(task.id); } });
  return card;
}

function selectTask(id) {
  selectedId = id;
  const task = tasks.find((item) => item.id === id);
  const status = statusFor(task);
  document.querySelector('#detailTitle').textContent = `${task.id} · ${task.title}`;
  const detailState = document.querySelector('#detailState'); detailState.textContent = status.label; detailState.style.color = status.color;
  const action = task.state === 'review' ? `<button class="button button-primary integrate-button" data-integrate="${task.id}">✓ Marcar como integrada</button>` : '';
  const blocker = task.blocked ? `<div class="trace-label">Condición</div><div class="trace-value blocker-detail">${task.blocked.reason} · ${task.blocked.resolution}</div>` : '';
  document.querySelector('#detailContent').innerHTML = `<div class="trace"><div class="trace-label">Responsable</div><div class="trace-value"><i class="avatar avatar-${task.avatarClass}">${task.avatar}</i> ${task.role}</div><div class="trace-label">Skill</div><div class="trace-value">${task.skill}</div>${blocker}<div class="trace-label">Gate actual</div><div class="trace-value">${task.gate}</div><div class="trace-label">Evidencia</div><ul class="evidence-list">${task.trace.map((item) => `<li><b>${task.blocked ? '!' : '✓'}</b>${item}</li>`).join('')}</ul></div>${action}`;
  document.querySelector('[data-integrate]')?.addEventListener('click', () => integrateTask(task.id));
  renderBoard();
}

function updateSummary() {
  const active = liveTasks().length;
  const review = tasks.filter((task) => task.state === 'review').length;
  const done = tasks.filter((task) => task.state === 'done').length;
  const blocked = tasks.filter((task) => task.blocked).length;
  document.querySelector('#activeCount').textContent = active;
  document.querySelector('#reviewCount').textContent = review;
  document.querySelector('#blockerCount').textContent = blocked;
  document.querySelector('#progressBar').style.width = `${Math.round(((review + done) / totalWaveTasks()) * 100)}%`;
  document.querySelector('#progressText').textContent = `${review + done}/${totalWaveTasks()} en revisión o terminadas`;
  if (!running) {
    const remaining = tasks.filter((task) => !task.blocked && !['review', 'done'].includes(task.state)).length;
    document.querySelector('#runLabel').textContent = done ? 'Integración humana registrada' : remaining ? 'Oleada preparada' : 'Esperando revisión humana';
    document.querySelector('#timerText').textContent = 'Se detiene antes del merge';
  } else if (paused) {
    document.querySelector('#runLabel').textContent = 'Oleada pausada';
    document.querySelector('#timerText').textContent = 'Ejecución retenida';
  } else {
    document.querySelector('#runLabel').textContent = 'Oleada en ejecución';
    document.querySelector('#timerText').textContent = `Paso ${ticks}`;
  }
}

function promote(task) {
  const transitions = { pending: ['planning', 'Planner', 'P', 'planner', 'feature-spec', 'Plan y criterios'], planning: ['implementing', 'Implementer', 'I', 'builder', 'feature-implementer', 'Implementación aislada'], implementing: ['validating', 'Validator', 'V', 'validator', 'feature-validator', 'Checks independientes'], validating: ['review', 'Validator', 'V', 'validator', 'feature-validator', 'PR simulada lista'] };
  const next = transitions[task.state];
  if (!next) return;
  const [state, role, avatar, avatarClass, skill, gate] = next;
  task.state = state; task.role = role; task.avatar = avatar; task.avatarClass = avatarClass; task.skill = skill; task.gate = gate;
  const evidence = {
    planning: 'Plan generado · criterios verificables', implementing: 'Worktree aislado creado · cambios acotados', validating: 'pnpm test · passing · revisión independiente', review: 'PR simulada creada · STOP: espera de revisión humana'
  };
  task.trace.push(evidence[state]);
}

function advanceWave() {
  if (!running || paused) return;
  ticks += 1;
  tasks.filter((task) => !task.blocked && !['review', 'done'].includes(task.state)).forEach(promote);
  if (!liveTasks().length) { running = false; clearInterval(intervalId); intervalId = null; waveButton.disabled = true; pauseButton.disabled = true; }
  renderBoard(); updateSummary();
}

function startWave() {
  if (running) return;
  running = true; paused = false; waveButton.textContent = 'Oleada en curso'; waveButton.classList.add('running'); waveButton.disabled = true; pauseButton.disabled = false; pauseButton.textContent = '⏸ Pausar';
  advanceWave(); intervalId = window.setInterval(advanceWave, 1500);
  updateSummary();
}
function togglePause() { paused = !paused; pauseButton.textContent = paused ? '▶ Reanudar' : '⏸ Pausar'; updateSummary(); }
function integrateTask(id) {
  const task = tasks.find((item) => item.id === id); if (!task || task.state !== 'review') return;
  task.state = 'done'; task.gate = 'Integración humana registrada'; task.trace.push('Decisión humana: integrada · sin auto-merge del harness');
  selectTask(id); updateSummary();
}
function resetDemo() { tasks = structuredClone(initialTasks); selectedId = 'DX-176'; running = false; paused = false; ticks = 0; clearInterval(intervalId); intervalId = null; waveButton.disabled = false; waveButton.classList.remove('running'); waveButton.textContent = '▶ Iniciar oleada'; pauseButton.disabled = true; pauseButton.textContent = '⏸ Pausar'; selectTask(selectedId); updateSummary(); }

waveButton.addEventListener('click', startWave); pauseButton.addEventListener('click', togglePause); resetButton.addEventListener('click', resetDemo);
selectTask(selectedId); updateSummary();
