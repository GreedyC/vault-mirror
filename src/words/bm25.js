// @ts-check
// BM25 over the exact-words table. No model is involved: a passage scores by which of the
// question's distinctive words it holds, how rare each word is, and how short the passage is.
const K1 = 1.2;
const B = 0.75;

/**
 * One pass over the table for every word any wording asks for.
 * @param {import('./table.js').WordsTable} table
 * @param {number[]} hashes   distinct word hashes
 * @returns {{ df: Uint32Array, count: number, passage: Uint32Array, word: Uint8Array, tf: Uint8Array }}
 *   df[i] = passages that hold hashes[i]; then one entry per (passage, word) found
 */
export function findWords(table, hashes) {
  const want = new Map(hashes.map((h, i) => [h, i]));
  const low = new Uint8Array(65536);
  for (const h of hashes) low[h & 0xffff] = 1;
  const df = new Uint32Array(hashes.length);
  let cap = 4096; let count = 0;
  let passage = new Uint32Array(cap); let word = new Uint8Array(cap); let tf = new Uint8Array(cap);
  const { termHash, termTf, docEnd } = table;
  let t = 0;
  for (let p = 0; p < table.passages; p++) {
    const end = docEnd[p];
    for (; t < end; t++) {
      const h = termHash[t];
      if (low[h & 0xffff] === 0) continue;
      const i = want.get(h);
      if (i === undefined) continue;
      if (count === cap) {
        cap *= 2;
        const a = new Uint32Array(cap); a.set(passage); passage = a;
        const b = new Uint8Array(cap); b.set(word); word = b;
        const c = new Uint8Array(cap); c.set(tf); tf = c;
      }
      passage[count] = p; word[count] = i; tf[count] = termTf[t]; df[i]++; count++;
    }
  }
  return { df, count, passage, word, tf };
}

/** How much a word is worth: rare words count for more. @param {number} total @param {number} df */
export function idf(total, df) { return Math.log(1 + (total - df + 0.5) / (df + 0.5)); }

/** One word's share of a passage's score. @param {number} weight @param {number} tf @param {number} len @param {number} avgLen */
export function termScore(weight, tf, len, avgLen) {
  return weight * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (len / (avgLen || 1))));
}

/**
 * Rank the passages for one wording.
 * @param {import('./table.js').WordsTable} table
 * @param {ReturnType<typeof findWords>} found
 * @param {number[]} words   positions in the hash list given to findWords: this wording's words
 * @param {number[]} [required]   positions of words a passage must hold to be ranked at all (the words of quoted phrases)
 * @returns {{ passage: number, score: number }[]}   best first; ties go to the earlier passage
 */
export function rankPassages(table, found, words, required = []) {
  const weight = new Float64Array(found.df.length);
  const mine = new Uint8Array(found.df.length);
  for (const i of words) { mine[i] = 1; weight[i] = idf(table.passages, found.df[i]); }
  const avgLen = table.passages ? table.sumLen / table.passages : 0;
  /** @type {{ passage: number, score: number }[]} */
  const out = [];
  const must = new Uint8Array(found.df.length);
  for (const i of required) must[i] = 1;
  let current = -1; let score = 0; let held = 0;
  const push = () => { if (current >= 0 && held === required.length) out.push({ passage: current, score }); };
  for (let k = 0; k < found.count; k++) {
    const i = found.word[k];
    if (!mine[i]) continue;
    const p = found.passage[k];
    if (p !== current) { push(); current = p; score = 0; held = 0; }
    score += termScore(weight[i], found.tf[k], table.docLen[p], avgLen);
    held += must[i];
  }
  push();
  return out.sort((a, b) => b.score - a.score || a.passage - b.passage);
}
