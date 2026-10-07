import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildPlan, safetyStops, sha256 } from '../../src/sync/plan.js';
import { walkVault, noteKeyOf } from '../../src/vault/walk.js';
import { readObsidianExcludes } from '../../src/vault/obsidian-registry.js';
import { chunk } from '../../src/chunker/index.js';
import { noteKey } from '../../src/log.js';
import { VmError } from '../../src/errors.js';
import { tmpDir, SETTINGS } from '../helpers/tmp.mjs';

const enc = (/** @type {string} */ s) => new TextEncoder().encode(s);
const body = (/** @type {string} */ name) => `# ${name}\n\nSome invented words about ${name} and the harbour.\n`;
const chunkFn = (bytes, key, fip) => chunk(bytes, key, { ...SETTINGS, folderInPrefix: fip });

/** An in-memory vault: name -> { text, mtimeMs }. */
function fakeVault(files, over = {}) {
  const notes = Object.entries(files).map(([key, f]) => ({ key, abs: `/v/${key}`, size: enc(f.text).length, mtimeMs: f.mtimeMs ?? 1000 }));
  const walk = { notes, leftOut: [], otherFiles: 0, warnings: [], unreadableDirs: [], ...over };
  const read = async (/** @type {string} */ abs) => enc(files[abs.slice(3)].text);
  const stat = (/** @type {string} */ abs) => { const f = files[abs.slice(3)]; return f ? { size: enc(f.text).length, mtimeMs: f.mtimeMs ?? 1000 } : null; };
  return { walk, read, stat };
}

/** A manifest that already holds these files. */
function manifestOf(files, over = {}) {
  const notes = {};
  for (const [key, f] of Object.entries(files)) notes[key] = { sha256: sha256(enc(f.text)), size: enc(f.text).length, mtimeMs: f.mtimeMs ?? 1000, racy: false, passages: 1, folderInPrefix: false, log: [0, 1], vec: 0, flagged: 0, ...(over[key] || {}) };
  return /** @type {any} */ ({ notes, leftOut: {} });
}
const NOW = 10_000_000;

test('fast path: same size and date means the note is not read', async () => {
  const files = { 'A.md': { text: body('A') }, 'B.md': { text: body('B') } };
  const v = fakeVault(files);
  let reads = 0;
  const plan = await buildPlan({ ...v, read: async (abs) => { reads++; return v.read(abs); }, manifest: manifestOf(files), chunk: chunkFn, now: NOW });
  assert.equal(reads, 0);
  assert.equal(plan.unchanged, 2);
  assert.equal(plan.toEmbed.length, 0);
});

test('hash path: a new date with the same content only updates size and time', async () => {
  const files = { 'A.md': { text: body('A'), mtimeMs: 5000 } };
  const plan = await buildPlan({ ...fakeVault(files), manifest: manifestOf({ 'A.md': { text: body('A'), mtimeMs: 1000 } }), chunk: chunkFn, now: NOW });
  assert.equal(plan.toEmbed.length, 0);
  assert.deepEqual(plan.touched, [{ key: 'A.md', size: enc(body('A')).length, mtimeMs: 5000, racy: false }]);
  const changed = await buildPlan({ ...fakeVault({ 'A.md': { text: body('A') + 'more\n', mtimeMs: 5000 } }), manifest: manifestOf({ 'A.md': { text: body('A') } }), chunk: chunkFn, now: NOW });
  assert.equal(changed.toEmbed[0].kind, 'updated');
  const verify = await buildPlan({ ...fakeVault({ 'A.md': { text: body('X') } }), manifest: manifestOf({ 'A.md': { text: body('A') } }), chunk: chunkFn, now: NOW, verify: true });
  assert.equal(verify.toEmbed.length, 1, '--verify hashes every note: same size and date, different content');
});

