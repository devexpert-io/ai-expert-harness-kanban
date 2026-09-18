const stages = [
  { id: 'pending', label: 'Pendiente', color: '#7180a7' },
  { id: 'planning', label: 'Planificando', color: '#b18aff' },
  { id: 'implementing', label: 'Implementando', color: '#ff8b4d' },
  { id: 'validating', label: 'Validando', color: '#59d6aa' },
  { id: 'review', label: 'Revisión humana', color: '#f5ca65' },
  { id: 'done', label: 'Terminada', color: '#75d7a7' }
];

const demoTasks = [
  { id: 'DX-184', title: 'Wishlist persistente', state: 'pending', role: 'Planner', skill: 'feature-spec', gate: 'Criterios definidos', trace: ['Feature seleccionada de feature_list.json', 'Dependencias: ninguna'] },
  { id: 'DX-185', title: 'Filtro por tallas', state: 'pending', role: 'Planner', skill: 'feature-spec', gate: 'Slice independiente', trace: ['Feature seleccionada de feature_list.json', 'Worktree planificado: filter-sizes'] },
  { id: 'DX-179', title: 'Resumen de pedido', state: 'implementing', role: 'Implementer', skill: 'feature-implementer', gate: 'Tests de componente', trace: ['Plan aceptado · 2 criterios verificables', 'pnpm test OrderSummary · passing'] },
  { id: 'DX-180', title: 'Estado vacío del carrito', state: 'validating', role: 'Validator', skill: 'feature-validator', gate: 'Verificación independiente', trace: ['Commit simulado: 64d3f21', 'Captura de navegador · 1440px'] },
  { id: 'DX-176', title: 'Ordenar por precio', state: 'review', role: 'Validator', skill: 'feature-validator', gate: 'PR simulada #42', trace: ['pnpm test · 18 tests passing', 'pnpm lint · passing', 'PR simulada #42 creada', 'STOP: espera de revisión humana'] },
  { id: 'DX-171', title: 'Imagen alternativa de producto', state: 'pending', blocked: { reason: 'Falta referencia de diseño', resolution: 'Esperando decisión de diseño' }, role: 'Planner', skill: 'build-brief', gate: 'Esperando referencia de diseño', trace: ['Condición bloqueante: falta una decisión de diseño', 'Sin worktree ni PR creados'] }
];

let tasks = prepareTasks(demoTasks);
let sourceTasks = structuredClone(tasks);
let selectedId = 'DX-176';
let currentProject = null;
let running = false;
let paused = false;
let intervalId = null;
let ticks = 0;
const activeRuns = new Map();

const board = document.querySelector('#board');
const emptyState = document.querySelector('#emptyState');
const template = document.querySelector('#taskTemplate');
const waveButton = document.querySelector('#waveButton');
const pauseButton = document.querySelector('#pauseButton');
const resetButton = document.querySelector('#resetButton');
const engineSelect = document.querySelector('#engineSelect');
const engineStatus = document.querySelector('#engineStatus');
const projectName = document.querySelector('#projectName');
const contextLabel = document.querySelector('#contextLabel');
const projectButton = document.querySelector('#projectButton');
const projectSummary = document.querySelector('#projectSummary');
const selectedFolder = document.querySelector('#selectedFolder');
const projectMessage = document.querySelector('#projectMessage');
const demoButton = document.querySelector('#demoButton');
const evidencePanel = document.querySelector('.evidence-panel');

function roleMeta(role) {
  if (role === 'Planner') return { avatar: 'P', avatarClass: 'planner' };
  if (role === 'Validator') return { avatar: 'V', avatarClass: 'validator' };
  return { avatar: 'I', avatarClass: 'builder' };
}

function prepareTasks(items) {
  return items.map((item) => {
    const role = item.role ?? 'Sin rol';
    return { ...item, ...roleMeta(role), role, skill: item.skill ?? 'Sin skill', gate: item.gate ?? 'Sin gate', trace: [...(item.trace ?? item.evidence ?? [])], running: false };
  });
}

function statusFor(task) {
  return task.blocked ? { label: 'Bloqueada · pendiente', color: '#f07185' } : stages.find((stage) => stage.id === task.state);
}
function liveTasks() { return tasks.filter((task) => !task.blocked && !['pending', 'review', 'done'].includes(task.state)); }
function totalWaveTasks() { return tasks.filter((task) => !task.blocked).length; }
function executable(task) { return !task.blocked && !['review', 'done'].includes(task.state) && !task.running; }

