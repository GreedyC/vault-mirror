// @ts-check
// The only module allowed to touch vault paths. It can list, stat and read. It cannot write.
import { opendirSync, lstatSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** @typedef {{ name: string, abs: string, isDir: boolean, isFile: boolean, isSymlink: boolean }} Entry */

/**
 * The entries of one folder, sorted by raw name. Throws when the folder cannot be read.
 * @param {string} dir
 * @returns {Entry[]}
 */
export function walk(dir) {
  const handle = opendirSync(dir);
  /** @type {Entry[]} */
  const out = [];
  try {
    for (let d = handle.readSync(); d; d = handle.readSync()) {
      out.push({ name: d.name, abs: path.join(dir, d.name), isDir: d.isDirectory(), isFile: d.isFile(), isSymlink: d.isSymbolicLink() });
    }
  } finally { handle.closeSync(); }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Size and times of one path, without following a symlink. Null when it is not there.
 * @param {string} p
 */
export function stat(p) {
  try {
    const s = lstatSync(p);
    return { size: s.size, mtimeMs: Math.floor(s.mtimeMs), isDir: s.isDirectory(), isFile: s.isFile(), isSymlink: s.isSymbolicLink() };
  } catch (e) {
    if (/** @type {any} */ (e).code === 'ENOENT' || /** @type {any} */ (e).code === 'ENOTDIR') return null;
    throw e;
  }
}

/**
 * The bytes of one file. Rejects with code VM_READ_TIMEOUT when the read takes too long
 * (a cloud service may show a file whose content has not downloaded).
 * @param {string} file
 * @param {number} [timeoutMs]
 * @returns {Promise<Buffer>}
 */
export async function readBytes(file, timeoutMs = 10000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    return await readFile(file, { signal: ac.signal });
  } catch (e) {
    if (/** @type {any} */ (e).name === 'AbortError') throw Object.assign(new Error('read timed out'), { code: 'VM_READ_TIMEOUT' });
    throw e;
  } finally { clearTimeout(timer); }
}
