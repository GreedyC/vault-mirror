// @ts-check
// Two logs per index folder. Neither ever holds note text, note names or search questions.
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { appendFile, ensureDir } from './store/safe-write.js';

/** A note is logged by this key, never by its name. @param {string} vaultPath */
export function noteKey(vaultPath) {
  return crypto.createHash('sha256').update(vaultPath).digest('hex').slice(0, 16);
}

let logDir = /** @type {string | null} */ (null);
/** @param {string | null} dir */
export function setLogDir(dir) { logDir = dir; }

function write(name, line) {
  if (!logDir) return;
  try { ensureDir(logDir); appendFile(path.join(logDir, name), line.endsWith('\n') ? line : line + '\n'); } catch { /* a log must never stop a command */ }
}

/**
 * A stack trace or a library's message names files by their full path, and a path under the home
 * folder carries the account name. The debug log may be shared, so the home folder is written as ~.
 * @param {string} text
 */
export function withoutHome(text) {
  const home = os.homedir();
  return home && home.length > 1 ? text.split(home).join('~') : text;
}

/** @param {string} message */
export function debug(message) { write('debug.log', `${new Date().toISOString()} ${withoutHome(message)}`); }

/** One line per run, plain key=value. @param {string} command @param {Record<string, string | number>} fields */
export function runLine(command, fields) {
  const parts = Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(' ');
  write('sync.log', `${new Date().toISOString().replace(/\.\d+Z$/, 'Z')} ${command} ${parts}`);
}
