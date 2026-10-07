// @ts-check
// The token rules of the exact-words list. The same rules read a question and a passage:
// lower-case, runs of letters and digits, no stemming. Nothing here knows about files.

/** Goes up when the rules below change, so a saved table made with other rules is rebuilt. */
export const TOKEN_RULES = 1;

/** Words too common to tell one passage from another. They still count inside a quoted phrase. */
export const STOP_WORDS = new Set((
  'a about above after again all also am an and any are aren as at be because been before being below between both but by '
  + 'can cannot could couldn did didn do does doesn doing don down during each few for from further get had hadn has hasn '
  + 'have haven having he her here hers him his how i if in into is isn it its just ll me more most my no nor not now of off '
  + 'on once only or other our out over own re same shan she should shouldn so some such than that the their them then there '
  + 'these they this those through to too under until up ve very was wasn we were weren what when where which while who whom '
  + 'why will with won would wouldn you your yours').split(' '));

const MAX_TOKEN = 64; // longer runs are keys, hashes and encoded blobs, never a word someone asks for
const ASCII_WORD = new Uint8Array(128);
for (let c = 48; c <= 57; c++) ASCII_WORD[c] = 1;
for (let c = 97; c <= 122; c++) ASCII_WORD[c] = 1;
const OTHER_WORD = /[\p{L}\p{N}\p{M}]/u;

/**
 * Every token of a text, in order, stop words included (a phrase needs them).
 * A token is a run of letters and digits, lower-cased. Anything else ends a token, so
 * "garden's" gives "garden" and "s", and "plan-b2" gives "plan" and "b2".
 * @param {string} text
 * @returns {string[]}
 */
export function tokenise(text) {
  /** @type {string[]} */
  const out = [];
  const s = text.toLowerCase();
  const end = s.length;
  let start = -1;
  for (let i = 0; i <= end; i++) {
    let word = false; let width = 1;
    if (i < end) {
      const c = s.charCodeAt(i);
      if (c < 128) word = ASCII_WORD[c] === 1;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) { width = 2; word = OTHER_WORD.test(s.slice(i, i + 2)); }
      else word = OTHER_WORD.test(s[i]);
    }
    if (word) { if (start < 0) start = i; } else if (start >= 0) { if (i - start <= MAX_TOKEN) out.push(s.slice(start, i)); start = -1; }
    i += width - 1;
  }
  return out;
}

/** A word worth looking for: not a stop word, and not a single letter. @param {string} token */
export function isDistinctive(token) {
  if (STOP_WORDS.has(token)) return false;
  if (token.length === 1) { const c = token.charCodeAt(0); if (c >= 97 && c <= 122) return false; }
  return true;
}

/** 32-bit FNV-1a of a token. The saved table holds these numbers, never the words. @param {string} token */
export function hashToken(token) {
  let h = 0x811c9dc5;
  for (let i = 0; i < token.length; i++) { h ^= token.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Read one wording of a question: its distinctive words (each once, in order of first use) and its
 * quoted phrases. A phrase is the text between a pair of double quotes, straight or curly, and needs
 * at least one distinctive word. The words of a phrase are also plain words of the question.
 * @param {string} question
 * @returns {{ words: string[], phrases: string[][] }}
 */
export function readQuestion(question) {
  /** @type {string[][]} */
  const phrases = [];
  for (const m of question.matchAll(/["“]([^"“”]+)["”]/g)) {
    const tokens = tokenise(m[1]);
    if (tokens.some(isDistinctive)) phrases.push(tokens);
  }
  const words = [...new Set(tokenise(question).filter(isDistinctive))];
  return { words, phrases };
}

/** True when `phrase` appears in `tokens` as neighbours, in order. @param {string[]} tokens @param {string[]} phrase */
export function hasPhrase(tokens, phrase) {
  const first = phrase[0];
  outer: for (let i = tokens.indexOf(first); i >= 0 && i + phrase.length <= tokens.length; i = tokens.indexOf(first, i + 1)) {
    for (let k = 1; k < phrase.length; k++) if (tokens[i + k] !== phrase[k]) continue outer;
    return true;
  }
  return false;
}

/**
 * The parts of a stored passage that are searched for exact words. Each part is read on its own,
 * so a phrase never runs from a heading into the text below it.
 * @param {{ title?: string }} record @param {{ trail?: string[], text: string }} passage
 * @returns {string[]}
 */
export function passageFields(record, passage) {
  return [record.title || '', ...(passage.trail || []), passage.text];
}
