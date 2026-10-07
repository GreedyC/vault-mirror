// @ts-check
// Path helpers that never guess: resolve through symlinks, compare on whole segments.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Expand a leading ~ and make the path absolute. @param {string} p */
export function expandHome(p) {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return path.resolve(p);
}

/** Show a path with ~ for the home folder. @param {string} p */
export function tildify(p) {
  const home = os.homedir();
  return p === home ? '~' : p.startsWith(home + path.sep) ? '~' + p.slice(home.length) : p;
}

/**
 * The real path of something that may not exist yet: the real path of its nearest
 * existing ancestor plus the remaining segments. Throws if nothing can be resolved.
 * @param {string} p
 */
export function resolveSafe(p) {
  let current = path.resolve(p);
  /** @type {string[]} */
  const rest = [];
  for (;;) {
    try {
      const real = fs.realpathSync.native(current);
      return rest.length ? path.join(real, ...rest.reverse()) : real;
    } catch (e) {
      const code = /** @type {any} */ (e).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw e;
      const parent = path.dirname(current);
      if (parent === current) throw e;
      rest.push(path.basename(current));
      current = parent;
    }
  }
}

/** True when child is parent or sits under it, compared on whole segments. @param {string} child @param {string} parent */
export function isInside(child, parent) {
  if (child === parent) return true;
  const base = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child.startsWith(base);
}

/** The folder itself and every folder above it. @param {string} dir */
export function ancestors(dir) {
  const out = [];
  let current = dir;
  for (;;) {
    out.push(current);
    const parent = path.dirname(current);
    if (parent === current) return out;
    current = parent;
  }
}

const obsidianCache = new Map();
/** The nearest folder at or above p that holds .obsidian, or null. @param {string} p */
export function vaultRootAbove(p) {
  for (const dir of ancestors(p)) {
    let has = obsidianCache.get(dir);
    if (has === undefined) {
      has = fs.existsSync(path.join(dir, '.obsidian'));
      obsidianCache.set(dir, has);
    }
    if (has) return dir;
  }
  return null;
}

/** For tests: forget which folders hold .obsidian. */
export function clearPathCache() { obsidianCache.clear(); }