function renderBoard() {
  const hasTasks = tasks.length > 0;
  board.hidden = !hasTasks;
  emptyState.hidden = hasTasks;
  if (!hasTasks) {
    emptyState.textContent = currentProject?.emptyReason ?? 'Este proyecto no aporta tareas al Kanban.';
    board.innerHTML = '';
    return;
  }
  board.innerHTML = '';
  for (const stage of stages) {
    const stageTasks = tasks.filter((task) => task.state === stage.id);
    const column = document.createElement('section');
    column.className = 'column';
    const header = document.createElement('header');
    header.className = 'column-header';
    const title = document.createElement('span');
    title.className = 'column-title';
    const dot = document.createElement('i');
    dot.className = 'column-dot';
    dot.style.background = stage.color;
    title.append(dot, stage.label);
    const count = document.createElement('span');
    count.className = 'column-count';
    count.textContent = stageTasks.length;
    header.append(title, count);
    const list = document.createElement('div');
    list.className = 'task-list';
    if (!stageTasks.length) {
      const empty = document.createElement('div');
      empty.className = 'empty-column';
      empty.textContent = 'Sin tareas';
      list.append(empty);
    }
    for (const task of stageTasks) list.append(renderTask(task));
    column.append(header, list);
    board.append(column);
  }
}

function renderTask(task) {
  const card = template.content.firstElementChild.cloneNode(true);
  card.dataset.id = task.id;
  card.classList.toggle('selected', task.id === selectedId);
  card.classList.toggle('is-blocked', Boolean(task.blocked));
  card.querySelector('.issue').textContent = task.id;
  card.querySelector('.card-alert').textContent = task.blocked ? 'Bloqueada' : task.running ? 'Ejecutando' : '';
  card.querySelector('h3').textContent = task.title;
  card.querySelector('.skill').textContent = task.skill;
  card.querySelector('.gate').textContent = task.gate;
  const gateIcon = card.querySelector('.gate-icon');
  gateIcon.textContent = task.blocked ? '!' : '✓';
  gateIcon.classList.toggle('gate-blocked', Boolean(task.blocked));
  card.querySelector('.owner').textContent = task.role;
  const avatar = card.querySelector('.avatar');
  avatar.textContent = task.avatar;
  avatar.classList.add(`avatar-${task.avatarClass}`);
  const action = card.querySelector('.card-action');
  action.disabled = !executable(task);
  action.textContent = task.running ? 'Ejecutando…' : 'Ejecutar';
  action.addEventListener('click', (event) => { event.stopPropagation(); runTask(task.id); });
  card.addEventListener('click', () => selectTask(task.id));
  card.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectTask(task.id); } });
  return card;
}

function addDetail(container, label, value, className = '') {
  const key = document.createElement('div');
  key.className = 'trace-label';
  key.textContent = label;
  const content = document.createElement('div');
  content.className = `trace-value ${className}`.trim();
  content.textContent = value;
  container.append(key, content);
}

function renderDetail() {
  const task = tasks.find((item) => item.id === selectedId);
  evidencePanel.hidden = !task;
  if (!task) return;
  const status = statusFor(task);
  document.querySelector('#detailTitle').textContent = `${task.id} · ${task.title}`;
  const detailState = document.querySelector('#detailState');
  detailState.textContent = status.label;
  detailState.style.color = status.color;
  const content = document.querySelector('#detailContent');
  content.innerHTML = '';
  const trace = document.createElement('div');
  trace.className = 'trace';
  addDetail(trace, 'Responsable', task.role);
  addDetail(trace, 'Skill', task.skill);
  if (task.blocked) addDetail(trace, 'Condición', [task.blocked.reason, task.blocked.resolution].filter(Boolean).join(' · '), 'blocker-detail');
  addDetail(trace, 'Gate actual', task.gate);
  const label = document.createElement('div');
  label.className = 'trace-label';
  label.textContent = 'Evidencia';
  const list = document.createElement('ul');
  list.className = 'evidence-list';
  for (const item of task.trace) {
    const row = document.createElement('li');
    const mark = document.createElement('b');
    mark.textContent = task.blocked ? '!' : '✓';
    row.append(mark, item);
    list.append(row);
  }
  trace.append(label, list);
  content.append(trace);
  if (task.state === 'review') {
    const button = document.createElement('button');
    button.className = 'button button-primary integrate-button';
    button.textContent = '✓ Marcar como integrada';
    button.addEventListener('click', () => integrateTask(task.id));
    content.append(button);
  }
}

function selectTask(id) {
  selectedId = id;
  renderBoard();
  renderDetail();
}

