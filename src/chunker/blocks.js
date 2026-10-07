// @ts-check
// One pass over a note's lines: find code fences, then headings, then sections.

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)\s*$/;

/**
 * @typedef {{ t: string, line: number, code: boolean }} Line
 * @typedef {{ heads: string[], lines: Line[], line: number }} Section
 */

/** @param {string} line @param {string} ch @param {number} len @param {boolean} strict */
function closes(line, ch, len, strict) {
  const m = /^ {0,3}(`+|~+)(.*)$/.exec(line);
  if (!m || m[1][0] !== ch || m[1].length < len) return false;
  return strict ? m[2].trim() === '' : true;
}

/**
 * @param {string[]} lines
 * @param {number} start        index of the first body line
 * @param {string[]} dropFences languages whose fenced blocks are left out whole
 * @returns {{ sections: Section[], recoveredFromLine: number }}  lines after recoveredFromLine sit below a fence that never closed
 */
export function parseBlocks(lines, start, dropFences) {
  /** @type {('text' | 'code' | 'skip')[]} */
  const kind = new Array(lines.length).fill('text');
  let recoveredFrom = Infinity;
  for (let i = start; i < lines.length;) {
    const m = FENCE_OPEN.exec(lines[i]);
    if (!m || (m[1][0] === '`' && m[2].includes('`'))) { i++; continue; }
    const ch = m[1][0]; const len = m[1].length;
    let close = -1; let recovered = false;
    for (let j = i + 1; j < lines.length; j++) if (closes(lines[j], ch, len, true)) { close = j; break; }
    if (close < 0) {
      // Unclosed at end of file: accept the first later line that starts with the marker, even with text after it.
      for (let j = i + 1; j < lines.length; j++) if (closes(lines[j], ch, len, false)) { close = j; recovered = true; break; }
      if (close < 0) { i++; continue; } // no close at all: the opening line is plain text
    }
    const lang = m[2].trim().split(/[\s{,]+/)[0].toLowerCase();
    const drop = dropFences.includes(lang);
    kind[i] = 'skip'; kind[close] = 'skip';
    for (let j = i + 1; j < close; j++) kind[j] = drop ? 'skip' : 'code';
    if (recovered) recoveredFrom = Math.min(recoveredFrom, close + 1);
    i = close + 1;
  }

  /** @type {Section[]} */
  const sections = [];
  /** @type {{ level: number, text: string }[]} */
  const stack = [];
  /** @type {Section} */
  let current = { heads: [], lines: [], line: start + 1 };
  for (let i = start; i < lines.length; i++) {
    if (kind[i] === 'skip') continue;
    const h = kind[i] === 'text' ? HEADING.exec(lines[i]) : null;
    if (h) {
      sections.push(current);
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: h[2].replace(/\s+#+\s*$/, '').trim() });
      current = { heads: stack.map((s) => s.text), lines: [], line: i + 1 };
    } else {
      current.lines.push({ t: lines[i], line: i + 1, code: kind[i] === 'code' });
    }
  }
  sections.push(current);
  return { sections, recoveredFromLine: recoveredFrom };
}
