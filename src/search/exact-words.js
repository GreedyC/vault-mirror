// @ts-check
// The exact-words list: passages that hold the question's distinctive words, ranked with BM25 over
// the tool's own passage store. No model is involved. It is a second, separate list: its scores are
// never mixed into the ranking by meaning.
import { readQuestion, tokenise, hashToken, hasPhrase, passageFields } from '../words/tokens.js';
import { findWords, rankPassages } from '../words/bm25.js';

export const EXACT_WORDS_PER_WORDING = 3;
export const EXACT_WORDS_SHOWN = 3;
const MAX_WORDS = 255;   // distinct words across all wordings of one call
const MAX_CHECKED = 300; // passages read back per wording before giving up on a phrase

/**
 * @typedef {{ note: number, n: number, score: number, words: string[], wording: number, place: number }} ExactHit
 *   note = position of the note in the table; n = passage number in the note; place = rank within its wording, from 0
 */

/**
 * @param {import('../words/table.js').WordsTable} table
 * @param {(note: number) => { title?: string, passages: { trail?: string[], text: string }[] }} readNote   the saved record of a note
 * @param {string[]} queries   one or several wordings; each contributes
 * @param {{ perWording?: number }} [o]
 * @returns {ExactHit[]}   one passage per note, each wording's best first
 */
export function exactWordHits(table, readNote, queries, o = {}) {
  const perWording = o.perWording ?? EXACT_WORDS_PER_WORDING;
  const wordings = queries.map(readQuestion);
  /** @type {Map<string, number>} */
  const at = new Map();
  for (const w of wordings) for (const word of w.words) if (!at.has(word) && at.size < MAX_WORDS) at.set(word, at.size);
  if (!at.size || !table.passages) return [];
  const found = findWords(table, [...at.keys()].map(hashToken));

  const first = new Uint32Array(table.notes + 1);
  for (let i = 0; i < table.notes; i++) first[i + 1] = first[i] + table.notePassages[i];
  const noteOf = (/** @type {number} */ p) => { let lo = 0; let hi = table.notes - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (first[mid] <= p) lo = mid; else hi = mid - 1; } return lo; };
  /** @type {Map<number, ReturnType<typeof readNote>>} */
  const records = new Map();
  const record = (/** @type {number} */ note) => { let r = records.get(note); if (!r) { r = readNote(note); records.set(note, r); } return r; };
  const index = (/** @type {string[]} */ words) => /** @type {number[]} */ (words.map((w) => at.get(w)).filter((i) => i !== undefined));

  /** @type {ExactHit[]} */
  const all = [];
  wordings.forEach((w, wording) => {
    const mine = index(w.words);
    if (!mine.length) return;
    // A quoted phrase must be there in full: only passages that hold every word of every phrase are ranked.
    const required = index([...new Set(w.phrases.flat())]);
    const ranked = rankPassages(table, found, mine, required);
    const taken = new Set(); let checked = 0;
    for (const cand of ranked) {
      if (taken.size >= perWording || checked >= MAX_CHECKED) break;
      const note = noteOf(cand.passage);
      if (taken.has(note)) continue;
      const n = cand.passage - first[note];
      const rec = record(note);
      const passage = rec.passages[n];
      if (!passage) continue;
      checked++;
      // Read the passage itself: the table holds numbers, and the words it reports must really be there.
      const fields = passageFields(rec, passage).map(tokenise);
      const present = new Set(fields.flat());
      const words = w.words.filter((word) => present.has(word));
      if (!words.length) continue;
      if (!w.phrases.every((phrase) => fields.some((tokens) => hasPhrase(tokens, phrase)))) continue;
      all.push({ note, n, score: cand.score, words, wording, place: taken.size });
      taken.add(note);
    }
  });
  all.sort((a, b) => a.place - b.place || b.score - a.score || a.wording - b.wording);
  const seen = new Set();
  return all.filter((h) => (seen.has(h.note) ? false : (seen.add(h.note), true)));
}

/**
 * Leave out what the list by meaning already shows, and keep a short list.
 * @template {{ passage: string }} T
 * @param {T[]} hits @param {{ passage: string }[]} shown @param {number} [max]
 * @returns {T[]}
 */
export function notAlreadyShown(hits, shown, max = EXACT_WORDS_SHOWN) {
  const have = new Set(shown.map((r) => r.passage));
  return hits.filter((h) => !have.has(h.passage)).slice(0, max);
}
