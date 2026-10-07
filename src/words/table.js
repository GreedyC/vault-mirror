// @ts-check
// The exact-words table: for every passage, which words it holds and how often. It is a compact
// copy of what the passage store already says, kept so a search does not have to read every
// passage again. It holds numbers only (a 32-bit hash per word): no text, no note name.
import crypto from 'node:crypto';
import { TOKEN_RULES, tokenise, isDistinctive, hashToken, passageFields } from './tokens.js';

const MAGIC = 0x31574d56; // "VMW1"
export const TABLE_VERSION = 1;

/**
 * @typedef {object} WordsTable
 * @property {string} stamp                  the manifest stamp this table was made from
 * @property {{ version: number, settingsHash: string }} chunker
 * @property {number} notes
 * @property {number} passages
 * @property {number} sumLen                 words in all passages together (stop words left out)
 * @property {Uint8Array} keys               8 bytes per note: which note, and which version of it
 * @property {Uint32Array} notePassages      passages per note, in note order
 * @property {Uint32Array} docEnd            per passage: where its words end in termHash
 * @property {Uint16Array} docLen            per passage: how many words it has
 * @property {Uint32Array} termHash          the distinct words of each passage, one passage after another
 * @property {Uint8Array} termTf             how often each of those words appears in its passage
 */

/**
 * Eight bytes that change whenever the note's passages can change: its path, its content, how many
 * passages it has, and whether its folder is part of the prefix. That last flag flips when a second
 * note with the same file name appears or goes; the note is then cut again with a different budget,
 * so its passages can change while its content does not.
 * @param {string} notePath @param {string} sha256 @param {number} passages @param {boolean} [folderInPrefix]
 */
export function noteKey(notePath, sha256, passages, folderInPrefix = false) {
  return crypto.createHash('sha256').update(`${notePath}\0${sha256}\0${passages}\0${folderInPrefix ? 1 : 0}`).digest().subarray(0, 8);
}

/**
 * The words of one note's passages.
 * @param {{ title?: string, passages: { trail?: string[], text: string }[] }} record
 * @returns {{ docLen: number[], docTerms: number[], hash: number[], tf: number[] }}
 */
export function noteWords(record) {
  /** @type {number[]} */
  const docLen = []; const docTerms = []; const hash = []; const tf = [];
  for (const p of record.passages) {
    /** @type {Map<number, number>} */
    const counts = new Map();
    let len = 0;
    for (const field of passageFields(record, p)) {
      for (const token of tokenise(field)) {
        if (!isDistinctive(token)) continue;
        const h = hashToken(token);
        counts.set(h, (counts.get(h) || 0) + 1);
        len++;
      }
    }
    for (const [h, n] of counts) { hash.push(h); tf.push(Math.min(255, n)); }
    docLen.push(Math.min(65535, len));
    docTerms.push(counts.size);
  }
  return { docLen, docTerms, hash, tf };
}

/**
 * Make the table for a set of notes. A note whose key is already in `old` is copied from it;
 * every other note is read from the passage store through `readNote`.
 * @param {{ stamp: string, chunker: { version: number, settingsHash: string }, notes: { path: string, sha256: string, passages: number, folderInPrefix?: boolean }[], old?: WordsTable | null, readNote: (index: number) => { title?: string, passages: { trail?: string[], text: string }[] } }} o
 * @returns {{ table: WordsTable, reused: number, read: number }}
 */
export function buildTable(o) {
  const old = o.old && o.old.chunker.version === o.chunker.version && o.old.chunker.settingsHash === o.chunker.settingsHash ? o.old : null;
  /** @type {Map<string, number>} */
  const oldAt = new Map();
  /** @type {Uint32Array | null} */
  let oldFirst = null;
  if (old) {
    oldFirst = new Uint32Array(old.notes + 1);
    for (let i = 0; i < old.notes; i++) {
      oldAt.set(Buffer.from(old.keys.buffer, old.keys.byteOffset + i * 8, 8).toString('hex'), i);
      oldFirst[i + 1] = oldFirst[i] + old.notePassages[i];
    }
  }
  const N = o.notes.length;
  const keys = new Uint8Array(N * 8);
  const notePassages = new Uint32Array(N);
  /** @type {({ from: number } | ReturnType<typeof noteWords>)[]} */
  const parts = [];
  let P = 0; let T = 0; let reused = 0; let read = 0;
  for (let i = 0; i < N; i++) {
    const note = o.notes[i];
    const key = noteKey(note.path, note.sha256, note.passages, Boolean(note.folderInPrefix));
    keys.set(key, i * 8);
    notePassages[i] = note.passages;
    const at = old ? oldAt.get(key.toString('hex')) : undefined;
    if (old && oldFirst && at !== undefined && old.notePassages[at] === note.passages) {
      const p0 = oldFirst[at]; const p1 = oldFirst[at + 1];
      T += (p1 ? old.docEnd[p1 - 1] : 0) - (p0 ? old.docEnd[p0 - 1] : 0);
      parts.push({ from: at }); reused++;
    } else {
      const w = noteWords(o.readNote(i));
      if (w.docLen.length !== note.passages) throw new Error('a saved note does not hold the passages the manifest lists');
      T += w.hash.length;
      parts.push(w); read++;
    }
    P += note.passages;
  }
  const docEnd = new Uint32Array(P); const docLen = new Uint16Array(P);
  const termHash = new Uint32Array(T); const termTf = new Uint8Array(T);
  let p = 0; let t = 0; let sumLen = 0;
  for (const part of parts) {
    if ('from' in part) {
      const o2 = /** @type {WordsTable} */ (old); const first = /** @type {Uint32Array} */ (oldFirst);
      const p0 = first[part.from]; const p1 = first[part.from + 1];
      const t0 = p0 ? o2.docEnd[p0 - 1] : 0; const t1 = p1 ? o2.docEnd[p1 - 1] : 0;
      termHash.set(o2.termHash.subarray(t0, t1), t); termTf.set(o2.termTf.subarray(t0, t1), t);
      for (let k = p0; k < p1; k++, p++) { docEnd[p] = o2.docEnd[k] - t0 + t; docLen[p] = o2.docLen[k]; sumLen += o2.docLen[k]; }
      t += t1 - t0;
    } else {
      termHash.set(part.hash, t); termTf.set(part.tf, t);
      for (let k = 0; k < part.docLen.length; k++, p++) { t += part.docTerms[k]; docEnd[p] = t; docLen[p] = part.docLen[k]; sumLen += part.docLen[k]; }
    }
  }
  return { table: { stamp: o.stamp, chunker: { version: o.chunker.version, settingsHash: o.chunker.settingsHash }, notes: N, passages: P, sumLen, keys, notePassages, docEnd, docLen, termHash, termTf }, reused, read };
}

