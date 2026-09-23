import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export function acquireServerLock(statePath) {
  const path = `${statePath}.lock`;
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (existsSync(path)) {
    const owner = JSON.parse(readFileSync(path, 'utf8'));
    let alive = true;
    try { process.kill(owner.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) throw new Error(`Ya hay un servidor usando este estado (PID ${owner.pid})`);
    unlinkSync(path);
  }
  const fd = openSync(path, 'wx', 0o600);
  writeFileSync(fd, JSON.stringify({ pid: process.pid }));
  closeSync(fd);
  return () => { if (existsSync(path) && JSON.parse(readFileSync(path, 'utf8')).pid === process.pid) unlinkSync(path); };
}
