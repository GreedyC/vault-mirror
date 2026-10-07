// @ts-check
// The sidecar: passages.jsonl (one record per synced note) and vectors.f32 (raw Float32).
// It is the source of truth. Order of writes: vectors, then the log record, then the manifest.
import fs from 'node:fs';
import path from 'node:path';
import { openAppend, ensureDir, writeFile } from './safe-write.js';

export const LOG = 'passages.jsonl';
export const VECTORS = 'vectors.f32';

/**
 * @typedef {{ n: number, trail: string[], heads?: string[], rep?: boolean, line: number, text: string, vec: number, flags: string[], recovered?: boolean, spans?: [number, number][] }} StoredPassage
 * @typedef {{ v: 1, op: 'put', path: string, sha256: string, size: number, mtimeMs: number, fip: boolean, title: string, passages: StoredPassage[] }} PutRecord
 * @typedef {{ v: 1, op: 'del', path: string }} DelRecord
 */

/** Create an empty data folder with a header record. @param {string} dataDir @param {Record<string, any>} header @returns {number} bytes written */
export function createDataDir(dataDir, header) {
  ensureDir(dataDir);
  const line = JSON.stringify({ v: 1, op: 'header', ...header, createdAt: new Date().toISOString() }) + '\n';
  writeFile(path.join(dataDir, LOG), line);
  writeFile(path.join(dataDir, VECTORS), new Uint8Array(0));
  return Buffer.byteLength(line);
}

/**
 * Open the sidecar for appending.
 * @param {string} dataDir
 * @param {{ logBytes: number, vectors: number }} at   where the manifest says the files end
 * @param {number} dimensions
 */
export function openSidecar(dataDir, at, dimensions) {
  const log = openAppend(path.join(dataDir, LOG));
  const vectors = openAppend(path.join(dataDir, VECTORS));
  let logBytes = at.logBytes; let count = at.vectors;
  return {
    get logBytes() { return logBytes; },
    get vectors() { return count; },
    /**
     * Append a group of whole notes: vectors and fsync, then records and fsync.
     * @param {{ record: Omit<PutRecord, 'passages'> & { passages: Omit<StoredPassage, 'vec'>[] }, vectors: Float32Array[] }[]} notes
     * @returns {{ log: [number, number], vec: number }[]}
     */
    appendPuts(notes) {
      /** @type {Buffer[]} */
      const vecBufs = []; const lines = [];
      /** @type {{ log: [number, number], vec: number }[]} */
      const out = [];
      let offset = logBytes; let position = count;
      for (const note of notes) {
        const start = position;
        const passages = note.record.passages.map((p, i) => ({ ...p, vec: start + i }));
        for (const v of note.vectors) {
          if (v.length !== dimensions) throw new Error('vector of the wrong size reached the sidecar');
          vecBufs.push(Buffer.from(v.buffer, v.byteOffset, v.byteLength));
        }
        position += note.vectors.length;
        const line = Buffer.from(JSON.stringify({ ...note.record, passages }) + '\n');
        lines.push(line);
        out.push({ log: [offset, line.length], vec: start });
        offset += line.length;
      }
      if (vecBufs.length) { vectors.write(Buffer.concat(vecBufs)); vectors.sync(); }
      log.write(Buffer.concat(lines)); log.sync();
      logBytes = offset; count = position;
      return out;
    },
    /** Append delete records. @param {string[]} paths */
    appendDels(paths) {
      if (!paths.length) return;
      const buf = Buffer.from(paths.map((p) => JSON.stringify({ v: 1, op: 'del', path: p }) + '\n').join(''));
      log.write(buf); log.sync();
      logBytes += buf.length;
    },
    close() { log.close(); vectors.close(); },
  };
}

/** @param {string} file @param {number} offset @param {number} length */
export function readRange(file, offset, length) {
  const buf = Buffer.allocUnsafe(length);
  const fd = fs.openSync(file, 'r');
  try {
    let got = 0;
    while (got < length) {
      const n = fs.readSync(fd, buf, got, length - got, offset + got);
      if (n === 0) break;
      got += n;
    }
    return got === length ? buf : buf.subarray(0, got);
  } finally { fs.closeSync(fd); }
}

/** Read one note's record. @param {string} dataDir @param {[number, number]} at @returns {PutRecord} */
export function readRecord(dataDir, at) {
  return JSON.parse(readRange(path.join(dataDir, LOG), at[0], at[1]).toString('utf8'));
}

/**
 * Read the first `count` vectors as one Float32Array.
 * @param {string} dataDir @param {number} count @param {number} dimensions
 */
export function readVectors(dataDir, count, dimensions) {
  const bytes = count * 4 * dimensions;
  const buf = readRange(path.join(dataDir, VECTORS), 0, bytes);
  const copy = new Uint8Array(buf.length); copy.set(buf);
  return new Float32Array(copy.buffer, 0, Math.floor(buf.length / 4));
}

/**
 * Parse log records between two byte positions. Stops at the first line that is torn or does not parse.
 * @param {string} dataDir @param {number} from @param {number} [to]
 * @returns {{ records: { offset: number, length: number, rec: any }[], goodBytes: number, size: number }}
 */
export function scanLog(dataDir, from, to) {
  const file = path.join(dataDir, LOG);
  const size = fs.statSync(file).size;
  const end = Math.min(to ?? size, size);
  const records = [];
  let good = from;
  if (end > from) {
    const buf = readRange(file, from, end - from);
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(10, pos);
      if (nl < 0) break; // a torn last line
      try { records.push({ offset: from + pos, length: nl - pos + 1, rec: JSON.parse(buf.toString('utf8', pos, nl)) }); }
      catch { break; }
      pos = nl + 1;
      good = from + pos;
    }
  }
  return { records, goodBytes: good, size };
}
