// @ts-check
// init: set the vault and write the one-line rule. The only command that registers a vault.
import fs from 'node:fs';
import path from 'node:path';
import { homeDir, loadConfig, saveConfig, indexDirFor, VAULT_DEFAULTS } from '../../config/config.js';
import { checkOneVault, checkIndexOutside, inCloudFolder, CLOUD_VAULT_NOTE, CLOUD_HOME_NOTE } from '../../config/guards.js';
import { resolveSafe, isInside, vaultRootAbove, tildify, expandHome } from '../../config/paths.js';
import { configureWriter, writeFile } from '../../store/safe-write.js';
import { walkVault } from '../../vault/walk.js';
import { lookupVault } from '../../vault/obsidian-registry.js';
import { stat } from '../../vault/read-only-fs.js';
import { RULE_BLOCK, RULE_START, RULE_END } from '../../rule-text.js';
import { VmError } from '../../errors.js';
import { plural } from '../output.js';

/** The vault's templates folder, when Obsidian's templates plugin names one. @param {string} vaultReal */
function templatesFolder(vaultReal) {
  try {
    const folder = JSON.parse(fs.readFileSync(path.join(vaultReal, '.obsidian', 'templates.json'), 'utf8')).folder;
    if (typeof folder === 'string' && folder.trim() && stat(path.join(vaultReal, folder))?.isDir) return folder.replace(/^\/+|\/+$/g, '');
  } catch { /* no templates plugin settings */ }
  return null;
}

/** May the rule be written into this project folder? @param {string} project @param {string} vaultReal @param {string[]} obsidianVaults */
export function projectCheck(project, vaultReal, obsidianVaults) {
  let real;
  try { real = resolveSafe(project); } catch { return { ok: false, reason: 'the folder could not be resolved' }; }
  if (!stat(real)?.isDir) return { ok: false, reason: 'the folder does not exist' };
  if (isInside(real, vaultReal)) return { ok: false, reason: 'it is inside your vault' };
  if (vaultRootAbove(real)) return { ok: false, reason: 'it is inside a vault' };
  for (const v of obsidianVaults) { try { if (v && isInside(real, resolveSafe(v))) return { ok: false, reason: 'it is inside a vault Obsidian knows' }; } catch { /* unreadable entry */ } }
  return { ok: true, reason: null, real };
}

/** Insert or replace the rule between its two markers. Nothing else in the file is touched. @param {string | null} existing */
export function applyRule(existing) {
  if (existing == null) return { text: RULE_BLOCK + '\n', action: 'created' };
  const a = existing.indexOf(RULE_START); const b = existing.indexOf(RULE_END);
  if (a >= 0 && b > a) {
    const next = existing.slice(0, a) + RULE_BLOCK + existing.slice(b + RULE_END.length);
    return { text: next, action: next === existing ? 'unchanged' : 'updated' };
  }
  const sep = existing.length === 0 || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n';
  return { text: existing + sep + RULE_BLOCK + '\n', action: 'updated' };
}

/**
 * @param {{ vaultPath: string, project?: string, noRule?: boolean, exclude?: string[] }} args
 * @param {import('../output.js').Ui} ui
 */
export async function initCommand(args, ui) {
  const home = homeDir();
  const one = checkOneVault(expandHome(args.vaultPath));
  checkIndexOutside(one.real, home);
  const registry = lookupVault(one.real);
  const project = path.resolve(args.project || process.cwd());
  const check = args.noRule ? { ok: false, reason: 'you asked for no rule file' } : projectCheck(project, one.real, registry.vaults);
  const ruleTargets = check.ok ? [path.join(project, 'CLAUDE.md'), path.join(project, 'AGENTS.md')] : [];
  configureWriter({ home, vault: one.real, ruleFiles: ruleTargets });

  const previous = loadConfig(home);
  const same = previous.vault && (() => { try { return resolveSafe(previous.vault.path) === one.real; } catch { return false; } })();
  /** @type {string[]} */
  const exclude = [...new Set([...(same && previous.vault ? previous.vault.exclude : []), ...(args.exclude || []).map((e) => e.replace(/^\/+|\/+$/g, ''))])];
  const templates = templatesFolder(one.real);
  let proposed = null;
  if (templates && !exclude.includes(templates)) { exclude.push(templates); proposed = templates; }
  const walk = walkVault(one.real, { exclude, obsidianExcludes: true });
  const notesFound = walk.notes.length;
  if (notesFound + walk.leftOut.length === 0) throw new VmError('VM_E_USAGE', { detail: `No notes (.md files) were found in ${tildify(one.real)}.` });

  const vault = { ...VAULT_DEFAULTS, ...(same && previous.vault ? previous.vault : {}), path: one.real, exclude };
  saveConfig(home, { ...previous, vault });
  const indexDir = indexDirFor(home, one.real);
  const name = path.basename(one.real);

  /** @type {{ file: string, action: string, reason: string | null }[]} */
  const ruleFiles = [];
  for (const file of ['CLAUDE.md', 'AGENTS.md']) {
    const target = path.join(project, file);
    if (!check.ok) { ruleFiles.push({ file: target, action: 'skipped', reason: check.reason }); continue; }
    let existing = null;
    try { existing = fs.readFileSync(target, 'utf8'); } catch { existing = null; }
    const r = applyRule(existing);
    if (r.action !== 'unchanged') writeFile(target, r.text);
    ruleFiles.push({ file: target, action: r.action, reason: null });
  }

  if (previous.vault && !same) ui.info(`Switched from ${tildify(previous.vault.path)} to ${tildify(one.real)}. Each vault keeps its own index, so switching back costs nothing.`);
  ui.out(`Set up ${name} (${plural(notesFound, 'note')}). It only reads your notes. The index lives in ${tildify(indexDir)}, outside the vault, and holds a copy of your notes' text on this computer only.`);
  if (proposed) ui.out(`Left out the templates folder "${proposed}". To include it, remove it from "exclude" in ${tildify(path.join(home, 'config.json'))}.`);
  for (const w of [...one.warnings, ...walk.warnings]) ui.warn(w);
  if (inCloudFolder(one.real)) ui.warn(CLOUD_VAULT_NOTE);
  try { if (inCloudFolder(resolveSafe(home))) ui.warn(CLOUD_HOME_NOTE); } catch { /* checked by the guards */ }
  if (check.ok) ui.out(`Wrote the vault rule to CLAUDE.md and AGENTS.md in ${tildify(project)}. (Wrong folder? Run init again with --project <folder>.)`);
  else if (!args.noRule) {
    ui.out(`The vault rule was not written to ${tildify(project)} because ${check.reason}. Paste this into your project's CLAUDE.md or AGENTS.md:`);
    ui.out(RULE_BLOCK);
  }
  ui.out('Next: vault-mirror sync');
  return { vault: { name, path: one.real }, body: { indexDir, notesFound, excluded: exclude, ruleFiles } };
}
