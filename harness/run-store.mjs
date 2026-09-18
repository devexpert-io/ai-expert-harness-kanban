import { randomUUID } from 'node:crypto';

export class RunStore {
  #runs = new Map();

  create({ taskId, engine, projectPath = null }) {
    const run = { id: randomUUID(), taskId, engine, projectPath, status: 'running', events: [], subscribers: new Set(), controller: new AbortController() };
    this.#runs.set(run.id, run);
    return run;
  }

  get(id) { return this.#runs.get(id) ?? null; }

  emit(id, event) {
    const run = this.get(id);
    if (!run) return;
    const item = { sequence: run.events.length + 1, at: new Date().toISOString(), taskId: run.taskId, engine: run.engine, ...event };
    run.events.push(item);
    for (const subscriber of run.subscribers) subscriber(item);
  }

  complete(id, error = null) {
    const run = this.get(id);
    if (!run) return;
    run.status = error ? 'failed' : 'complete';
    run.error = error?.message ?? null;
    if (error) this.emit(id, { type: 'error', level: 'error', evidence: error.message });
    for (const subscriber of run.subscribers) subscriber(null, run);
    run.subscribers.clear();
  }

  subscribe(id, subscriber) {
    const run = this.get(id);
    if (!run) return null;
    run.subscribers.add(subscriber);
    return () => run.subscribers.delete(subscriber);
  }
}
