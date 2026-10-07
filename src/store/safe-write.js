// @ts-check
// The only module that creates, writes, renames or removes files.
// Every call re-checks its target against two roots: the tool's home folder, and the
// two rule files during init. Anything inside a vault is refused.
import fs from 'node:fs';
import { resolveSafe, isInside, vaultRootAbove } from '../config/paths.js';

const roots = { home: /** @type {string | null} */ (null), vault: /** @type {string | null} */ (null), ruleFiles: new Set() };

/** @param {{ home: string, vault?: string | null, ruleFiles?: string[] }} opts */
export function configureWriter(opts) {
  roots.home = resolveSafe(opts.home);
  roots.vault = opts.vault ? resolveSafe(opts.vault) : null;
  roots.ruleFiles = new Set((opts.ruleFiles || []).map((f) => resolveSafe(f)));
}

/** Throws unless the target may be written. @param {string} target */
export function assertWritable(target) {
  const real = resolveSafe(target);
  const refuse = (/** @type {string} */ why) => Object.assign(new Error(`Refused to write ${why}.`), { code: 'VM_E_WRITE_REFUSED' });
  if (!roots.home) throw refuse('before the home folder was set');
  if (roots.vault && isInside(real, roots.vault)) throw refuse('inside the vault');
  if (vaultRootAbove(real)) throw refuse('inside a vault');
  if (isInside(real, roots.home) || roots.ruleFiles.has(real)) return real;
  throw refuse('outside the index folder');
}

function sleep(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }

/** @param {string} dir */
export function ensureDir(dir) { assertWritable(dir); fs.mkdirSync(dir, { recursive: true }); }

/** @param {string} file @param {string | Uint8Array} data */
export function writeFile(file, data) { assertWritable(file); fs.writeFileSync(file, data); }

/** Create a file only if it does not exist. Returns false when it already does. @param {string} file @param {string} data */
export function createExclusive(file, data) {
  assertWritable(file);
  try { fs.writeFileSync(file, data, { flag: 'wx' }); return true; }
  catch (e) { if (/** @type {any} */ (e).code === 'EEXIST') return false; throw e; }
}

/** @param {string} file @param {string | Uint8Array} data */
export function appendFile(file, data) { assertWritable(file); fs.appendFileSync(file, data); }

/** Rename, retrying briefly when another program has the file open. @param {string} from @param {string} to */
export function rename(from, to) {
  assertWritable(from); assertWritable(to);
  const end = Date.now() + 2000;
  for (;;) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      const code = /** @type {any} */ (e).code;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code) || Date.now() > end) throw e;
      sleep(50);
    }
  }
}

/** Write to a temp file, flush it to disk, then rename it into place. @param {string} file @param {string | Uint8Array} data */
export function writeFileAtomic(file, data) {
  assertWritable(file);
  const tmp = `${file}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, 'w');
  try { fs.writeSync(fd, /** @type {any} */ (data)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  rename(tmp, file);
}

/** Remove a file or a folder and everything in it. A missing target is fine. @param {string} target */
export function remove(target) { assertWritable(target); fs.rmSync(target, { recursive: true, force: true }); }

/** @param {string} file @param {number} length */
export function truncate(file, length) { assertWritable(file); fs.truncateSync(file, length); }

/**
 * Open a file for appending and keep it open.
 * @param {string} file
 * @returns {{ write: (data: string | Uint8Array) => number, sync: () => void, close: () => void, fd: number }}
 */
export function openAppend(file) {
  assertWritable(file);
  const fd = fs.openSync(file, 'a');
  return {
    fd,
    write: (data) => fs.writeSync(fd, /** @type {any} */ (data)),
    sync: () => fs.fsyncSync(fd),
    close: () => fs.closeSync(fd),
  };
}

/** For tests: forget the configured roots. */
export function resetWriter() { roots.home = null; roots.vault = null; roots.ruleFiles = new Set(); }
