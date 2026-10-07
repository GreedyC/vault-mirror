// @ts-check
// Packs a section's lines into pieces that fit the token budget. Never cuts inside a word
// unless one unbroken word is larger than a whole piece.

/** @typedef {{ text: string, line: number }} Unit */

/** @param {string[]} parts @param {string} glue @param {number} budget @param {(t: string) => number} count @param {(part: string) => string[]} splitMore */
function fill(parts, glue, budget, count, splitMore) {
  /** @type {string[]} */
  const out = [];
  let current = ''; let used = 0;
  const flush = () => { if (current) { out.push(current); current = ''; used = 0; } };
  for (const part of parts) {
    const n = count(part);
    if (n > budget) {
      flush();
      const smaller = splitMore(part);
      if (smaller.length <= 1) out.push(part); else out.push(...fill(smaller, smaller.glue || ' ', budget, count, (p) => splitMore(p)));
      continue;
    }
    if (used + n > budget) flush();
    current = current ? current + glue + part : part;
    used += n;
  }
  flush();
  return out;
}

/**
 * Split one over-long unit: at sentence ends, then at spaces, and only for a single
 * unbroken word larger than the budget, at punctuation and then by halves.
 * @param {string} text @param {number} budget @param {(t: string) => number} count
 * @returns {string[]}
 */
export function splitUnit(text, budget, count) {
  /** @type {(part: string) => any} */
  const more = (part) => {
    const sentences = part.split(/(?<=[.?!;])\s+/).filter(Boolean);
    if (sentences.length > 1) return Object.assign(sentences, { glue: ' ' });
    const words = part.split(/\s+/).filter(Boolean);
    if (words.length > 1) return Object.assign(words, { glue: ' ' });
    const bits = part.split(/(?<=[\p{P}\p{S}])|(?=[\p{P}\p{S}])/u).filter(Boolean);
    if (bits.length > 1) return Object.assign(bits, { glue: '' });
    const chars = Array.from(part);
    if (chars.length < 2) return [part];
    const mid = Math.ceil(chars.length / 2);
    return Object.assign([chars.slice(0, mid).join(''), chars.slice(mid).join('')], { glue: '' });
  };
  return fill([text], ' ', budget, count, more);
}

/**
 * @param {Unit[]} units
 * @param {(pieceIndex: number) => number} budgetFor  body budget for the nth piece of this section
 * @param {(t: string) => number} count
 * @returns {Unit[]} pieces, each a few lines joined by newlines, with the line its first unit came from
 */
export function pack(units, budgetFor, count) {
  /** @type {{ units: Unit[], sizes: number[] }[]} */
  const groups = [];
  /** @type {{ units: Unit[], sizes: number[] }} */
  let current = { units: [], sizes: [] }; let used = 0;
  const flush = () => { if (current.units.length) { groups.push(current); current = { units: [], sizes: [] }; used = 0; } };
  for (const unit of units) {
    const n = count(unit.text);
    if (n > budgetFor(groups.length + (current.units.length ? 1 : 0))) {
      flush();
      // Keep later pieces within the smallest budget this section can meet.
      const budget = Math.min(budgetFor(groups.length), budgetFor(groups.length + 1));
      for (const part of splitUnit(unit.text, budget, count)) groups.push({ units: [{ text: part, line: unit.line }], sizes: [count(part)] });
      continue;
    }
    if (used + n > budgetFor(groups.length)) flush();
    current.units.push(unit); current.sizes.push(n); used += n;
  }
  flush();
  // A tiny last piece carries little meaning of its own: share the lines of the last two pieces evenly.
  if (groups.length >= 2) {
    const a = groups[groups.length - 2]; const b = groups[groups.length - 1];
    const sum = (/** @type {number[]} */ xs) => xs.reduce((x, y) => x + y, 0);
    const budgetA = budgetFor(groups.length - 2); const budgetB = budgetFor(groups.length - 1);
    if (sum(b.sizes) < budgetB * 0.4 && a.units.length > 1) {
      const all = [...a.units, ...b.units]; const sizes = [...a.sizes, ...b.sizes]; const total = sum(sizes);
      let best = a.units.length; let bestGap = Infinity; let left = 0;
      for (let cut = 1; cut < all.length; cut++) {
        left += sizes[cut - 1];
        if (left > budgetA || total - left > budgetB) continue;
        const gap = Math.abs(left - (total - left));
        if (gap < bestGap) { bestGap = gap; best = cut; }
      }
      groups[groups.length - 2] = { units: all.slice(0, best), sizes: sizes.slice(0, best) };
      groups[groups.length - 1] = { units: all.slice(best), sizes: sizes.slice(best) };
    }
  }
  return groups.map((g) => ({ text: g.units.map((u) => u.text).join('\n'), line: g.units[0].line }));
}
