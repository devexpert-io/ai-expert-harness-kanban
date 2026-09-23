import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export class StateStore {
  constructor(path) {
    this.path = path;
    this.data = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { version: 1, projectPath: null, runs: [], paused: false };
    if (this.data.version !== 1 || !Array.isArray(this.data.runs)) throw new Error('El estado guardado no es compatible; no se sobrescribirá');
    for (const run of this.data.runs) {
      if (run.status === 'running') {
        run.status = 'interrupted';
        run.error = 'El servidor se cerró durante la ejecución. Revisa los archivos antes de continuar.';
      }
    }
    if (this.data.runs.some((run) => ['queued', 'interrupted'].includes(run.status))) this.data.paused = true;
    this.save();
  }
  save() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temp = `${this.path}.tmp`;
    writeFileSync(temp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, this.path);
  }
}
