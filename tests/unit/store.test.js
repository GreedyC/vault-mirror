import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { configureWriter } from '../../src/store/safe-write.js';
import { createDataDir, openSidecar, readRecord, readVectors, scanLog, LOG, VECTORS } from '../../src/store/sidecar.js';
import { newManifest, saveManifest, loadManifest, switchCurrent, currentDataName, nextDataName, withLiveData } from '../../src/store/manifest.js';
import { recover } from '../../src/store/recover.js';
import { tidyRewrite, removeOrphans } from '../../src/store/rewrite.js';
import { acquireLock, isStale, readLock, clearIfStale } from '../../src/store/lock.js';
import { VmError } from '../../src/errors.js';
import { tmpDir } from '../helpers/tmp.mjs';

const DIMS = 4;
const vec = (/** @type {number} */ seed) => Float32Array.from([seed, seed + 1, seed + 2, seed + 3]);

function setup() {
  const home = tmpDir('store');
  configureWriter({ home });
  const indexDir = path.join(home, 'indexes', 'v-00000000');
  const dataName = 'data-0001';
  const dataDir = path.join(indexDir, dataName);
  const manifest = newManifest({ dataName, vault: { name: 'v', path: '/nowhere/v', pathHash: '00000000' }, chunker: { version: 1, settingsHash: 'x', budgetTokens: 10, counter: 'fake' }, embedding: { model: 'fake', dimensions: DIMS }, engine: {} });
  manifest.sidecar.logBytes = createDataDir(dataDir, {});
  saveManifest(dataDir, manifest);
  switchCurrent(indexDir, dataName);
  return { home, indexDir, dataDir, dataName, manifest };
}

/** @param {string} key @param {number} n @param {number} seed */
function put(key, n, seed) {
  return { record: { v: 1, op: 'put', path: key, sha256: `sha-${key}-${seed}`, size: 10, mtimeMs: 1000, fip: false, title: key, passages: Array.from({ length: n }, (_, i) => ({ n: i, trail: [], line: i + 1, text: `${key} text ${seed} ${i}`, flags: [] })) }, vectors: Array.from({ length: n }, (_, i) => vec(seed * 10 + i)) };
}

/** @param {any} s @param {ReturnType<typeof put>[]} puts */
function commit(s, puts) {
  const side = openSidecar(s.dataDir, s.manifest.sidecar, DIMS);
  const where = side.appendPuts(puts);
  puts.forEach((p, i) => {
    if (s.manifest.notes[p.record.path]) s.manifest.sidecar.deadRecords++;
    s.manifest.notes[p.record.path] = { sha256: p.record.sha256, size: 10, mtimeMs: 1000, racy: false, passages: p.vectors.length, folderInPrefix: false, log: where[i].log, vec: where[i].vec, flagged: 0 };
  });
  s.manifest.sidecar.logBytes = side.logBytes; s.manifest.sidecar.vectors = side.vectors;
  side.close();
  saveManifest(s.dataDir, s.manifest);
}

test('write order: vectors, then the log record, then the manifest; records and vectors read back', () => {
  const s = setup();
  commit(s, [put('A.md', 2, 1), put('B.md', 3, 2)]);
  const loaded = loadManifest(s.indexDir);
  assert.equal(loaded.manifest.totals.passages, 5);
  assert.equal(loaded.manifest.sidecar.vectors, 5);
  const rec = readRecord(s.dataDir, loaded.manifest.notes['B.md'].log);
  assert.equal(rec.path, 'B.md');
  assert.deepEqual(rec.passages.map((p) => p.vec), [2, 3, 4]);
  const vectors = readVectors(s.dataDir, 5, DIMS);
  assert.deepEqual([...vectors.subarray(2 * DIMS, 3 * DIMS)], [...vec(20)]);
  assert.equal(fs.statSync(path.join(s.dataDir, VECTORS)).size, 5 * 4 * DIMS);
  assert.equal(loaded.manifest.stamp, 'data-0001:2', 'the stamp goes up when passages change');
  saveManifest(s.dataDir, loaded.manifest, false);
  assert.equal(loadManifest(s.indexDir).manifest.stamp, 'data-0001:2', 'a bookkeeping write keeps the stamp');
});

test('recovery: a torn last line is dropped', () => {
  const s = setup();
  commit(s, [put('A.md', 1, 1)]);
  fs.appendFileSync(path.join(s.dataDir, LOG), '{"v":1,"op":"put","path":"Torn.md","pas');
  const m = loadManifest(s.indexDir).manifest;
  const r = recover(s.dataDir, m, DIMS);
  assert.ok(r.droppedBytes > 0);
  assert.equal(fs.statSync(path.join(s.dataDir, LOG)).size, m.sidecar.logBytes);
  assert.deepEqual(Object.keys(m.notes), ['A.md']);
});

