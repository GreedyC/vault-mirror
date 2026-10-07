// @ts-check
// What Obsidian itself knows: its list of vaults (for links) and a vault's "Excluded files".
// Everything here is read only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stat } from './read-only-fs.js';

/** Where Obsidian keeps its vault list on this platform. */
export function vaultListPath() {
  if (process.env.VAULT_MIRROR_OBSIDIAN_JSON) return process.env.VAULT_MIRROR_OBSIDIAN_JSON; // tests
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'obsidian', 'obsidian.json');
}

/**
 * @param {string} vaultReal
 * @returns {{ state: 'registered' | 'not-registered' | 'no-list', vaultParam: string | null, vaults: string[] }}
 */
export function lookupVault(vaultReal) {
  /** @type {any} */
  let list;
  try { list = JSON.parse(fs.readFileSync(vaultListPath(), 'utf8')); } catch { list = null; }
  const name = path.basename(vaultReal);
  if (!list || typeof list.vaults !== 'object' || !list.vaults) {
    // On Linux packaged installs keep the list elsewhere, so a name-based link is still offered.
    const linux = process.platform !== 'darwin' && process.platform !== 'win32';
    return { state: 'no-list', vaultParam: linux ? name : null, vaults: [] };
  }
  /** @type {{ id: string, path: string }[]} */
  const entries = Object.entries(list.vaults).map(([id, v]) => ({ id, path: String(/** @type {any} */ (v)?.path || '') }));
  const real = (/** @type {string} */ p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const mine = entries.find((e) => e.path && real(e.path) === vaultReal);
  const vaults = entries.map((e) => e.path);
  if (!mine) return { state: 'not-registered', vaultParam: null, vaults };
  const sameName = entries.filter((e) => path.basename(e.path).toLowerCase() === name.toLowerCase()).length > 1;
  return { state: 'registered', vaultParam: sameName ? mine.id : name, vaults };
}

/**
 * Obsidian's own "Excluded files" setting, read the way Obsidian reads it:
 * /…/ is a regular expression, anything else is a path prefix, letter case ignored in both.
 * @param {string} vaultReal
 * @returns {{ test: (key: string) => boolean, warning: string | null }}
 */
export function readObsidianExcludes(vaultReal) {
  const file = path.join(vaultReal, '.obsidian', 'app.json');
  if (!stat(file)) return { test: () => false, warning: null };
  /** @type {((key: string) => boolean)[]} */
  const tests = [];
  let warning = null;
  try {
    const filters = JSON.parse(fs.readFileSync(file, 'utf8')).userIgnoreFilters;
    if (Array.isArray(filters)) {
      for (const f of filters) {
        if (typeof f !== 'string' || !f) continue;
        if (f.length > 1 && f.startsWith('/') && f.endsWith('/')) {
          try { const re = new RegExp(f.slice(1, -1), 'i'); tests.push((key) => re.test(key)); }
          catch { warning = 'One of Obsidian\'s "Excluded files" entries could not be read and was skipped.'; }
        } else {
          const prefix = f.toLowerCase();
          tests.push((key) => key.toLowerCase().startsWith(prefix));
        }
      }
    }
  } catch { warning = 'Obsidian\'s settings file could not be read, so its "Excluded files" list was skipped.'; }
  return { test: (key) => tests.some((t) => t(key)), warning };
}