test('racy rule: a note modified within 2 s of the check is stored racy and re-hashed next run', async () => {
  const files = { 'A.md': { text: body('A'), mtimeMs: NOW - 500 } };
  const first = await buildPlan({ ...fakeVault(files), manifest: null, chunk: chunkFn, now: NOW });
  assert.equal(first.toEmbed[0].racy, true);
  let reads = 0;
  const v = fakeVault(files);
  const next = await buildPlan({ ...v, read: async (abs) => { reads++; return v.read(abs); }, manifest: manifestOf(files, { 'A.md': { racy: true } }), chunk: chunkFn, now: NOW + 60000 });
  assert.equal(reads, 1, 'a racy entry is read again even though size and date match');
  assert.deepEqual(next.touched.map((t) => t.racy), [false]);
  const shallow = await buildPlan({ ...v, manifest: manifestOf(files, { 'A.md': { racy: true } }), chunk: chunkFn, now: NOW, shallow: true });
  assert.equal(shallow.pending.changed, 0, 'status trusts size and date');
});

test('a file that changes while it is read is skipped for this run and keeps its old passages', async () => {
  const files = { 'A.md': { text: body('A') } };
  const v = fakeVault(files);
  let tick = 0;
  const plan = await buildPlan({ ...v, stat: () => ({ size: 5 + tick++, mtimeMs: 2000 + tick }), manifest: manifestOf(files, { 'A.md': { mtimeMs: 1 } }), chunk: chunkFn, now: NOW });
  assert.deepEqual(plan.skipped, [{ key: 'A.md', reason: 'changing' }]);
  assert.equal(plan.removed.length, 0);
});

test('rename by hash: counted as renamed, and never toward the mass-removal stop', async () => {
  const old = {}; const now = {};
  for (let i = 0; i < 30; i++) { old[`Old/N${i}.md`] = { text: body(`N${i}`) }; now[`New/N${i}.md`] = { text: body(`N${i}`) }; }
  old['Keep.md'] = now['Keep.md'] = { text: body('Keep') };
  const plan = await buildPlan({ ...fakeVault(now), manifest: manifestOf(old), chunk: chunkFn, now: NOW });
  assert.equal(plan.renamed.length, 30);
  assert.equal(plan.leaving, 0);
  safetyStops(plan, manifestOf(old), { vaultPath: '/v' });
});

test('a read timeout becomes not-downloaded: passages kept, never removed; three stop the run', async () => {
  const files = { 'A.md': { text: body('A'), mtimeMs: 7 }, 'B.md': { text: body('B') } };
  const v = fakeVault(files);
  const timeout = async (/** @type {string} */ abs) => { if (abs.endsWith('A.md')) throw Object.assign(new Error('t'), { code: 'VM_READ_TIMEOUT' }); return v.read(abs); };
  const plan = await buildPlan({ ...v, read: timeout, manifest: manifestOf({ 'A.md': { text: body('A') }, 'B.md': { text: body('B') } }), chunk: chunkFn, now: NOW });
  assert.equal(plan.leftOut['not-downloaded'], 1);
  assert.equal(plan.removed.length + plan.dropped.length, 0);
  const many = { 'A.md': { text: 'a' }, 'B.md': { text: 'b' }, 'C.md': { text: 'c' } };
  await assert.rejects(buildPlan({ ...fakeVault(many), read: async () => { throw Object.assign(new Error('t'), { code: 'VM_READ_TIMEOUT' }); }, manifest: null, chunk: chunkFn, now: NOW }), (e) => e instanceof VmError && e.code === 'VM_E_VAULT_DOWNLOADING' && e.exitCode === 4);
});

test('left-out notes: index false and empty are remembered by a hashed key, never by name', async () => {
  const files = { 'Secret diary.md': { text: '---\nindex: false\n---\n# Secret\n\nwords that stay out\n' }, 'Empty.md': { text: '' }, 'A.md': { text: body('A') } };
  const plan = await buildPlan({ ...fakeVault(files), manifest: manifestOf({ 'Secret diary.md': { text: 'old words here' } }), chunk: chunkFn, now: NOW });
  assert.deepEqual(plan.leftOut, { 'index-false': 1, empty: 1 });
  assert.deepEqual(plan.dropped, [{ key: 'Secret diary.md', reason: 'index-false' }]);
  assert.deepEqual(Object.keys(plan.leftOutKept).sort(), [noteKey('Secret diary.md'), noteKey('Empty.md')].sort());
  assert.ok(!JSON.stringify(plan.leftOutKept).includes('Secret'));
  assert.equal(plan.eligible, 1);
  assert.equal(plan.seen, 3);
});

