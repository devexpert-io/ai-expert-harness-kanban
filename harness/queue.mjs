import { randomUUID } from 'node:crypto';
import { inspectProject } from './project-contract.mjs';
import { loadRuntime, runtimeSummary } from './project-runtime.mjs';
import { executeFeature } from './feature-flow.mjs';

const unfinished = (run) => ['queued', 'running', 'blocked', 'interrupted'].includes(run.status);
export class FeatureQueue {
  constructor({ store, executor, piOptions = {}, piVersion }) {
    this.store = store;
    this.executor = executor;
    this.piOptions = piOptions;
    this.piVersion = piVersion;
    this.active = null;
    this.closed = false;
  }
  get data() { return this.store.data; }
  save = () => this.store.save();
  currentRuns() { return this.data.runs.filter((run) => run.projectPath === this.data.projectPath); }
  project() { return this.data.projectPath ? inspectProject(this.data.projectPath) : null; }
  snapshot() {
    let project = null;
    let error = null;
    let runtime = null;
    let runtimeError = null;
    try { project = this.project(); } catch (failure) { error = failure.message; }
    if (project) { try { runtime = loadRuntime(project.path); } catch (failure) { runtimeError = failure.message; } }
    const runs = this.currentRuns().map(({ baseline, inventory, acceptance, sources, ...run }) => ({ ...run, sources, files: acceptance?.files ?? run.ownedFiles ?? [] }));
    return { project, projectPath: this.data.projectPath, error, runtime: runtimeSummary(runtime, runtimeError),
      pi: { installed: Boolean(this.piVersion), version: this.piVersion, provider: this.piOptions.provider ?? null, modelOverride: this.piOptions.model ?? null },
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
    const scheduled = new Set(existing.filter((run) => ['queued', 'running'].includes(run.status)).map((run) => run.taskId));
    for (const id of ids) {
      const task = project.tasks.find((item) => item.id === id);
      if (!task || task.sourceStatus === 'accepted' || task.blocked) throw new Error(`La feature ${id} no es ejecutable`);
      if (existing.some((run) => run.taskId === id && (unfinished(run) || run.status === 'review'))) throw new Error(`${id} ya tiene una ejecución pendiente`);
      const missing = task.dependsOn.filter((dependency) => project.tasks.find((item) => item.id === dependency)?.sourceStatus !== 'accepted' && !selected.has(dependency) && !scheduled.has(dependency));
      if (missing.length) throw new Error(`${id} necesita seleccionar primero: ${missing.join(', ')}`);
    }
    for (const task of project.tasks.filter((item) => selected.has(item.id))) {
      this.data.runs.push({ id: randomUUID(), projectPath: project.path, taskId: task.id, title: task.title, status: 'queued', stage: 'pending', events: [], steps: [], createdAt: new Date().toISOString() });
    }
    this.save();
    void this.pump();
  }
  event(run, event) {
    run.events.push({ at: new Date().toISOString(), level: 'info', ...event });
    // Durable role results are never truncated; activity is a bounded tail.
    if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
    this.save();
  }
  async pump() {
    if (this.active || this.closed || this.data.paused) return;
    const queued = this.currentRuns().filter((run) => run.status === 'queued');
    if (!queued.length) return;
    let run;
    try {
      const project = this.project();
      run = queued.find((candidate) => {
        const task = project.tasks.find((item) => item.id === candidate.taskId);
        return task && (!task.blocked || candidate.baseline) && task.sourceStatus !== 'accepted' && task.dependsOn.every((id) => project.tasks.find((item) => item.id === id)?.sourceStatus === 'accepted');
      });
      // Finalization recovery may already have persisted accepted before the commit.
      run ??= queued.find((candidate) => candidate.acceptance);
      if (!run) throw new Error('La cola espera dependencias aceptadas o una feature cambió. Revisa el inventario y la selección');
      const controller = new AbortController();
      this.active = { run, controller };
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
      this.active = null;
      this.save();
      if (!this.data.paused && !this.closed) queueMicrotask(() => this.pump());
    }
  }
  pause() { this.data.paused = true; this.save(); }
  resume() {
    if (this.currentRuns().some((run) => ['blocked', 'interrupted'].includes(run.status))) throw new Error('Continúa o descarta la ejecución bloqueada antes de reanudar la cola');
    this.data.paused = false;
    this.save();
    void this.pump();
  }
  action(id, action) {
    const run = this.currentRuns().find((item) => item.id === id);
    if (!run) throw new Error('Ejecución no encontrada');
    if (action === 'stop' && this.active?.run.id === id) {
      this.pause();
      this.active.controller.abort();
    } else if (action === 'retry' && ['blocked', 'interrupted'].includes(run.status)) {
      run.status = 'queued';
      run.error = null;
      this.save();
      this.resume();
    } else if (action === 'discard' && ['queued', 'blocked', 'interrupted'].includes(run.status)) {
      run.status = 'discarded';
      run.error = 'Ejecución descartada. Sus archivos no se han borrado ni revertido.';
      this.save();
    } else if (action === 'reviewed' && run.status === 'review') {
      run.status = 'done';
      run.stage = 'done';
      this.save();
    } else throw new Error('Acción no disponible en el estado actual');
  }
  async close() {
    this.closed = true;
    this.pause();
    this.active?.controller.abort();
  }
}
