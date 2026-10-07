// @ts-check
// The exact-words table on disk: one file in the index folder, a compact copy of what the passage
// store says. It is made at the end of a sync, brought in step by whoever finds it behind, and can
// always be made again from the saved passages. It is replaced whole, by one atomic rename.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, remove } from '../store/safe-write.js';
import { readRange, readRecord } from '../store/sidecar.js';
import { buildTable, encodeTable, decodeTable, decodeHead, noteKey } from './table.js';

export const WORDS_FILE = 'words.bin';

/** @param {string} indexDir */
const fileOf = (indexDir) => path.join(indexDir, WORDS_FILE);

/** Read the whole table, or null when there is none this version can use. @param {string} indexDir @returns {import('./table.js').WordsTable | null} */
export function readWords(indexDir) {
  const file = fileOf(indexDir);
  let size = 0;
  try { size = fs.statSync(file).size; } catch { return null; }
  try {
    const bytes = readRange(file, 0, size);
    const alone = new ArrayBuffer(bytes.length);
    new Uint8Array(alone).set(bytes);
    return decodeTable(alone);
  } catch { return null; }
}

/**
 * Does the saved table list exactly the notes of this manifest, each at its current content?
 * Reads the head and the note list only, never the words.
 * @param {string} indexDir @param {import('../store/manifest.js').Manifest} manifest
 * @returns {{ ok: boolean, passages: number, notes: number }}   the counts are the table's own
 */
export function checkWords(indexDir, manifest) {
  const none = { ok: false, passages: 0, notes: 0 };
  const file = fileOf(indexDir);
  try {
    const first = decodeHead(readRange(file, 0, 4104));
    if (!first) return none;
    const { head, at, need } = first;
    const counts = { passages: head.passages, notes: head.notes };
    const now = manifest.chunker;
    if (head.chunker.version !== now.version || head.chunker.settingsHash !== now.settingsHash) return { ok: false, ...counts };
    const names = Object.keys(manifest.notes);
    if (names.length !== head.notes || head.passages !== manifest.totals.passages) return { ok: false, ...counts };
    const list = readRange(file, at, need - at);
    if (list.length !== need - at) return { ok: false, ...counts };
    const N = head.notes;
    for (let i = 0; i < N; i++) {
      const e = manifest.notes[names[i]];
      if (list.readUInt32LE(N * 8 + i * 4) !== e.passages) return { ok: false, ...counts };
      if (!noteKey(names[i], e.sha256, e.passages, Boolean(e.folderInPrefix)).equals(list.subarray(i * 8, i * 8 + 8))) return { ok: false, ...counts };
    }
    return { ok: true, ...counts };
  } catch { return none; }
}

/**
 * Was the saved table made from this very manifest? Reads the head only. A sync that changed nothing
 * asks this, so it does not load the table to learn that there is nothing to do.
 * @param {string} indexDir @param {import('../store/manifest.js').Manifest} manifest
 */
export function wordsAtStamp(indexDir, manifest) {
  try {
    const first = decodeHead(readRange(fileOf(indexDir), 0, 4104));
    return Boolean(first) && first?.head.stamp === manifest.stamp && first?.head.passages === manifest.totals.passages && first?.head.notes === manifest.totals.notes
      && first?.head.chunker.version === manifest.chunker.version && first?.head.chunker.settingsHash === manifest.chunker.settingsHash;
  } catch { return false; }
}

/** True when a table read from disk lines up with this manifest, note for note. @param {import('./table.js').WordsTable} table @param {import('../store/manifest.js').Manifest} manifest */
function linesUp(table, manifest) {
  if (table.stamp !== manifest.stamp || table.passages !== manifest.totals.passages) return false;
  if (table.chunker.version !== manifest.chunker.version || table.chunker.settingsHash !== manifest.chunker.settingsHash) return false;
  let i = 0;
  for (const key in manifest.notes) { if (i >= table.notes || table.notePassages[i] !== manifest.notes[key].passages) return false; i++; }
  return i === table.notes;
}

/**
 * The table for this manifest, with its notes in the manifest's own order. A saved table made from the
 * same stamp is used as it is. Otherwise the notes it already covers are copied, the others are read
 * from the passage store, and (when `save` is set) the result replaces the file.
 * @param {string} indexDir
 * @param {{ manifest: import('../store/manifest.js').Manifest, dataDir: string }} loaded
 * @param {{ save?: boolean, fresh?: boolean }} [o]   fresh: copy nothing, read every note again
 * @returns {{ table: import('./table.js').WordsTable, how: 'used' | 'updated' | 'built', read: number }}
 */
export function wordsFor(indexDir, loaded, o = {}) {
  const { manifest, dataDir } = loaded;
  const old = o.fresh ? null : readWords(indexDir);
  if (old && linesUp(old, manifest)) return { table: old, how: 'used', read: 0 };
  const names = Object.keys(manifest.notes);
  const { table, reused, read } = buildTable({
    stamp: manifest.stamp, chunker: manifest.chunker, old,
    notes: names.map((p) => ({ path: p, sha256: manifest.notes[p].sha256, passages: manifest.notes[p].passages, folderInPrefix: Boolean(manifest.notes[p].folderInPrefix) })),
    readNote: (i) => readRecord(dataDir, manifest.notes[names[i]].log),
  });
  if (o.save) writeFileAtomic(fileOf(indexDir), encodeTable(table));
  return { table, how: reused ? 'updated' : 'built', read };
}

/** Remove the saved table (the notes are about to be read again from scratch). @param {string} indexDir */
export function dropWords(indexDir) { remove(fileOf(indexDir)); }
