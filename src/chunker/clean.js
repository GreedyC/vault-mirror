// @ts-check
// Turns Markdown and Obsidian syntax into the plain words a reader would see.

/** @param {string} inner @param {boolean} isEmbed */
function flattenWiki(inner, isEmbed) {
  const s = inner.replace(/\\\|/g, '|');
  if (isEmbed) {
    const base = (s.split('|')[0].split('#')[0].split('/').pop() || '').trim();
    if (/\.[A-Za-z0-9]{1,5}$/.test(base) && !/\.md$/i.test(base)) return ''; // an image or other file
    return base.replace(/\.md$/i, '');
  }
  const spaced = s.indexOf(' | ');
  if (spaced >= 0) return `${s.slice(0, spaced).trim()} ${s.slice(spaced + 3).trim()}`; // a file name may contain " | "
  const pipe = s.indexOf('|');
  if (pipe >= 0) return s.slice(pipe + 1).trim();
  const hash = s.indexOf('#');
  const note = ((hash >= 0 ? s.slice(0, hash) : s).split('/').pop() || '').trim();
  const frag = hash >= 0 ? s.slice(hash + 1).split('#').filter((f) => f && !f.startsWith('^')).map((f) => f.trim()).join(' > ') : '';
  if (!note) return frag;
  return frag ? `${note} > ${frag}` : note;
}

/** @param {string} url */
function host(url) {
  try { return new URL(url).hostname; } catch { return ''; }
}

/**
 * Clean inline syntax in one piece of text (a line, a heading, a table cell).
 * @param {string} text
 */
export function cleanInline(text) {
  let s = text;
  s = s.replace(/!\[\[([^\]]*)\]\]/g, (_, inner) => flattenWiki(inner, true));
  s = s.replace(/\[\[([^\]]*)\]\]/g, (_, inner) => flattenWiki(inner, false));
  s = s.replace(/!?\[([^\]]*)\]\((?:[^()\s]|\([^()\s]*\))*(?:\s+"[^"]*")?\)/g, '$1');
  s = s.replace(/<(https?:\/\/[^>\s]+)>/g, (_, u) => host(u));
  s = s.replace(/\bhttps?:\/\/[^\s<>)\]]+/g, (u) => host(u));
  s = s.replace(/<\/?[a-zA-Z][a-zA-Z0-9-]*(\s[^<>]*)?\/?>/g, '');
  s = s.replace(/\[\^[^\]\s]+\]/g, '');
  s = s.replace(/\*\*|==|~~|`/g, '');
  return s;
}

/**
 * Clean one text line of a note. Returns null when the line carries nothing (a table
 * separator, a horizontal rule, a blank line).
 * @param {string} raw
 * @returns {string | null}
 */
export function cleanLine(raw) {
  let s = raw;
  s = s.replace(/^\s*(?:>\s?)+/, '').replace(/^\[![^\]]+\][+-]?\s*/, ''); // quote markers and callout labels
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(s)) return null; // horizontal rule
  if (s.includes('|') && /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(s)) return null; // table separator row
  s = s.replace(/^(\s*(?:[-*+]|\d+[.)])\s)\[[ xX]\]\s/, '$1');
  s = s.replace(/\s\^[A-Za-z0-9-]+\s*$/, '');
  s = cleanInline(s);
  if (/^\s*\|/.test(s)) s = s.split('|').map((c) => c.trim()).filter(Boolean).join('; ');
  s = s.replace(/[ \t]+/g, ' ').trim();
  return s || null;
}

/**
 * Remove balanced %%comment%% and HTML comment pairs from a section's lines, outside code only.
 * An unpaired marker is left as text and removes nothing. Lines keep their numbers.
 * @param {import('./blocks.js').Line[]} lines
 * @returns {import('./blocks.js').Line[]}
 */
export function stripComments(lines) {
  let out = lines;
  for (const [open, close] of [['%%', '%%'], ['<!--', '-->']]) {
    /** @type {{ i: number, at: number, kind: 'open' | 'close' }[]} */
    const marks = [];
    out.forEach((l, i) => {
      if (l.code) return;
      let inTick = false;
      for (let c = 0; c < l.t.length; c++) {
        if (l.t[c] === '`') { inTick = !inTick; continue; }
        if (inTick) continue;
        if (l.t.startsWith(open, c)) { marks.push({ i, at: c, kind: 'open' }); c += open.length - 1; }
        else if (open !== close && l.t.startsWith(close, c)) { marks.push({ i, at: c, kind: 'close' }); c += close.length - 1; }
      }
    });
    /** @type {[typeof marks[0], typeof marks[0]][]} */
    const pairs = [];
    if (open === close) { for (let k = 0; k + 1 < marks.length; k += 2) pairs.push([marks[k], marks[k + 1]]); }
    else {
      for (let k = 0; k < marks.length; k++) {
        if (marks[k].kind !== 'open') continue;
        const end = marks.findIndex((m, idx) => idx > k && m.kind === 'close');
        if (end < 0) break;
        pairs.push([marks[k], marks[end]]); k = end;
      }
    }
    if (!pairs.length) continue;
    const copy = out.map((l) => ({ ...l }));
    for (const [a, b] of pairs.reverse()) {
      if (a.i === b.i) copy[a.i].t = copy[a.i].t.slice(0, a.at) + copy[a.i].t.slice(b.at + close.length);
      else {
        copy[b.i].t = copy[b.i].t.slice(b.at + close.length);
        for (let i = a.i + 1; i < b.i; i++) { copy[i].t = ''; copy[i].code = false; }
        copy[a.i].t = copy[a.i].t.slice(0, a.at);
      }
    }
    out = copy;
  }
  return out;
}