test('the folder-in-prefix flag: a second note of the same name re-chunks the first, and losing it re-chunks the survivor', async () => {
  const one = { 'A/README.md': { text: body('one') } };
  const two = { ...one, 'B/readme.md': { text: body('two') } };
  const grow = await buildPlan({ ...fakeVault(two), manifest: manifestOf(one), chunk: chunkFn, now: NOW });
  assert.deepEqual(grow.toEmbed.map((n) => [n.key, n.kind, n.folderInPrefix]).sort(), [['A/README.md', 'updated', true], ['B/readme.md', 'added', true]]);
  assert.ok(grow.toEmbed[0].passages[0].embedText.includes(' > '));
  const shrink = await buildPlan({ ...fakeVault(one), manifest: manifestOf(two, { 'A/README.md': { folderInPrefix: true }, 'B/readme.md': { folderInPrefix: true } }), chunk: chunkFn, now: NOW });
  assert.deepEqual(shrink.toEmbed.map((n) => [n.key, n.folderInPrefix]), [['A/README.md', false]]);
  assert.deepEqual(shrink.removed, ['B/readme.md']);
});

test('safety stops: zero notes found, and mass removal with exclude changes counted', async () => {
  const files = {}; for (let i = 0; i < 40; i++) files[`N${i}.md`] = { text: body(`N${i}`) };
  const m = manifestOf(files);
  const empty = await buildPlan({ ...fakeVault({}), manifest: m, chunk: chunkFn, now: NOW });
  assert.throws(() => safetyStops(empty, m, { vaultPath: '/v' }), (e) => e instanceof VmError && e.code === 'VM_E_VAULT_EMPTY' && e.exitCode === 4);
  const fewer = Object.fromEntries(Object.entries(files).slice(0, 28)); // 12 of 40 removed: 30%
  const gone = await buildPlan({ ...fakeVault(fewer), manifest: m, chunk: chunkFn, now: NOW });
  assert.equal(gone.leaving, 12);
  assert.throws(() => safetyStops(gone, m, { vaultPath: '/v' }), (e) => e instanceof VmError && e.code === 'VM_E_MASS_DELETE' && /12 notes/.test(e.message));
  safetyStops(gone, m, { vaultPath: '/v', allowMassDelete: true });
  // A new exclude that covers 30% of the notes counts the same way.
  const v = fakeVault(fewer, { leftOut: Object.keys(files).slice(28).map((key) => ({ key, reason: 'excluded', size: 1, mtimeMs: 1, abs: `/v/${key}` })) });
  const excluded = await buildPlan({ ...v, manifest: m, chunk: chunkFn, now: NOW });
  assert.equal(excluded.leaving, 12);
  assert.throws(() => safetyStops(excluded, m, { vaultPath: '/v' }), /12 notes/);
  const ten = await buildPlan({ ...fakeVault(Object.fromEntries(Object.entries(files).slice(0, 30))), manifest: m, chunk: chunkFn, now: NOW });
  safetyStops(ten, m, { vaultPath: '/v' }); // exactly 10 is allowed: the rule is more than 10 and more than 20%
});

test('a note under a folder that could not be read is never treated as removed', async () => {
  const files = { 'A.md': { text: body('A') }, 'Locked/B.md': { text: body('B') } };
  const v = fakeVault({ 'A.md': files['A.md'] }, { unreadableDirs: ['Locked'] });
  const plan = await buildPlan({ ...v, manifest: manifestOf(files), chunk: chunkFn, now: NOW });
  assert.deepEqual(plan.removed, []);
  assert.deepEqual(plan.skipped, [{ key: 'Locked/B.md', reason: 'unreadable' }]);
});

