// Keeps Pi in our process group and stops it if the host disappears unexpectedly.
import { spawn } from 'node:child_process';
const hostPid = process.ppid;
const [binary, ...args] = process.argv.slice(2);
const child = spawn(binary, args, { stdio: 'inherit' });
const watchdog = setInterval(() => {
  if (process.ppid !== hostPid) {
    if (process.platform !== 'win32') process.kill(-process.pid, 'SIGKILL');
    else { child.kill(); process.exit(1); }
  }
}, 500);
child.on('error', (error) => { console.error(error.message); clearInterval(watchdog); process.exitCode = 1; });
child.on('close', (code) => { clearInterval(watchdog); process.exitCode = code ?? 1; });