test('recovery: complete records past logBytes are folded in, and stray vectors are cut', () => {
  const s = setup();
  commit(s, [put('A.md', 1, 1)]);
  // A crash after the log record and before the manifest: write through the sidecar, do not save the manifest.
  const before = JSON.parse(JSON.stringify(s.manifest));
  const side = openSidecar(s.dataDir, s.manifest.sidecar, DIMS);
  side.appendPuts([put('B.md', 2, 2)]);
  side.appendDels(['A.md']);
  side.close();
  // And a crash after vectors only: extra vectors with no record.
  fs.appendFileSync(path.join(s.dataDir, VECTORS), Buffer.from(vec(99).buffer));
  const r = recover(s.dataDir, before, DIMS);
  assert.equal(r.folded, 2);
  assert.deepEqual(Object.keys(before.notes), ['B.md']);
  assert.equal(before.notes['B.md'].racy, true, 'a recovered note is re-hashed next run');
  assert.equal(before.sidecar.vectors, 3);
  assert.equal(fs.statSync(path.join(s.dataDir, VECTORS)).size, 3 * 4 * DIMS, 'vectors.f32 is cut to the highest position any record uses');
  assert.equal(before.totals.passages, 2);
  assert.ok(before.sidecar.deadRecords >= 1);
  assert.equal(readRecord(s.dataDir, before.notes['B.md'].log).path, 'B.md');
});

test('the tidy rewrite keeps every live record and no dead one', () => {
  const s = setup();
  commit(s, [put('A.md', 2, 1), put('B.md', 1, 2), put('C.md', 2, 3)]);
  commit(s, [put('A.md', 1, 9)]); // an edit: the old record of A is now dead
  const side = openSidecar(s.dataDir, s.manifest.sidecar, DIMS);
  side.appendDels(['B.md']); s.manifest.sidecar.logBytes = side.logBytes; side.close();
  delete s.manifest.notes['B.md']; s.manifest.sidecar.deadRecords++;
  saveManifest(s.dataDir, s.manifest);
  const out = tidyRewrite(s.indexDir, s.dataName, s.manifest, DIMS);
  assert.equal(out.dataName, 'data-0002');
  assert.equal(currentDataName(s.indexDir), 'data-0002');
  assert.ok(!fs.existsSync(s.dataDir), 'the old folder is removed');
  const log = fs.readFileSync(path.join(out.dataDir, LOG), 'utf8');
  assert.ok(!log.includes('A.md text 1') && !log.includes('B.md'), 'no old text is kept');
  assert.ok(log.includes('A.md text 9 0') && log.includes('C.md text 3 1'));
  assert.equal(out.manifest.sidecar.deadRecords, 0);
  assert.equal(out.manifest.sidecar.vectors, 3);
  assert.deepEqual([...readVectors(out.dataDir, 3, DIMS).subarray(0, DIMS)], [...vec(90)], 'vectors are renumbered with their notes');
  assert.equal(readRecord(out.dataDir, out.manifest.notes['C.md'].log).passages[1].vec, out.manifest.notes['C.md'].vec + 1);
  assert.equal(scanLog(out.dataDir, 0).records.filter((r) => r.rec.op === 'put').length, 2);
  assert.ok(Number(out.manifest.stamp.split(':')[1]) > Number(s.manifest.stamp.split(':')[1]));
});

test('a crash before the CURRENT switch leaves the old index readable; after it, an orphan the next sync removes', () => {
  const s = setup();
  commit(s, [put('A.md', 1, 1)]);
  commit(s, [put('A.md', 1, 2)]);
  assert.throws(() => tidyRewrite(s.indexDir, s.dataName, s.manifest, DIMS, { beforeSwitch: () => { throw new Error('crash'); } }), /crash/);
  let loaded = loadManifest(s.indexDir);
  assert.equal(loaded.dataName, 'data-0001');
  assert.equal(readRecord(loaded.dataDir, loaded.manifest.notes['A.md'].log).passages[0].text, 'A.md text 2 0');
  assert.equal(removeOrphans(s.indexDir, 'data-0001'), 1, 'the half-written new folder is an orphan');
  assert.throws(() => tidyRewrite(s.indexDir, s.dataName, loaded.manifest, DIMS, { afterSwitch: () => { throw new Error('crash'); } }), /crash/);
  loaded = loadManifest(s.indexDir);
  assert.equal(loaded.dataName, 'data-0002');
  assert.equal(readRecord(loaded.dataDir, loaded.manifest.notes['A.md'].log).passages[0].text, 'A.md text 2 0');
  assert.equal(removeOrphans(s.indexDir, 'data-0002'), 1);
  assert.equal(nextDataName('data-0009'), 'data-0010');
});

