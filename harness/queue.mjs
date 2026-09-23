import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { inspectProject } from './project-contract.mjs';
import { loadRuntime, runtimeSummary } from './project-runtime.mjs';
import { executeFeature } from './feature-flow.mjs';
import { fileMemo } from './file-memo.mjs';

const unfinished = (run) => ['queued', 'running', 'blocked', 'interrupted'].includes(run.status);
const needsAttention = (run) => ['blocked', 'interrupted'].includes(run.status);
const maxFeedback = 4_000;
// Polling reads these every second; execution always loads fresh copies.
const cachedProject = fileMemo(inspectProject, (_, project) => [join(project.path, 'feature_list.json'), join(project.path, '.harness', 'config.json')]);
const cachedRuntime = fileMemo(loadRuntime, (path, runtime) => runtime.sources.map((source) => join(path, source.path)));

export class FeatureQueue {
  constructor({ store, executor, piOptions = {}, piVersion, credentials = null }) {
    this.store = store;
    this.executor = executor;
    this.piOptions = piOptions;
    this.piVersion = piVersion;
    this.credentials = credentials;
    this.active = null;
    this.closed = false;
  }
  get data() { return this.store.data; }
  save = () => this.store.save();
  currentRuns() { return this.data.runs.filter((run) => run.projectPath === this.data.projectPath); }
  project() { return this.data.projectPath ? inspectProject(this.data.projectPath) : null; }
  /** A dependency counts only once accepted and human-reviewed, so work never builds on an unreviewed commit. */
  pendingDependencies(project, task) {
    const runs = this.currentRuns();
    return task.dependsOn.filter((id) => project.tasks.find((item) => item.id === id)?.sourceStatus !== 'accepted'
      || runs.some((run) => run.taskId === id && (unfinished(run) || run.status === 'review')));
  }
  snapshot() {
    let project = null;
    let error = null;
    let runtime = null;
    let runtimeError = null;
    try { project = this.data.projectPath ? cachedProject(this.data.projectPath) : null; } catch (failure) { error = failure.message; }
    if (project) { try { runtime = cachedRuntime(project.path); } catch (failure) { runtimeError = failure.message; } }
    const runs = this.currentRuns().map(({ baseline, inventory, acceptance, roleBaseline, ...run }) => ({ ...run, files: acceptance?.files ?? run.ownedFiles ?? [] }));
    return { project, projectPath: this.data.projectPath, error, runtime: runtimeSummary(runtime, runtimeError),
      pi: { installed: Boolean(this.piVersion), version: this.piVersion, provider: this.piOptions.provider ?? null, modelOverride: this.piOptions.model ?? null, credentials: this.credentials },
      runs, paused: this.data.paused, activeRunId: this.active?.run.id ?? null };
  }
  select(project) {
    if (this.data.runs.some(unfinished)) throw new Error('Termina o descarta la cola actual antes de cambiar de proyecto');
    if (!project.files.tasks) throw new Error('Falta feature_list.json en la carpeta seleccionada');
    this.data.projectPath = project.path;
    this.data.paused = false;
    this.save();
  }
  enqueue(ids) {
    if (!this.piVersion) throw new Error('Pi no está instalado');
    const project = this.project();
    if (!project) throw new Error('Abre un proyecto primero');
    loadRuntime(project.path);
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Selecciona una lista de features sin duplicados');
    const existing = this.currentRuns();
    const selected = new Set(ids);
    const scheduled = new Set(existing.filter((run) => unfinished(run) || run.status === 'review').map((run) => run.taskId));
    for (const id of ids) {
      const task = project.tasks.find((item) => item.id === id);
      if (!task || task.sourceStatus === 'accepted' || task.blocked) throw new Error(`La feature ${id} no es ejecutable`);
      if (scheduled.has(id)) throw new Error(`${id} ya tiene una ejecución pendiente`);
      const missing = task.dependsOn.filter((dependency) => project.tasks.find((item) => item.id === dependency)?.sourceStatus !== 'accepted' && !selected.has(dependency) && !scheduled.has(dependency));
      if (missing.length) throw new Error(`${id} necesita seleccionar primero: ${missing.join(', ')}`);
    }
    for (const task of project.tasks.filter((item) => selected.has(item.id))) this.data.runs.push(this.newRun(project, task));
    this.save();
    void this.pump();
  }
  newRun(project, task, extra = {}) {
    return { id: randomUUID(), projectPath: project.path, taskId: task.id, title: task.title, status: 'queued', stage: 'pending', events: [], steps: [], createdAt: new Date().toISOString(), ...extra };
  }
  event(run, event) {
    run.events.push({ at: new Date().toISOString(), level: 'info', ...event });
    // Durable role results are never truncated; activity is a bounded tail.
    if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
    // Activity is frequent and not needed for recovery; coalesce its writes.
    event.level === 'error' ? this.save() : this.store.saveSoon();
  }
  runnable(project, candidate) {
    const task = project.tasks.find((item) => item.id === candidate.taskId);
    if (!task || (task.blocked && !candidate.baseline)) return false;
    if (task.sourceStatus === 'accepted' && !candidate.reopen && !candidate.acceptance) return false;
    return !this.pendingDependencies(project, task).length;
  }
  /** Queued work that only waits for a human review of a dependency is idle, not blocked. */
  waitingForReview(project, queued) {
    const inReview = new Set(this.currentRuns().filter((run) => run.status === 'review').map((run) => run.taskId));
    return queued.some((run) => project.tasks.find((item) => item.id === run.taskId)?.dependsOn.some((id) => inReview.has(id)));
  }
  async pump() {
    if (this.active || this.closed || this.data.paused) return;
    const queued = this.currentRuns().filter((run) => run.status === 'queued');
    if (!queued.length) return;
    let run;
    let started = false;
    try {
      const project = this.project();
      run = queued.find((candidate) => this.runnable(project, candidate));
      // Finalization recovery may already have persisted accepted before the commit.
      run ??= queued.find((candidate) => candidate.acceptance);
      if (!run && this.waitingForReview(project, queued)) return;
      if (!run) throw new Error('La cola espera dependencias aceptadas o una feature cambió. Revisa el inventario y la selección');
      const controller = new AbortController();
      this.active = { run, controller };
      started = true;
      run.status = 'running';
      run.error = null;
      this.save();
      await executeFeature({ run, cwd: project.path, signal: controller.signal, save: this.save, emit: (event) => this.event(run, event), executor: this.executor, piOptions: this.piOptions });
    } catch (error) {
      run ??= queued[0];
      run.status = this.closed ? 'interrupted' : 'blocked';
      run.error = error.message;
      this.data.paused = true;
      this.event(run, { message: error.message, level: 'error' });
    } finally {
      if (started) this.active = null;
      this.save();
      if (started && !this.data.paused && !this.closed) queueMicrotask(() => this.pump());
    }
  }
  pause() { this.data.paused = true; this.save(); }
  assertResumable(except) {
    if (this.currentRuns().some((run) => run !== except && needsAttention(run))) throw new Error('Continúa o descarta la ejecución bloqueada antes de reanudar la cola');
  }
  resume() {
    this.assertResumable();
    this.data.paused = false;
    this.save();
    void this.pump();
  }
  action(id, action, body = {}) {
    const run = this.currentRuns().find((item) => item.id === id);
    if (!run) throw new Error('Ejecución no encontrada');
    if (action === 'stop' && this.active?.run.id === id) {
      this.pause();
      this.active.controller.abort();
    } else if (action === 'retry' && needsAttention(run)) {
      this.assertResumable(run);
      run.status = 'queued';
      run.error = null;
      this.resume();
    } else if (action === 'discard' && ['queued', 'blocked', 'interrupted'].includes(run.status)) {
      run.status = 'discarded';
      run.error = 'Ejecución descartada. Sus archivos no se han borrado ni revertido.';
      this.save();
    } else if (action === 'reviewed' && run.status === 'review') {
      run.status = 'done';
      run.stage = 'done';
      this.save();
      void this.pump();
    } else if (action === 'reject' && run.status === 'review') {
      this.reject(run, body.feedback);
    } else throw new Error('Acción no disponible en el estado actual');
  }
  /** Keeps the reviewed commit and queues a new implementer → validator cycle with the human's feedback. */
  reject(run, feedback) {
    if (typeof feedback !== 'string' || !feedback.trim()) throw new Error('Describe qué hay que cambiar');
    if (feedback.length > maxFeedback) throw new Error(`El feedback no puede superar ${maxFeedback} caracteres`);
    const project = this.project();
    const task = project.tasks.find((item) => item.id === run.taskId);
    if (!task || task.sourceStatus !== 'accepted') throw new Error('La feature ya no está aceptada en feature_list.json; revisa el inventario');
    run.status = 'changes-requested';
    run.stage = 'done';
    run.feedback = feedback.trim();
    this.data.runs.push(this.newRun(project, task, { reopen: true, humanFeedback: run.feedback, repairBrief: run.feedback, previousRunId: run.id }));
    this.save();
    void this.pump();
  }
  async close() {
    this.closed = true;
    this.pause();
    this.active?.controller.abort();
    this.store.flush();
  }
}
