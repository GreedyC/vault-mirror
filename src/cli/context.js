// @ts-check
// Loads the config and runs the guards before every command.
import path from 'node:path';
import { homeDir, loadConfig, indexDirFor } from '../config/config.js';
import { checkOneVault, checkIndexOutside } from '../config/guards.js';
import { configureWriter } from '../store/safe-write.js';
import { VmError } from '../errors.js';

/**
 * @param {{ needVault: boolean }} o
 * @returns {import('../sync/run.js').Context & { vaultWarnings: string[] }}
 */
export function loadContext(o) {
  const home = homeDir();
  const cfg = loadConfig(home);
  if (!cfg.vault) {
    if (o.needVault) throw new VmError('VM_E_NO_VAULT');
    configureWriter({ home });
    return /** @type {any} */ ({ home, cfg, vault: null, indexDir: '', vaultWarnings: [] });
  }
  const one = checkOneVault(cfg.vault.path);
  checkIndexOutside(one.real, home);
  configureWriter({ home, vault: one.real });
  return { home, cfg, vault: { real: one.real, name: path.basename(one.real), opened: one.opened }, indexDir: indexDirFor(home, one.real), vaultWarnings: one.warnings };
}
