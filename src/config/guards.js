// @ts-check
// The guards that run before every command: one vault only, and the index outside it.
import os from 'node:os';
import path from 'node:path';
import { resolveSafe, isInside, ancestors } from './paths.js';
import { stat, walk } from '../vault/read-only-fs.js';
import { VmError } from '../errors.js';

const hasObsidian = (/** @type {string} */ dir) => Boolean(stat(path.join(dir, '.obsidian'))?.isDir);

/**
 * Check that a folder is exactly one vault.
 * @param {string} vaultPath
 * @returns {{ real: string, opened: boolean, warnings: string[] }}
 */
export function checkOneVault(vaultPath) {
  /** @type {string} */
  let real;
  try { real = resolveSafe(vaultPath); } catch { throw new VmError('VM_E_VAULT_MISSING', { path: vaultPath }); }
  const here = stat(real);
  if (!here || !here.isDir) throw new VmError('VM_E_VAULT_MISSING', { path: vaultPath });
  const notOne = (/** @type {string | undefined} */ use) => new VmError('VM_E_NOT_ONE_VAULT', { path: vaultPath, use });
  let home = os.homedir();
  try { home = resolveSafe(home); } catch { /* keep the unresolved home */ }
  if (real === path.parse(real).root || real === home) throw notOne(undefined);
  for (const dir of ancestors(path.dirname(real))) if (hasObsidian(dir)) throw notOne(dir);
  if (hasObsidian(real)) return { real, opened: true, warnings: [] };
  for (const level1 of safeDirs(real)) {
    if (hasObsidian(level1)) throw notOne(level1);
    for (const level2 of safeDirs(level1)) if (hasObsidian(level2)) throw notOne(level2);
  }
  return { real, opened: false, warnings: ['Obsidian has not opened this folder as a vault yet, so links to notes will not work. Open it in Obsidian once to fix that.'] };
}

/** @param {string} dir */
function safeDirs(dir) {
  try { return walk(dir).filter((e) => e.isDir && !e.name.startsWith('.')).map((e) => e.abs); } catch { return []; }
}

/**
 * Refuse when the vault and the home folder contain one another.
 * @param {string} vaultReal
 * @param {string} home
 * @returns {string} the real path of the home folder
 */
export function checkIndexOutside(vaultReal, home) {
  /** @type {string} */
  let homeReal;
  try { homeReal = resolveSafe(home); } catch { throw new VmError('VM_E_INDEX_IN_VAULT'); }
  if (isInside(homeReal, vaultReal) || isInside(vaultReal, homeReal)) throw new VmError('VM_E_INDEX_IN_VAULT');
  return homeReal;
}

const CLOUD = [
  ['Library', 'Mobile Documents'], ['Library', 'CloudStorage'], ['Dropbox'], ['OneDrive'], ['Google Drive'], ['iCloud Drive'], ['Documents'], ['Desktop'],
];

/** True when a path sits in a folder that a cloud service commonly syncs. @param {string} real */
export function inCloudFolder(real) {
  const home = os.homedir();
  return CLOUD.some((parts) => isInside(real, path.join(home, ...parts)))
    || /(^|[\\/])(Dropbox|OneDrive[^\\/]*|Google Drive|iCloud Drive)([\\/]|$)/.test(real);
}

export const CLOUD_VAULT_NOTE = 'Your vault is in a folder that may sync to the cloud. That is fine. The index stays on this computer only.';
export const CLOUD_HOME_NOTE = 'The index folder is in a folder that may sync to the cloud. Move it by setting VAULT_MIRROR_HOME to a folder that does not sync.';
