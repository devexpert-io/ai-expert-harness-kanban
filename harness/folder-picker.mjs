import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const script = 'POSIX path of (choose folder with prompt "Selecciona el proyecto que Harness puede inspeccionar")';

export async function selectProjectFolder({ platform = process.platform, execute = execFileAsync } = {}) {
  if (platform !== 'darwin') throw new Error('El selector nativo de carpetas sólo está disponible en macOS');
  try {
    const { stdout } = await execute('/usr/bin/osascript', ['-e', script], { timeout: 120_000, maxBuffer: 16_384 });
    const path = stdout.trim();
    if (!path) throw new Error('El selector no devolvió ninguna carpeta');
    return path;
  } catch (error) {
    const detail = `${error.stderr ?? ''} ${error.message ?? ''}`;
    if (/User canceled|-128/i.test(detail)) return null;
    throw error;
  }
}
