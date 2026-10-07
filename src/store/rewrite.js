// @ts-check
// The tidy rewrite: no old text is kept. After any sync that replaced or removed a note,
// a fresh data folder is written with only the live records, and CURRENT switches to it
// with one atomic rename. A crash before the rename leaves the old folder intact.
import fs from 'node:fs';
import path from 'node:path';
import { createDataDir, LOG, VECTORS } from './sidecar.js';
import { openAppend, writeFileAtomic, remove } from './safe-write.js';
import { nextDataName, switchCurrent, retotal } from './manifest.js';

/**
 * @param {string} indexDir
 * @param {string} dataName
 * @param {import('./manifest.js').Manifest} manifest
 * @param {number} dimensions
 * @param {{ beforeSwitch?: () => void, afterSwitch?: () => void }} [hooks]  for tests that simulate a crash
 * @returns {{ dataName: string, dataDir: string, manifest: import('./manifest.js').Manifest }}
 */
export function tidyRewrite(indexDir, dataName, manifest, dimensions, hooks = {}) {
  const oldDir = path.join(indexDir, dataName);
  const newName = nextDataName(dataName);
  const newDir = path.join(indexDir, newName);
  remove(newDir); // an orphan from an earlier crash
  let logBytes = createDataDir(newDir, { embedding: manifest.embedding, chunker: manifest.chunker });
  const oldLog = fs.readFileSync(path.join(oldDir, LOG));
  const oldVec = fs.readFileSync(path.join(oldDir, VECTORS));
  const stride = 4 * dimensions;
  /** @type {Buffer[]} */
  const lines = []; const vecs = [];
  /** @type {import('./manifest.js').Manifest} */
  const next = { ...manifest, notes: {}, sidecar: { logBytes: 0, vectors: 0, deadRecords: 0 } };
  let position = 0;
  for (const key of Object.keys(manifest.notes)) {
    const entry = manifest.notes[key];
    const rec = JSON.parse(oldLog.toString('utf8', entry.log[0], entry.log[0] + entry.log[1]));
    rec.passages.forEach((/** @type {any} */ p, /** @type {number} */ i) => { p.vec = position + i; });
    const line = Buffer.from(JSON.stringify(rec) + '\n');
    lines.push(line);
    vecs.push(oldVec.subarray(entry.vec * stride, (entry.vec + entry.passages) * stride));
    next.notes[key] = { ...entry, log: [logBytes, line.length], vec: position };
    logBytes += line.length;
    position += entry.passages;
  }
  const log = openAppend(path.join(newDir, LOG));
  try { if (lines.length) log.write(Buffer.concat(lines)); log.sync(); } finally { log.close(); }
  const vectors = openAppend(path.join(newDir, VECTORS));
  try { if (vecs.length) vectors.write(Buffer.concat(vecs)); vectors.sync(); } finally { vectors.close(); }
  const counter = Number(manifest.stamp.split(':')[1]) + 1;
  next.stamp = `${newName}:${counter}`;
  next.sidecar = { logBytes, vectors: position, deadRecords: 0 };
  retotal(next);
  writeFileAtomic(path.join(newDir, 'manifest.json'), JSON.stringify(next));
  if (hooks.beforeSwitch) hooks.beforeSwitch();
  switchCurrent(indexDir, newName); // the whole commit
  if (hooks.afterSwitch) hooks.afterSwitch();
  remove(oldDir);
  return { dataName: newName, dataDir: newDir, manifest: next };
}

/** Remove data folders that CURRENT does not point at (left by a crash). @param {string} indexDir @param {string | null} keep */
export function removeOrphans(indexDir, keep) {
  let names = [];
  try { names = fs.readdirSync(indexDir); } catch { return 0; }
  let removed = 0;
  for (const name of names) {
    if (/^data-\d{4,}$/.test(name) && name !== keep) { remove(path.join(indexDir, name)); removed++; }
  }
  return removed;
}