function updateSummary() {
  const review = tasks.filter((task) => task.state === 'review').length;
  const done = tasks.filter((task) => task.state === 'done').length;
  const blocked = tasks.filter((task) => task.blocked).length;
  const total = totalWaveTasks();
  document.querySelector('#activeCount').textContent = liveTasks().length;
  document.querySelector('#reviewCount').textContent = review;
  document.querySelector('#blockerCount').textContent = blocked;
  document.querySelector('#progressBar').style.width = total ? `${Math.round(((review + done) / total) * 100)}%` : '0%';
  document.querySelector('#progressText').textContent = total ? `${review + done}/${total} en revisión o terminadas` : 'Sin tareas cargadas';
  if (!tasks.length) {
    document.querySelector('#runLabel').textContent = 'Proyecto sin contrato de tareas';
    document.querySelector('#timerText').textContent = 'Carga feature_list.json';
  } else if (!running) {
    const remaining = tasks.filter((task) => !task.blocked && !['review', 'done'].includes(task.state)).length;
    document.querySelector('#runLabel').textContent = done ? 'Integración humana registrada' : remaining ? 'Oleada preparada' : 'Esperando revisión humana';
    document.querySelector('#timerText').textContent = 'Se detiene antes del merge';
  } else if (paused) {
    document.querySelector('#runLabel').textContent = 'Oleada pausada';
    document.querySelector('#timerText').textContent = 'Ejecución retenida';
  } else {
    document.querySelector('#runLabel').textContent = `Oleada en ejecución · ${engineSelect.value}`;
    document.querySelector('#timerText').textContent = ticks ? `Paso ${ticks}` : 'Pi conectado';
  }
}

function promote(task) {
  const transitions = { pending: ['planning', 'Planner', 'feature-spec', 'Plan y criterios'], planning: ['implementing', 'Implementer', 'feature-implementer', 'Implementación aislada'], implementing: ['validating', 'Validator', 'feature-validator', 'Checks independientes'], validating: ['review', 'Validator', 'feature-validator', 'PR simulada lista'] };
  const next = transitions[task.state];
  if (!next) return;
  const [state, role, skill, gate] = next;
  Object.assign(task, { state, role, skill, gate, ...roleMeta(role) });
  task.trace.push({ planning: 'Mock · plan generado', implementing: 'Mock · worktree simulado', validating: 'Mock · checks passing', review: 'Mock · PR simulada · STOP humano' }[state]);
}

function advanceWave() {
  if (!running || paused) return;
  ticks += 1;
  tasks.filter((task) => executable(task)).forEach(promote);
  if (!liveTasks().length) {
    running = false;
    clearInterval(intervalId);
    intervalId = null;
    waveButton.disabled = true;
    pauseButton.disabled = true;
  }
  renderBoard();
  renderDetail();
  updateSummary();
}

async function runTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task || !executable(task)) return;
  const runEngine = engineSelect.value;
  task.running = true;
  if (runEngine === 'pi') resetButton.disabled = true;
  task.trace.push(`Solicitud enviada al motor ${runEngine}`);
  renderBoard();
  renderDetail();
  try {
    const response = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: id, engine: runEngine, projectPath: currentProject?.path ?? null })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'No se pudo iniciar la ejecución');
    const source = new EventSource(`/api/runs/${payload.runId}/events`);
    activeRuns.set(payload.runId, source);
    source.onmessage = ({ data }) => {
      const event = JSON.parse(data);
      if (event.stage) {
        Object.assign(task, { state: event.stage, role: event.role ?? task.role, skill: event.skill ?? task.skill, gate: event.gate ?? task.gate, ...roleMeta(event.role ?? task.role) });
      }
      if (event.evidence) task.trace.push(event.evidence);
      renderBoard();
      renderDetail();
      updateSummary();
    };
    source.addEventListener('complete', ({ data }) => {
      const final = JSON.parse(data);
      task.running = false;
      if (final.error) {
        task.gate = 'Ejecución fallida';
        task.trace.push(final.error);
      }
      source.close();
      activeRuns.delete(payload.runId);
      if (!activeRuns.size && runEngine === 'pi') {
        running = false;
        resetButton.disabled = false;
        waveButton.classList.remove('running');
        waveButton.textContent = '▶ Iniciar oleada';
        waveButton.disabled = !tasks.some(executable);
      }
      renderBoard();
      renderDetail();
      updateSummary();
    });
  } catch (error) {
    task.running = false;
    if (runEngine === 'pi') resetButton.disabled = false;
    task.gate = 'No iniciada';
    task.trace.push(error.message);
    renderBoard();
    renderDetail();
  }
}

function startWave() {
  if (running || !tasks.length) return;
  running = true;
  paused = false;
  ticks = 0;
  waveButton.textContent = engineSelect.value === 'pi' ? 'Pi en curso' : 'Oleada en curso';
  waveButton.classList.add('running');
  waveButton.disabled = true;
  if (engineSelect.value === 'pi') {
    pauseButton.disabled = true;
    resetButton.disabled = true;
    tasks.filter((task) => executable(task)).forEach((task) => runTask(task.id));
  } else {
    pauseButton.disabled = false;
    pauseButton.textContent = '⏸ Pausar';
    advanceWave();
    intervalId = window.setInterval(advanceWave, 1500);
  }
  updateSummary();
}

