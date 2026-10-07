// @ts-check
// sync --detach: start the same sync as a background process and return at once.
// An agent's shell cuts long commands; this is the guard.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDir, openAppend, writeFile } from '../store/safe-write.js';

/**
 * @param {string} indexDir
 * @param {string[]} args   the sync flags to pass on (without --detach)
 * @returns {{ pid: number | undefined, outFile: string }}
 */
export function startDetached(indexDir, args) {
  const logs = path.join(indexDir, 'logs');
  ensureDir(logs);
  const outFile = path.join(logs, 'last-sync.out');
  writeFile(outFile, '');
  const out = openAppend(outFile);
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'vault-mirror.js');
  try {
    const child = spawn(process.execPath, [bin, 'sync', ...args], { detached: true, stdio: ['ignore', out.fd, out.fd], env: process.env });
    child.unref();
    return { pid: child.pid, outFile };
  } finally { out.close(); }
}
