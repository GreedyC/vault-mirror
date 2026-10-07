// @ts-check
// Recovery at the start of every sync. A crash at any point is repaired by replaying forward.
import fs from 'node:fs';
import path from 'node:path';
import { scanLog, LOG, VECTORS } from './sidecar.js';
import { truncate } from './safe-write.js';
import { retotal } from './manifest.js';

/**
 * Drop a torn last log line, fold complete records past manifest.sidecar.logBytes into the
 * manifest, and truncate vectors.f32 to the highest position any record uses.
 * @param {string} dataDir
 * @param {import('./manifest.js').Manifest} manifest
 * @param {number} dimensions
 * @returns {{ folded: number, droppedBytes: number, changed: boolean }}
 */
export function recover(dataDir, manifest, dimensions) {
  const side = manifest.sidecar;
  const scan = scanLog(dataDir, side.logBytes);
  let folded = 0;
  const vectorBytes = fs.statSync(path.join(dataDir, VECTORS)).size;
  for (const { offset, length, rec } of scan.records) {
    if (rec.op === 'put' && Array.isArray(rec.passages)) {
      const first = rec.passages.length ? rec.passages[0].vec : side.vectors;
      const last = first + rec.passages.length;
      if (last * 4 * dimensions > vectorBytes) break; // its vectors never reached the disk: stop replaying here
      if (manifest.notes[rec.path]) side.deadRecords++;
      manifest.notes[rec.path] = {
        sha256: rec.sha256, size: rec.size, mtimeMs: rec.mtimeMs, racy: true, passages: rec.passages.length,
        folderInPrefix: Boolean(rec.fip), log: [offset, length], vec: first,
        flagged: rec.passages.filter((/** @type {any} */ p) => p.flags && p.flags.length).length,
      };
      side.vectors = Math.max(side.vectors, last);
    } else if (rec.op === 'del') {
      if (manifest.notes[rec.path]) { delete manifest.notes[rec.path]; }
      side.deadRecords++;
    }
    side.logBytes = offset + length;
    folded++;
  }
  const droppedBytes = scan.size - side.logBytes;
  if (droppedBytes > 0) truncate(path.join(dataDir, LOG), side.logBytes);
  const wantVectorBytes = side.vectors * 4 * dimensions;
  if (vectorBytes > wantVectorBytes) truncate(path.join(dataDir, VECTORS), wantVectorBytes);
  if (folded) retotal(manifest);
  return { folded, droppedBytes, changed: folded > 0 || droppedBytes > 0 || vectorBytes > wantVectorBytes };
}