function togglePause() {
  if (engineSelect.value !== 'mock') return;
  paused = !paused;
  pauseButton.textContent = paused ? '▶ Reanudar' : '⏸ Pausar';
  updateSummary();
}

function integrateTask(id) {
  const task = tasks.find((item) => item.id === id);
  if (!task || task.state !== 'review') return;
  task.state = 'done';
  task.gate = 'Integración humana registrada';
  task.trace.push('Decisión humana: integrada · sin auto-merge del harness');
  selectTask(id);
  updateSummary();
}

function resetCurrent() {
  for (const source of activeRuns.values()) source.close();
  activeRuns.clear();
  tasks = structuredClone(sourceTasks);
  selectedId = tasks.find((task) => task.state === 'review')?.id ?? tasks[0]?.id ?? null;
  running = false;
  paused = false;
  ticks = 0;
  clearInterval(intervalId);
  intervalId = null;
  waveButton.disabled = !tasks.length;
  waveButton.classList.remove('running');
  waveButton.textContent = '▶ Iniciar oleada';
  pauseButton.disabled = true;
  pauseButton.textContent = '⏸ Pausar';
  resetButton.disabled = false;
  renderBoard();
  renderDetail();
  updateSummary();
}

function useDemo() {
  currentProject = null;
  projectName.textContent = 'Demo local';
  contextLabel.textContent = 'WAVE-042 · DEMO LOCAL';
  projectSummary.textContent = 'Seleccionar proyecto';
  selectedFolder.textContent = 'Ninguna carpeta seleccionada';
  projectButton.textContent = 'Elegir carpeta…';
  projectMessage.textContent = 'Modo mock determinista; no accede a ningún proyecto.';
  projectButton.closest('details').open = false;
  tasks = prepareTasks(demoTasks);
  sourceTasks = structuredClone(tasks);
  selectedId = 'DX-176';
  resetCurrent();
}

async function selectProject() {
  projectButton.disabled = true;
  projectButton.textContent = 'Abriendo selector…';
  projectMessage.textContent = 'Esperando la selección de una carpeta…';
  const response = await fetch('/api/projects/select', { method: 'POST' });
  const project = await response.json();
  if (!response.ok) throw new Error(project.error ?? 'No se pudo abrir la carpeta');
  if (project.cancelled) {
    projectMessage.textContent = currentProject ? 'Selección cancelada; se mantiene el proyecto actual.' : 'Selección cancelada; continúa la demo.';
    return;
  }
  currentProject = project;
  projectName.textContent = project.name;
  contextLabel.textContent = 'PROYECTO · LOCAL';
  projectSummary.textContent = `Proyecto: ${project.name}`;
  selectedFolder.textContent = project.path;
  projectMessage.textContent = [
    project.files.tasks ? 'feature_list.json cargado' : 'feature_list.json ausente',
    project.files.config ? '.harness/config.json cargado' : 'config opcional ausente'
  ].join(' · ');
  tasks = prepareTasks(project.tasks);
  sourceTasks = structuredClone(tasks);
  selectedId = tasks.find((task) => task.state === 'review')?.id ?? tasks[0]?.id ?? null;
  resetCurrent();
  projectButton.closest('details').open = false;
  if (project.config?.defaultEngine === 'pi' && !engineSelect.options[1].disabled) engineSelect.value = 'pi';
  projectButton.textContent = 'Cambiar carpeta…';
}

async function loadEngineStatus() {
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    const piOption = engineSelect.querySelector('option[value="pi"]');
    piOption.disabled = !status.pi.enabled;
    engineStatus.textContent = status.pi.enabled ? `Pi ${status.pi.version} disponible` : `Pi ${status.pi.version ?? ''} inactivo: ${status.pi.reason}`;
  } catch {
    engineSelect.querySelector('option[value="pi"]').disabled = true;
    engineStatus.textContent = 'Backend no disponible; sólo demo local';
  }
}

projectButton.addEventListener('click', async () => {
  try { await selectProject(); } catch (error) { projectMessage.textContent = error.message; }
  finally {
    projectButton.disabled = false;
    projectButton.textContent = currentProject ? 'Cambiar carpeta…' : 'Elegir carpeta…';
  }
});
demoButton.addEventListener('click', useDemo);
waveButton.addEventListener('click', startWave);
pauseButton.addEventListener('click', togglePause);
resetButton.addEventListener('click', resetCurrent);
engineSelect.addEventListener('change', () => { pauseButton.disabled = engineSelect.value !== 'mock' || !running; updateSummary(); });

useDemo();
loadEngineStatus();
