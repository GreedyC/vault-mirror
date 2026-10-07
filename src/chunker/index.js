// @ts-check
// The chunker: a pure function from a note's bytes to its passages.
// Same bytes, path and settings always give the same passages. It never loads a model:
// the token counter and the budget arrive in settings.
import { readFrontmatter } from './frontmatter.js';
import { parseBlocks } from './blocks.js';
import { cleanLine, cleanInline, stripComments } from './clean.js';
import { pack } from './pack.js';

export const PREFIX_CAP_TOKENS = 28;
export const ALIAS_CAP_TOKENS = 12;

/**
 * @typedef {object} ChunkSettings
 * @property {(text: string) => number} countTokens
 * @property {number} budgetTokens
 * @property {number} minWords
 * @property {string[]} dropFences
 * @property {boolean} folderInPrefix
 *
 * @typedef {object} Passage
 * @property {number} n          passage number, from 0, no gaps
 * @property {string[]} trail    heading trail under the title, cleaned
 * @property {string[]} heads    the heading chain as written, for links
 * @property {boolean} headRepeats  the deepest heading appears more than once in the note
 * @property {number} line       1-based line in the file where the passage starts
 * @property {string} text       the stored body
 * @property {string} embedText  prefix, a newline, the body
 * @property {boolean} recovered found below a fence that never closed
 *
 * @typedef {{ title: string, aliases: string[], tags: string[], indexable: boolean, passages: Passage[] }} Chunked
 */

/** Keep whole words from the start while the count fits. @param {string} text @param {number} max @param {(t: string) => number} count */
function cutToTokens(text, max, count) {
  if (count(text) <= max) return text;
  const words = text.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (count(next) > max) break;
    out = next;
  }
  if (out) return out;
  let chars = Array.from(words[0]);
  while (chars.length > 1 && count(chars.join('')) > max) chars = chars.slice(0, Math.ceil(chars.length / 2));
  return chars.join('');
}

/**
 * @param {{ folder: string | null, title: string, alias: string, trail: string[] }} p
 * @param {(t: string) => number} count
 */
export function buildPrefix(p, count) {
  const join = (/** @type {(string | null)[]} */ parts) => parts.filter(Boolean).join(' > ');
  const deepest = p.trail.length ? p.trail[p.trail.length - 1] : null;
  /** @type {(string | null)[]} */
  let parts = [p.folder, p.title, ...p.trail];
  if (count(join(parts)) > PREFIX_CAP_TOKENS) parts = [p.folder, p.title, deepest];
  if (count(join(parts)) > PREFIX_CAP_TOKENS) parts = [null, p.title, deepest];
  if (count(join(parts)) > PREFIX_CAP_TOKENS) parts = [null, cutToTokens(p.title, 16, count), deepest ? cutToTokens(deepest, 10, count) : null];
  // The first passage of a note also carries its aliases, so a search for another name finds it.
  if (p.alias) parts[1] = `${parts[1]} ${p.alias}`;
  return join(parts);
}

/** @param {string[]} aliases @param {(t: string) => number} count */
function aliasPart(aliases, count) {
  if (!aliases.length) return '';
  let inner = '';
  for (const a of aliases) {
    const next = inner ? `${inner}, ${a}` : a;
    if (count(`(also: ${next})`) > ALIAS_CAP_TOKENS) break;
    inner = next;
  }
  return inner ? `(also: ${inner})` : '';
}

/**
 * @param {Uint8Array} noteBytes
 * @param {string} vaultPath   vault-relative path with forward slashes
 * @param {ChunkSettings} settings
 * @returns {Chunked}
 */
export function chunk(noteBytes, vaultPath, settings) {
  const count = settings.countTokens;
  let text = new TextDecoder('utf-8', { fatal: false }).decode(noteBytes); // strips a byte-order mark, replaces bad bytes
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const segments = vaultPath.split('/');
  const title = (segments[segments.length - 1] || '').replace(/\.md$/i, '');
  const folder = settings.folderInPrefix && segments.length > 1 ? segments[segments.length - 2] : null;

  const fm = readFrontmatter(lines);
  if (fm.indexOff) return { title, aliases: fm.aliases, tags: fm.tags, indexable: false, passages: [] };

  const { sections, recoveredFromLine } = parseBlocks(lines, fm.bodyStart, settings.dropFences);
  /** @type {Map<string, number>} */
  const headCounts = new Map();
  for (const s of sections) if (s.heads.length) {
    const key = s.heads[s.heads.length - 1].trim().toLowerCase();
    headCounts.set(key, (headCounts.get(key) || 0) + 1);
  }
  const alias = aliasPart(fm.aliases.filter((a) => a.toLowerCase() !== title.toLowerCase() && !a.includes('/')), count);

  /** @type {Passage[]} */
  const passages = [];
  for (const section of sections) {
    /** @type {import('./pack.js').Unit[]} */
    const units = [];
    for (const l of stripComments(section.lines)) {
      const cleaned = l.code ? (l.t.trim() ? l.t.trimEnd() : null) : cleanLine(l.t);
      if (cleaned) units.push({ text: cleaned, line: l.line });
    }
    const words = units.reduce((n, u) => n + u.text.split(/\s+/).filter(Boolean).length, 0);
    if (words < settings.minWords) continue;

    let trail = section.heads.map((h) => cleanInline(h).replace(/\s+/g, ' ').trim()).filter(Boolean);
    if (trail.length && trail[0].toLowerCase() === title.toLowerCase()) trail = trail.slice(1);
    const plainPrefix = buildPrefix({ folder, title, alias: '', trail }, count);
    const firstPrefix = alias ? buildPrefix({ folder, title, alias, trail }, count) : plainPrefix;
    const plainBudget = Math.max(8, settings.budgetTokens - count(plainPrefix));
    const firstBudget = Math.max(8, settings.budgetTokens - count(firstPrefix));
    const noteIsEmpty = passages.length === 0;
    const pieces = pack(units, (i) => (noteIsEmpty && i === 0 ? firstBudget : plainBudget), count);
    const deepest = section.heads.length ? section.heads[section.heads.length - 1].trim().toLowerCase() : '';
    pieces.forEach((piece, i) => {
      const prefix = noteIsEmpty && i === 0 ? firstPrefix : plainPrefix;
      passages.push({
        n: passages.length,
        trail,
        heads: section.heads,
        headRepeats: section.heads.length > 0 && (headCounts.get(deepest) || 0) > 1,
        line: piece.line,
        text: piece.text,
        embedText: `${prefix}\n${piece.text}`,
        recovered: piece.line > recoveredFromLine,
      });
    });
  }
  return { title, aliases: fm.aliases, tags: fm.tags, indexable: true, passages };
}