test('a reader that loaded the manifest before a tidy rewrite re-reads CURRENT and reads once more', async () => {
  const s = setup();
  commit(s, [put('A.md', 2, 1), put('B.md', 1, 2)]);
  commit(s, [put('A.md', 2, 9)]); // an edit: the sync that saved it ends with a tidy rewrite
  const reader = loadManifest(s.indexDir); // a search that started before the sync finished
  tidyRewrite(s.indexDir, s.dataName, s.manifest, DIMS);
  const read = (/** @type {any} */ l) => ({ from: path.basename(l.dataDir), text: readRecord(l.dataDir, l.manifest.notes['A.md'].log).passages[0].text, vectors: readVectors(l.dataDir, l.manifest.sidecar.vectors, DIMS).length / DIMS });
  assert.throws(() => read(reader), { code: 'ENOENT' }, 'the folder the reader loaded is gone');
  assert.deepEqual(await withLiveData(s.indexDir, reader, read), { from: 'data-0002', text: 'A.md text 9 0', vectors: 3 });
  // Once only, and only for a folder that vanished: any other failure is passed on as it is.
  let tries = 0;
  await assert.rejects(withLiveData(s.indexDir, reader, () => { tries++; throw Object.assign(new Error('gone again'), { code: 'ENOENT' }); }), /gone again/);
  assert.equal(tries, 2);
  const live = loadManifest(s.indexDir); tries = 0;
  await assert.rejects(withLiveData(s.indexDir, live, () => { tries++; throw Object.assign(new Error('some other file'), { code: 'ENOENT' }); }), /some other file/);
  await assert.rejects(withLiveData(s.indexDir, reader, () => { tries++; throw new TypeError('a bug'); }), /a bug/);
  assert.equal(tries, 2, 'no second try when the data folder did not change, or for another kind of error');
});

test('an unknown manifest schema stops with a message, never guesses', () => {
  const s = setup();
  s.manifest.schema = 99;
  fs.writeFileSync(path.join(s.dataDir, 'manifest.json'), JSON.stringify(s.manifest));
  assert.throws(() => loadManifest(s.indexDir), (e) => e instanceof VmError && e.code === 'VM_E_MANIFEST_NEWER');
});

test('lock: exclusive acquire, wait, release', async () => {
  const s = setup();
  const file = path.join(s.indexDir, 'sync.lock');
  // Another live process holds it (this test's parent stands in for that process).
  fs.writeFileSync(file, JSON.stringify({ pid: process.ppid, token: 'theirs', command: 'sync', startedAt: Date.now() }));
  let waited = false;
  await assert.rejects(acquireLock(file, { command: 'sync', waitMs: 120, pollMs: 20, onWait: () => { waited = true; } }), (e) => e instanceof VmError && e.code === 'VM_E_BUSY' && e.exitCode === 6);
  assert.ok(waited);
  assert.equal(readLock(file).token, 'theirs', 'a live owner is never taken over');
  setTimeout(() => fs.rmSync(file), 60); // the other run finishes
  const b = await acquireLock(file, { command: 'sync', waitMs: 2000, pollMs: 20 });
  assert.ok(b.stillOurs());
  const again = await acquireLock(file, { command: 'sync', waitMs: 0 });
  assert.equal(again.token, b.token, 'asking for a lock this process already holds returns at once');
  b.release();
  assert.ok(!fs.existsSync(file));
});

test('lock: taken over only when the owner is gone or older than boot, never from a live owner', async () => {
  const s = setup();
  const file = path.join(s.indexDir, 'sync.lock');
  const now = Date.now();
  assert.equal(isStale({ pid: 1234, startedAt: now }, { alive: () => true, bootMs: now - 60000 }), false, 'a live owner is never stale, however quiet');
  assert.equal(isStale({ pid: 1234, startedAt: now - 9e9 }, { alive: () => true, bootMs: now - 60000 }), true, 'started before the last boot');
  assert.equal(isStale({ pid: 1234, startedAt: now }, { alive: () => false, bootMs: now - 60000 }), true, 'the pid no longer exists');
  assert.equal(isStale(null), true);
  fs.writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 12345, token: 'dead', command: 'sync', startedAt: now }));
  const mine = await acquireLock(file, { command: 'sync', waitMs: 0 });
  assert.equal(readLock(file).pid, process.pid);
  // Fencing: if the token is no longer ours, the writer must stop.
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, token: 'someone-else', command: 'sync', startedAt: now }));
  assert.equal(mine.stillOurs(), false);
  mine.release();
  assert.ok(fs.existsSync(file), 'release never removes a lock that is not ours');
  assert.equal(clearIfStale(file), false, 'a live owner is not cleared');
  fs.rmSync(file);
});
