#!/usr/bin/env node
// TEMPORARY (cross-platform work): says which step of making an engine file fails on this system.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRuvector, isNative } from '../../src/engine/ruvector-loader.js';

const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-diag-')));
const file = path.join(dir, 'check.db');
const say = (/** @type {string} */ what, /** @type {any} */ v) => console.log(`${what}: ${v}`);
const attempt = async (/** @type {string} */ what, /** @type {() => any} */ fn) => {
  try { const r = await fn(); say(what, `ok ${r === undefined ? '' : JSON.stringify(r)}`); return r; }
  catch (e) { say(what, `FAILED code=${/** @type {any} */ (e)?.code} message=${String(/** @type {any} */ (e)?.message).slice(0, 300)}`); return null; }
};
say('platform', `${process.platform} ${process.arch} node ${process.version}`);
say('native', isNative());
const rv = loadRuvector();
const dims = 384;
await attempt('1 new NativeVectorDb', () => { new rv.NativeVectorDb({ dimensions: dims, storagePath: file, distanceMetric: 'Cosine' }); });
await attempt('2 file exists and size', () => fs.statSync(file).size);
const db = await attempt('3 new VectorDB on the same file', () => new rv.VectorDB({ dimensions: dims, storagePath: file, distanceMetric: 'cosine' }));
await attempt('4 open the file for reading while the engine holds it', () => { const fd = fs.openSync(file, 'r'); try { const b = Buffer.alloc(Math.min(4 * 1024 * 1024, fs.fstatSync(fd).size)); const n = fs.readSync(fd, b, 0, b.length, 0); return { read: n, flat: b.includes('"hnsw_config":null') }; } finally { fs.closeSync(fd); } });
await attempt('5 readFileSync the file', () => fs.readFileSync(file).length);
if (db) {
  const v = new Float32Array(dims); v[0] = 1; const w = new Float32Array(dims); w[1] = 1;
  await attempt('6 insert', () => db.insertBatch([{ id: 'a', vector: v }]));
  await attempt('7 insert the same id again', () => db.insertBatch([{ id: 'a', vector: w }]));
  await attempt('8 search', async () => (await db.search({ vector: w, k: 3 })).map((/** @type {any} */ h) => [h.id, h.score]));
  await attempt('9 len', () => db.len());
  await attempt('10 delete', () => db.delete('a'));
  await attempt('11 len after delete', () => db.len());
}
await attempt('12 remove the folder while the engine holds the file', () => { fs.rmSync(dir, { recursive: true, force: true }); return fs.existsSync(dir) ? 'still there' : 'gone'; });
process.exit(0);
