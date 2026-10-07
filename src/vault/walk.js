// @ts-check
// Walks a vault and lists its notes. Reads names, sizes and dates only.
import path from 'node:path';
import { walk, stat } from './read-only-fs.js';
import { readObsidianExcludes } from './obsidian-registry.js';

/**
 * @typedef {{ key: string, abs: string, size: number, mtimeMs: number }} NoteFile
 * @typedef {{ key: string, reason: string, size: number, mtimeMs: number, abs: string | null }} LeftOutFile
 * @typedef {object} WalkResult
 * @property {NoteFile[]} notes          notes that belong in the index, as far as names can tell
 * @property {LeftOutFile[]} leftOut     notes left out by name or place
 * @property {number} otherFiles         images, PDFs, canvases and the like: counted, never read
 * @property {string[]} warnings
 * @property {string[]} unreadableDirs   folders that could not be listed (vault-relative)
 */

/** The manifest key for a vault-relative path: forward slashes, NFC, no-break spaces as ordinary spaces. @param {string} rel */
export function noteKeyOf(rel) {
  return rel.split(path.sep).join('/').normalize('NFC').replace(/ /g, ' ');
}

/** @param {string} key @param {string[]} prefixes */
function underAny(key, prefixes) {
  return prefixes.some((p) => {
    const clean = p.replace(/^\/+|\/+$/g, '');
    return clean && (key === clean || key.startsWith(clean + '/'));
  });
}

/**
 * @param {string} root   the vault's real path
 * @param {{ exclude?: string[], obsidianExcludes?: boolean }} [opts]
 * @returns {WalkResult}
 */
export function walkVault(root, opts = {}) {
  const exclude = opts.exclude || [];
  /** @type {WalkResult} */
  const result = { notes: [], leftOut: [], otherFiles: 0, warnings: [], unreadableDirs: [] };
  const obsidian = opts.obsidianExcludes === false ? { test: () => false, warning: null } : readObsidianExcludes(root);
  if (obsidian.warning) result.warnings.push(obsidian.warning);
  /** @type {Map<string, true>} */
  const seen = new Map();

  /** @param {string} dir @param {string} rel @param {string | null} forced a reason that applies to everything below */
  function visit(dir, rel, forced) {
    /** @type {import('./read-only-fs.js').Entry[]} */
    let entries;
    try { entries = walk(dir); } catch { result.unreadableDirs.push(rel || '.'); return; }
    for (const e of entries) {
      const childRel = rel ? path.join(rel, e.name) : e.name;
      const stub = /^\.(.+\.md)\.icloud$/i.exec(e.name);
      if (stub) { // a cloud stub: the note is present, not downloaded
        const key = noteKeyOf(rel ? path.join(rel, stub[1]) : stub[1]);
        result.leftOut.push({ key, reason: 'not-downloaded', size: 0, mtimeMs: 0, abs: null });
        continue;
      }
      if (e.name.startsWith('.')) continue;
      const isNote = /\.md$/i.test(e.name);
      if (e.isSymlink) {
        if (isNote) result.leftOut.push({ key: noteKeyOf(childRel), reason: 'symlink', size: 0, mtimeMs: 0, abs: null });
        else result.otherFiles++;
        continue;
      }
      if (e.isDir) {
        const key = noteKeyOf(childRel);
        const nested = !forced && Boolean(stat(path.join(e.abs, '.obsidian'))?.isDir);
        visit(e.abs, childRel, forced || (nested ? 'nested-vault' : underAny(key, exclude) ? 'excluded' : null));
        continue;
      }
      if (!e.isFile) continue;
      if (!isNote) { result.otherFiles++; continue; }
      const key = noteKeyOf(childRel);
      const s = stat(e.abs);
      if (!s) continue; // it vanished between the listing and the stat
      const reason = forced || (underAny(key, exclude) ? 'excluded' : obsidian.test(key) ? 'obsidian-excluded' : seen.has(key) ? 'duplicate-path' : null);
      if (reason) { result.leftOut.push({ key, reason, size: s.size, mtimeMs: s.mtimeMs, abs: e.abs }); continue; }
      seen.set(key, true);
      result.notes.push({ key, abs: e.abs, size: s.size, mtimeMs: s.mtimeMs });
    }
  }
  visit(root, '', null);
  return result;
}
