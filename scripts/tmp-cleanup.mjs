// Temporary folders a browser check makes (the Chrome profile, test files) are removed when the
// check exits, so repeated runs don't fill %TEMP% (M13 review, finding 3). The check's own Chrome
// is closed first, with its child processes, because Windows won't delete a profile in use.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dirs = [];
const procs = [];

/** A new folder in the system temp folder, removed when the check exits. */
export function tempDir(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A process (the check's Chrome) to close, with its children, before the folders are removed. */
export function track(proc) {
  procs.push(proc);
  return proc;
}

process.on('exit', () => {
  for (const p of procs) {
    if (p.pid === undefined || p.exitCode !== null) continue;
    try {
      if (process.platform === 'win32') execFileSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
      else p.kill('SIGKILL');
    } catch {
      // Already gone.
    }
  }
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    } catch (e) {
      console.log(`Couldn't remove ${dir}: ${e.message}`);
    }
  }
});
