import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { inspectProject } from './project-contract.mjs';
import { digest, loadRuntime, runtimeSummary } from './project-runtime.mjs';
import { executeFeature } from './feature-flow.mjs';
import { fileMemo } from './file-memo.mjs';
import { createReview, detectReview } from './review.mjs';
import { addWorktree, removeWorktree, uniqueBranch } from './worktree.mjs';

const unfinished = (run) => ['queued', 'running', 'blocked', 'interrupted'].includes(run.status);
const needsAttention = (run) => ['blocked', 'interrupted'].includes(run.status);
const inactive = (run) => ['discarded', 'closed'].includes(run.status);
const maxFeedback = 4_000;
// Polling reads these every second; execution always loads fresh copies.
const cachedProject = fileMemo(inspectProject, (_, project) => [join(project.path, 'feature_list.json'), join(project.path, '.harness', 'config.json')]);
const cachedRuntime = fileMemo(loadRuntime, (path, runtime) => runtime.sources.map((source) => join(path, source.path)));

export class FeatureQueue {
  constructor({ store, executor, piOptions = {}, piVersion, credentials = null, maxParallel = 3, worktreeRoot, detect = detectReview, reviewOptions = {} }) {
    this.store = store;
    this.executor = executor;
    this.piOptions = piOptions;
    this.piVersion = piVersion;
    this.credentials = credentials;
    this.maxParallel = maxParallel;
    // Absolute on purpose: git runs inside the project, the harness elsewhere; a relative root means two places.
    this.worktreeRoot = resolve(worktreeRoot ?? join(store.path, '..', 'worktrees'));
    this.detect = detect;
    this.reviewOptions = reviewOptions;
    this.active = new Map();
    this.closed = false;
    this.data.reviews ??= {};
  }
  get data() { return this.store.data; }
  save = () => this.store.save();
  currentRuns() { return this.data.runs.filter((run) => run.projectPath === this.data.projectPath); }
  project() { return this.data.projectPath ? inspectProject(this.data.projectPath) : null; }
  latestRun(id) { return [...this.currentRuns()].reverse().find((run) => run.taskId === id && !inactive(run)); }
  /** Merged by a human (or accepted before the harness), with nothing left in flight. */
  settled(project, id) {
    const run = this.latestRun(id);
    if (run) return run.status === 'done';
    return project.tasks.find((item) => item.id === id)?.sourceStatus === 'accepted';
  }
  review() {
    const settings = this.data.reviews[this.data.projectPath];
    if (!settings || settings.error) throw new Error(settings?.error ?? 'Vuelve a abrir el proyecto para detectar cómo se revisan las features');
    return createReview(settings, this.data.projectPath, this.reviewOptions);
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
      pi: { installed: Boolean(this.piVersion), version: this.piVersion, provider: this.piOptions.provider ?? null, modelOverride: this.piOptions.model ?? null, credentials: this.credentials?.status() ?? null },
      review: this.data.reviews[this.data.projectPath] ?? null, maxParallel: this.maxParallel,
      runs, paused: this.data.paused, activeRunIds: [...this.active.keys()] };
  }
  select(project) {
    if (this.data.runs.some((run) => ['queued', 'running'].includes(run.status))) throw new Error('Pausa y espera a que terminen las ejecuciones en curso antes de cambiar de proyecto');
    if (!project.files.tasks) throw new Error('Falta feature_list.json en la carpeta seleccionada');
    try { this.data.reviews[project.path] = this.detect(project.path); }
    catch (error) { this.data.reviews[project.path] = { error: `No se pudo preparar la revisión: ${error.message}` }; }
    this.data.projectPath = project.path;
    this.data.paused = false;
    this.save();
  }
  enqueue(ids) {
    if (!this.piVersion) throw new Error('Pi no está instalado');
    const project = this.project();
    if (!project) throw new Error('Abre un proyecto primero');
    loadRuntime(project.path);
    this.review();
    if (!Array.isArray(ids) || !ids.length || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new Error('Selecciona una lista de features sin duplicados');
    const selected = new Set(ids);
    const scheduled = new Set(this.currentRuns().filter((run) => !inactive(run) && run.status !== 'done' && run.status !== 'changes-requested').map((run) => run.taskId));
    for (const id of ids) {
      const task = project.tasks.find((item) => item.id === id);
      if (!task || this.settled(project, id) || task.blocked) throw new Error(`La feature ${id} no es ejecutable`);
      if (scheduled.has(id)) throw new Error(`${id} ya tiene una ejecución pendiente`);
      const missing = task.dependsOn.filter((dependency) => !this.settled(project, dependency) && !selected.has(dependency) && !scheduled.has(dependency));
      if (missing.length) throw new Error(`${id} necesita seleccionar primero: ${missing.join(', ')}`);
    }
    for (const task of project.tasks.filter((item) => selected.has(item.id))) this.data.runs.push(this.newRun(project, task));
    this.save();
    this.pump();
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
    if (this.active.has(candidate.id)) return false;
    const task = project.tasks.find((item) => item.id === candidate.taskId);
    if (!task || (task.blocked && !candidate.baseline)) return false;
    return candidate.reopen || candidate.acceptance || task.dependsOn.every((id) => this.settled(project, id));
  }
  /** Starts every queued feature whose dependencies are merged, up to the parallel limit. */
  pump() {
    if (this.closed || this.data.paused) return;
    let project;
    try { project = this.project(); } catch { return; }
    if (!project) return;
    for (const run of this.currentRuns().filter((item) => item.status === 'queued')) {
      if (this.active.size >= this.maxParallel) return;
      if (!project.tasks.some((item) => item.id === run.taskId)) this.fail(run, new Error(`La feature ${run.taskId} ya no existe en feature_list.json`));
      else if (this.runnable(project, run)) void this.start(run, project);
    }
  }
  fail(run, error) {
    run.status = this.closed ? 'interrupted' : 'blocked';
    run.error = error.message;
    this.event(run, { message: error.message, level: 'error' });
  }
  /** Each feature gets its own branch and worktree from the current base, so parallel runs never share files. */
  prepare(run) {
    if (run.worktree) {
      if (!existsSync(run.worktree)) throw new Error(`Falta el worktree ${run.worktree}; descarta la ejecución y lánzala de nuevo`);
      return run.worktree;
    }
    const repo = this.data.projectPath;
    const review = this.review();
    run.baseRef = review.baseRef();
    run.branch = uniqueBranch(repo, run.taskId);
    const path = join(this.worktreeRoot, `${basename(repo)}-${digest(repo).slice(0, 8)}`, `${run.taskId}-${run.id.slice(0, 8)}`);
    run.worktree = addWorktree(repo, path, run.branch, run.baseRef);
    this.save();
    this.event(run, { message: `Worktree ${run.branch} desde ${run.baseRef.replace(/^refs\/(heads|remotes)\//, '')}` });
    return run.worktree;
  }
  async start(run) {
    const controller = new AbortController();
    this.active.set(run.id, { run, controller });
    run.status = 'running';
    run.error = null;
    this.save();
    try {
      const cwd = this.prepare(run);
      const piOptions = { ...this.piOptions, ...(this.credentials ? { env: this.credentials.env() } : {}) };
      await executeFeature({ run, cwd, signal: controller.signal, save: this.save, emit: (event) => this.event(run, event), executor: this.executor, piOptions });
      if (!run.published) {
        run.pr = this.review().publish(run, { feedback: run.humanFeedback }) ?? null;
        run.published = true;
        this.save();
        this.event(run, { message: run.pr?.url ? `PR lista para revisión humana: ${run.pr.url}` : `Rama ${run.branch} lista para revisión humana` });
      }
    } catch (error) { this.fail(run, error); }
    finally {
      this.active.delete(run.id);
      this.save();
      if (!this.closed) queueMicrotask(() => this.pump());
    }
  }
  pause() { this.data.paused = true; this.save(); }
  resume() {
    this.data.paused = false;
    this.save();
    this.pump();
  }
  action(id, action, body = {}) {
    const run = this.currentRuns().find((item) => item.id === id);
    if (!run) throw new Error('Ejecución no encontrada');
    if (action === 'stop' && this.active.has(id)) {
      this.active.get(id).controller.abort();
    } else if (action === 'retry' && needsAttention(run)) {
      run.status = 'queued';
      run.error = null;
      // Continuing is an explicit go-ahead: a queue paused by a restart must not leave it waiting silently.
      this.data.paused = false;
      this.save();
      this.pump();
    } else if (action === 'discard' && ['queued', 'blocked', 'interrupted'].includes(run.status)) {
      run.status = 'discarded';
      run.error = run.worktree ? `Ejecución descartada. Su rama ${run.branch} y su worktree se conservan para que los revises.` : 'Ejecución descartada.';
      this.save();
    } else if (action === 'merge' && run.status === 'review') {
      this.merge(run);
    } else if (action === 'reject' && run.status === 'review') {
      this.reject(run, body.feedback);
    } else throw new Error('Acción no disponible en el estado actual');
  }
  merge(run) {
    const review = this.review();
    const sync = review.sync(run);
    if (sync.conflicts.length) throw new Error(`La rama choca con la base en ${sync.conflicts.join(', ')}; resuélvelo en la rama antes de integrar`);
    review.merge(run);
    this.refreshReviews();
  }
  /** Keeps the reviewed branch and queues another implementer → validator cycle with the human's feedback. */
  reject(run, feedback) {
    if (typeof feedback !== 'string' || !feedback.trim()) throw new Error('Describe qué hay que cambiar');
    if (feedback.length > maxFeedback) throw new Error(`El feedback no puede superar ${maxFeedback} caracteres`);
    const project = this.project();
    const task = project.tasks.find((item) => item.id === run.taskId);
    if (!task) throw new Error('La feature ya no existe en feature_list.json');
    run.status = 'changes-requested';
    run.feedback = feedback.trim();
    this.data.runs.push(this.newRun(project, task, { reopen: true, humanFeedback: run.feedback, repairBrief: run.feedback, previousRunId: run.id, worktree: run.worktree, branch: run.branch, baseRef: run.baseRef, pr: run.pr }));
    this.save();
    this.pump();
  }
  /**
   * Follows reviews outside the harness: a merged PR unlocks its dependents and the other open
   * branches are brought up to date with the new base; a closed PR frees the feature.
   */
  refreshReviews() {
    let review;
    try { review = this.review(); } catch { return; }
    let merged = false;
    for (const run of this.currentRuns().filter((item) => item.status === 'review' && item.published)) {
      let status;
      try { status = review.status(run); } catch (error) { run.reviewError = error.message; continue; }
      run.reviewError = null;
      if (status === 'open') continue;
      run.status = status === 'merged' ? 'done' : 'closed';
      run.stage = status === 'merged' ? 'done' : 'pending';
      if (status === 'merged') merged = true;
      if (!removeWorktree(this.data.projectPath, run.worktree)) this.event(run, { level: 'warn', message: `No se pudo borrar el worktree ${run.worktree}; revísalo a mano` });
      this.event(run, { message: status === 'merged' ? 'Integrada en la base tras la revisión humana' : 'La PR se cerró sin integrar' });
    }
    if (merged) {
      for (const run of this.currentRuns().filter((item) => item.status === 'review')) {
        try {
          const result = review.sync(run);
          run.syncConflicts = result.conflicts;
          if (result.changed) this.event(run, { message: `Rama actualizada con la base${result.resolved?.length ? ` (estado combinado en ${result.resolved.join(', ')})` : ''}` });
          if (result.conflicts.length) this.event(run, { level: 'warn', message: `Conflicto con la base en ${result.conflicts.join(', ')}; resuélvelo en la rama` });
        } catch (error) { this.event(run, { level: 'warn', message: `No se pudo actualizar la rama: ${error.message}` }); }
      }
    }
    this.save();
    this.pump();
  }
  watchReviews(intervalMs = 20_000) {
    this.reviewTimer = setInterval(() => this.refreshReviews(), intervalMs);
    this.reviewTimer.unref?.();
  }
  async close() {
    this.closed = true;
    clearInterval(this.reviewTimer);
    this.pause();
    for (const { controller } of this.active.values()) controller.abort();
    this.store.flush();
  }
}
