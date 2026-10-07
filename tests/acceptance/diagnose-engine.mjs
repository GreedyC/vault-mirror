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

// The tool's own path, exactly as doctor runs it.
const { createFlat } = await import('../../src/engine/ruvector-flat.js');
const { flatSelfTest } = await import('../../src/engine/selftest.js');
const dir2 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-diag2-')));
const made = await attempt('13 createFlat (the tool)', async () => { const r = await createFlat(path.join(dir2, 'check.db'), dims); return r.storagePath; });
if (made) {
  const { engine } = /** @type {any} */ ({ engine: null });
  void engine;
}
const dir3 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-diag3-')));
const f3 = path.join(dir3, 'check.db');
const r3 = await attempt('14 createFlat then flatSelfTest (the tool)', async () => { const { engine } = await createFlat(f3, dims); await flatSelfTest(engine, dims, f3); return 'self-test passed'; });
void r3;
// Variants: only the raw binding; only the wrapper; forward slashes.
const dir4 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-diag4-')));
await attempt('15 wrapper only, new file (no raw binding first)', async () => { const x = new rv.VectorDB({ dimensions: dims, storagePath: path.join(dir4, 'w.db'), distanceMetric: 'cosine' }); const v = new Float32Array(dims); v[0] = 1; await x.insertBatch([{ id: 'a', vector: v }]); return { len: await x.len(), flat: fs.readFileSync(path.join(dir4, 'w.db')).includes('"hnsw_config":null') }; });
await attempt('16 raw binding only, then use it', async () => { const x = new rv.NativeVectorDb({ dimensions: dims, storagePath: path.join(dir4, 'n.db'), distanceMetric: 'Cosine' }); return { methods: Object.getOwnPropertyNames(Object.getPrototypeOf(x)).join(','), size: fs.statSync(path.join(dir4, 'n.db')).size }; });
await attempt('17 raw then wrapper, forward slashes', async () => { const p = path.join(dir4, 's.db').split(path.sep).join('/'); new rv.NativeVectorDb({ dimensions: dims, storagePath: p, distanceMetric: 'Cosine' }); const x = new rv.VectorDB({ dimensions: dims, storagePath: p, distanceMetric: 'cosine' }); return await x.len(); });
await attempt('18 raw, wait 500 ms and collect garbage, then wrapper', async () => { const p = path.join(dir4, 'g.db'); (() => { new rv.NativeVectorDb({ dimensions: dims, storagePath: p, distanceMetric: 'Cosine' }); })(); await new Promise((r) => setTimeout(r, 500)); if (globalThis.gc) globalThis.gc(); const x = new rv.VectorDB({ dimensions: dims, storagePath: p, distanceMetric: 'cosine' }); return await x.len(); });
const dir5 = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'vm-diag5-')));
await attempt('19 createFlat through the helper process, then flatSelfTest, then 300 rows', async () => {
  const f = path.join(dir5, 'h.db');
  const made = await createFlat(f, dims, { inHelper: true });
  await flatSelfTest(made.engine, dims, made.flat === undefined ? f : () => /** @type {boolean} */ (made.flat));
  const rows = Array.from({ length: 300 }, (_, i) => { const v = new Float32Array(dims); v[i % dims] = 1; v[(i * 7 + 1) % dims] = 0.5; return { id: `p${i}`, vector: v }; });
  await made.engine.insert(rows);
  await made.engine.remove(['p3', 'p4']);
  const top = await made.engine.search(rows[9].vector, 1);
  return { flat: made.flat, count: await made.engine.count(), top: top[0].id };
});
await attempt('20 createFlat with the platform default, then flatSelfTest', async () => {
  const f = path.join(dir5, 'd.db');
  const made = await createFlat(f, dims);
  await flatSelfTest(made.engine, dims, made.flat === undefined ? f : () => /** @type {boolean} */ (made.flat));
  return { flat: made.flat, helper: made.flat !== undefined };
});
process.exit(0);