test('the walk: stubs before the dot-skip, .MD is a note, other files counted, nested vaults and symlinks left out', () => {
  const root = tmpDir('walk');
  const put = (/** @type {string} */ rel, text = 'words') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); };
  put('A.md'); put('Sub/NOTE.MD'); put('Sub/photo.png'); put('Sub/board.canvas'); put('.hidden/Secret.md'); put('.trash/Old.md');
  put('Sub/.Cloud note.md.icloud'); put('Nested/.obsidian/app.json', '{}'); put('Nested/Inner.md'); put('Templates/Daily.md'); put('Templates/Deep/Weekly.md');
  fs.symlinkSync(path.join(root, 'A.md'), path.join(root, 'Link.md'));
  put('.obsidian/app.json', JSON.stringify({ userIgnoreFilters: ['/draft-\\d+/', 'Private/'] }));
  put('Private/P.md'); put('Sub/Draft-12.md'); put('Sub/draft.md');
  const w = walkVault(root, { exclude: ['Templates'] });
  assert.deepEqual(w.notes.map((n) => n.key).sort(), ['A.md', 'Sub/NOTE.MD', 'Sub/draft.md']);
  assert.equal(w.otherFiles, 2, 'images and canvases are counted once and never read');
  const reasons = Object.fromEntries(w.leftOut.map((l) => [l.key, l.reason]));
  assert.deepEqual(reasons, { 'Sub/Cloud note.md': 'not-downloaded', 'Nested/Inner.md': 'nested-vault', 'Templates/Daily.md': 'excluded', 'Templates/Deep/Weekly.md': 'excluded', 'Link.md': 'symlink', 'Private/P.md': 'obsidian-excluded', 'Sub/Draft-12.md': 'obsidian-excluded' });
  assert.equal(walkVault(root, { exclude: ['Templates'], obsidianExcludes: false }).notes.length, 5, 'obsidianExcludes: false ignores that setting');
  assert.ok(!walkVault(root, { exclude: ['Temp'] }).leftOut.some((l) => l.reason === 'excluded'), 'an exclude is a whole folder name, not a prefix of one');
});

test('Obsidian excludes: a missing or broken app.json is ignored, with one warning for a bad entry', () => {
  const root = tmpDir('obs');
  assert.equal(readObsidianExcludes(root).test('A.md'), false);
  fs.mkdirSync(path.join(root, '.obsidian'));
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{ not json');
  const broken = readObsidianExcludes(root);
  assert.equal(broken.test('A.md'), false);
  assert.ok(broken.warning);
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), JSON.stringify({ userIgnoreFilters: ['/(unclosed/', 'Archive/'] }));
  const partial = readObsidianExcludes(root);
  assert.ok(partial.warning);
  assert.equal(partial.test('archive/Old.md'), true, 'a prefix ignores letter case');
  fs.writeFileSync(path.join(root, '.obsidian', 'app.json'), '{}');
  assert.equal(readObsidianExcludes(root).warning, null);
});

test('two names with one key: the first by raw name is indexed, the other is listed', () => {
  assert.equal(noteKeyOf('Café/a b.md'), 'Café/a b.md');
  const root = tmpDir('dup');
  fs.writeFileSync(path.join(root, 'a b.md'), 'plain space');
  fs.writeFileSync(path.join(root, 'a b.md'), 'no-break space');
  const w = walkVault(root);
  if (w.notes.length + w.leftOut.length === 2) {
    assert.equal(w.notes.length, 1);
    assert.deepEqual(w.leftOut.map((l) => l.reason), ['duplicate-path']);
    assert.ok(w.notes[0].abs.endsWith('a b.md'));
  }
});

test('a missing vault root is a safety stop', async () => {
  const { planOnly } = await import('../../src/sync/run.js');
  const ctx = /** @type {any} */ ({ cfg: { vault: { exclude: [], obsidianExcludes: true, minWords: 3, dropFences: [] } }, vault: { real: path.join(tmpDir('gone'), 'not-here') } });
  await assert.rejects(planOnly(ctx, { shallow: true, manifest: null }), (e) => e instanceof VmError && e.code === 'VM_E_VAULT_MISSING' && e.exitCode === 4);
});
