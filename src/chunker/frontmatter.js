// @ts-check
// A tiny reader for the properties block at the top of a note. No YAML library:
// real vaults hold frontmatter that strict parsers reject, and this reader cannot fail.

const INDEX_OFF = /^index\s*:\s*["']?(false|no|off|0)["']?\s*$/i;
const KEY_LINE = /^[A-Za-z_][\w .\-/]{0,40}:(\s.*)?$/;

/** @param {string} line */
function looksLikeYaml(line) {
  if (!line.trim()) return true;
  return KEY_LINE.test(line) || /^\s*-(\s|$)/.test(line) || /^\s+\S/.test(line) || /^\s*#/.test(line) || line.trim() === '...';
}

/** @param {string} raw */
function scalar(raw) {
  let s = raw.trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1);
  const link = /^\[\[([^\]]*)\]\]$/.exec(s);
  if (link) s = link[1].split('|').pop() || '';
  return s.trim();
}

/** @param {string} value @returns {string[]} */
function inlineList(value) {
  const v = value.trim();
  if (!v) return [];
  if (v.startsWith('[') && v.endsWith(']') && !v.startsWith('[[')) return v.slice(1, -1).split(',').map(scalar).filter(Boolean);
  return [scalar(v)].filter(Boolean);
}

/**
 * @param {string[]} lines  the note's lines (LF only, no byte-order mark)
 * @returns {{ bodyStart: number, indexOff: boolean, aliases: string[], tags: string[] }}
 */
export function readFrontmatter(lines) {
  const none = { bodyStart: 0, indexOff: false, aliases: [], tags: [] };
  if (lines.length === 0 || lines[0].trimEnd() !== '---') return none;
  let end = -1;
  for (let i = 1; i < lines.length; i++) if (lines[i].trimEnd() === '---') { end = i; break; }
  if (end < 0) return none; // it never ends, so there is no frontmatter
  const block = lines.slice(1, end);
  // Fails closed: any candidate block with such a line leaves the note out, YAML-like or not.
  const indexOff = block.some((l) => INDEX_OFF.test(l.trimEnd()));
  if (!block.every(looksLikeYaml)) return { ...none, indexOff }; // line 1 was a horizontal rule
  /** @type {Record<string, string[]>} */
  const lists = { aliases: [], tags: [] };
  for (let i = 0; i < block.length; i++) {
    const m = /^(aliases|alias|tags|tag)\s*:(.*)$/i.exec(block[i]);
    if (!m) continue;
    const key = m[1].toLowerCase().startsWith('alias') ? 'aliases' : 'tags';
    lists[key].push(...inlineList(m[2]));
    for (let j = i + 1; j < block.length && /^\s*-(\s|$)/.test(block[j]); j++) {
      const item = scalar(block[j].replace(/^\s*-\s?/, ''));
      if (item) lists[key].push(item);
    }
  }
  return { bodyStart: end + 1, indexOff, aliases: lists.aliases, tags: lists.tags };
}