/** True when two tables say the same thing about the same notes. @param {WordsTable} a @param {WordsTable} b */
export function sameWords(a, b) {
  const bytes = (/** @type {ArrayBufferView} */ x) => Buffer.from(x.buffer, x.byteOffset, x.byteLength);
  return a.notes === b.notes && a.passages === b.passages && a.sumLen === b.sumLen
    && /** @type {const} */ (['keys', 'notePassages', 'docEnd', 'docLen', 'termHash', 'termTf']).every((k) => bytes(a[k]).equals(bytes(b[k])));
}

const pad4 = (/** @type {number} */ n) => (n + 3) & ~3;

/** The table as the bytes of its file. @param {WordsTable} table @returns {Uint8Array} */
export function encodeTable(table) {
  const head = Buffer.from(JSON.stringify({ v: TABLE_VERSION, rules: TOKEN_RULES, chunker: table.chunker, stamp: table.stamp, notes: table.notes, passages: table.passages, terms: table.termHash.length, sumLen: table.sumLen }));
  const headLen = pad4(head.length);
  const N = table.notes; const P = table.passages; const T = table.termHash.length;
  const size = 8 + headLen + N * 8 + N * 4 + P * 4 + T * 4 + pad4(P * 2) + T;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true); view.setUint32(4, headLen, true);
  out.fill(32, 8, 8 + headLen); out.set(head, 8);
  let at = 8 + headLen;
  const put = (/** @type {ArrayBufferView} */ a) => { out.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), at); at += pad4(a.byteLength); };
  put(table.keys); put(table.notePassages); put(table.docEnd); put(table.termHash); put(table.docLen); put(table.termTf);
  return out;
}

/**
 * The head of a table file: enough to say which notes it covers, without the words.
 * @param {Uint8Array} bytes   the first bytes of the file (see headBytes)
 * @returns {{ head: { stamp: string, chunker: { version: number, settingsHash: string }, notes: number, passages: number, terms: number, sumLen: number }, at: number, need: number } | null}
 *   `at` is where the note list starts; `need` is how many bytes the head and the note list take
 */
export function decodeHead(bytes) {
  try {
    if (bytes.length < 8) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== MAGIC) return null;
    const headLen = view.getUint32(4, true);
    if (headLen > 4096 || bytes.length < 8 + headLen) return null;
    const head = JSON.parse(Buffer.from(bytes.buffer, bytes.byteOffset + 8, headLen).toString('utf8'));
    if (head.v !== TABLE_VERSION || head.rules !== TOKEN_RULES) return null;
    for (const k of ['notes', 'passages', 'terms', 'sumLen']) if (!Number.isInteger(head[k]) || head[k] < 0) return null;
    return { head, at: 8 + headLen, need: 8 + headLen + head.notes * 12 };
  } catch { return null; }
}

/**
 * Read a whole table file. Null when the bytes are not a table this version can use.
 * @param {ArrayBuffer} buffer   the file, alone in its own buffer
 * @returns {WordsTable | null}
 */
export function decodeTable(buffer) {
  const h = decodeHead(new Uint8Array(buffer));
  if (!h) return null;
  const { notes: N, passages: P, terms: T } = h.head;
  if (buffer.byteLength !== h.at + N * 12 + P * 4 + T * 4 + pad4(P * 2) + T) return null;
  let at = h.at;
  const keys = new Uint8Array(buffer, at, N * 8); at += N * 8;
  const notePassages = new Uint32Array(buffer, at, N); at += N * 4;
  const docEnd = new Uint32Array(buffer, at, P); at += P * 4;
  const termHash = new Uint32Array(buffer, at, T); at += T * 4;
  const docLen = new Uint16Array(buffer, at, P); at += pad4(P * 2);
  const termTf = new Uint8Array(buffer, at, T);
  if (P && docEnd[P - 1] !== T) return null;
  return { stamp: h.head.stamp, chunker: h.head.chunker, notes: N, passages: P, sumLen: h.head.sumLen, keys, notePassages, docEnd, docLen, termHash, termTf };
}
