#!/usr/bin/env node
// The first ten minutes of a new member, on whatever system this runs on: the installed tool against a
// small invented vault whose path has a space and whose notes have spaces and non-English letters.
// It prints the real output of every command, with timings, and compares a checksum listing of the
// vault after every command.
//
//   node tests/acceptance/member-smoke.mjs [--installed | --bin <path to a bin/vault-mirror.js>] [--default-home]
//
// With no option it runs this checkout. --installed runs the copy that `npm install -g` put on this
// computer (CI uses this). The index goes to a temp folder unless --default-home is given.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { values: opt } = parseArgs({ options: { bin: { type: 'string' }, installed: { type: 'boolean' }, 'default-home': { type: 'boolean' }, keep: { type: 'boolean' } } });
const globalRoot = () => spawnSync('npm', ['root', '-g'], { encoding: 'utf8', shell: true }).stdout.trim();
const BIN = opt.installed ? path.join(globalRoot(), 'vault-mirror', 'bin', 'vault-mirror.js') : opt.bin ? path.resolve(opt.bin) : path.join(HERE, '..', '..', 'bin', 'vault-mirror.js');
if (!fs.existsSync(BIN)) { console.error(`No vault-mirror at ${BIN}`); process.exit(2); }

const tmpBase = process.env.VAULT_MIRROR_TEST_TMP || os.tmpdir();
fs.mkdirSync(tmpBase, { recursive: true });
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(tmpBase, 'vm member ')));
const VAULT = path.join(base, 'My Vault');
const PROJECT = path.join(base, 'my project');
const OBS_JSON = path.join(base, 'obsidian.json');
const HOME = opt['default-home'] ? null : path.join(base, 'index home');

const NOTES = {
  'Garden plan.md': '# Garden plan\n\nMove the tomato seedlings outside after the last frost, usually in the second week of May.\n\n## Watering\n\nWater the raised beds early in the morning, twice a week in a dry spell.\n',
  'Café Zürich notes.md': '# Café Zürich notes\n\nThe café on Bahnhofstraße opens at seven. Order the Birchermüesli and ask for the window table.\n',
  'Recetas/Año nuevo señor Peña.md': '# Año nuevo\n\nLa receta de la abuela: lentejas con chorizo para el almuerzo del primer día del año.\n',
  '日本語/庭の手入れ.md': '# 庭の手入れ\n\nIn spring, prune the roses (バラの剪定) and mix compost into the soil. 春になったら、堆肥を土に混ぜる。\n',
  'Work/Meeting notes 2031-03-04.md': '---\ntags: [work]\n---\n# Meeting notes\n\nThe invented harbour committee agreed to repaint the north pier lighthouse in June.\r\n\r\nA line with Windows line endings.\r\n',
};
fs.mkdirSync(path.join(VAULT, '.obsidian'), { recursive: true });
fs.mkdirSync(PROJECT);
for (const [rel, text] of Object.entries(NOTES)) { const p = path.join(VAULT, ...rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
fs.writeFileSync(OBS_JSON, JSON.stringify({ vaults: { a1b2c3d4e5f60718: { path: VAULT, ts: 1, open: true } } }));

/** Every file of the vault: path -> size and SHA-256. */
function snapshot() {
  /** @type {string[]} */
  const out = [];
  const walk = (/** @type {string} */ dir) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = path.join(dir, d.name);
      if (d.isDirectory()) { out.push(`${path.relative(VAULT, abs)}${path.sep}`); walk(abs); }
      else { const s = fs.statSync(abs, { bigint: true }); out.push(`${path.relative(VAULT, abs)} ${s.size} ${s.mtimeNs} ${crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex')}`); }
    }
  };
  walk(VAULT);
  return out.join('\n');
}
let expected = snapshot();
let checks = 0;
/** @type {{ name: string, ok: boolean, detail: string }[]} */
const results = [];
/** @type {Record<string, number>} */
const timings = {};

/** Run the tool, print what it printed, and check the vault. */
function vm(/** @type {string[]} */ args, /** @type {string} */ label = args[0]) {
  const env = { ...process.env, NO_COLOR: '1', VAULT_MIRROR_OBSIDIAN_JSON: OBS_JSON, ...(HOME ? { VAULT_MIRROR_HOME: HOME } : {}) };
  const t = Date.now();
  const r = spawnSync(process.execPath, [BIN, ...args], { cwd: PROJECT, env, encoding: 'utf8', timeout: 900000 });
  const ms = Date.now() - t;
  timings[label] = ms;
  console.log(`\n$ vault-mirror ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}    [exit ${r.status}, ${ms} ms]`);
  if (r.stdout.trim()) console.log(r.stdout.trimEnd().split('\n').map((l) => `  ${l}`).join('\n'));
  if (r.stderr.trim()) console.log(r.stderr.trimEnd().split('\n').map((l) => `  (stderr) ${l}`).join('\n'));
  checks++;
  if (snapshot() !== expected) throw new Error(`THE VAULT CHANGED after vault-mirror ${args[0]}`);
  /** @type {any} */
  let json = null;
  if (args.includes('--json')) { try { json = JSON.parse(r.stdout); } catch { json = null; } }
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, json, ms };
}
function step(/** @type {string} */ name, /** @type {() => string | void} */ fn) {
  try { const detail = fn() || ''; results.push({ name, ok: true, detail }); console.log(`PASS  ${name}${detail ? `  [${detail}]` : ''}`); }
  catch (e) { const detail = String(/** @type {any} */ (e).message); results.push({ name, ok: false, detail }); console.log(`FAIL  ${name}\n      ${detail}`); }
}
const must = (/** @type {any} */ cond, /** @type {string} */ message) => { if (!cond) throw new Error(message); };

console.log(`vault-mirror member smoke test\n  system: ${process.platform} ${process.arch}, node ${process.version}, ${os.cpus().length} cores, ${(os.totalmem() / 2 ** 30).toFixed(0)} GB\n  tool:   ${BIN}\n  vault:  ${VAULT}\n  index:  ${HOME || '(the default home folder)'}`);

step('version', () => { const r = vm(['--version']); must(r.status === 0, `exit ${r.status}`); return r.stdout.trim(); });

step('doctor before anything', () => {
  const r = vm(['doctor', '--json'], 'doctor');
  vm(['doctor'], 'doctor (as a person sees it)');
  must(r.json, 'doctor printed no JSON');
  const failed = r.json.checks.filter((/** @type {any} */ c) => c.status === 'fail').map((/** @type {any} */ c) => `${c.name}: ${c.message || c.text || ''}`);
  must(failed.length === 0 && r.status === 0, `exit ${r.status}; failed checks: ${failed.join(' | ') || 'none'}`);
  return `${r.json.checks.length} checks, none failed`;
});

step('init on a vault whose path has a space', () => {
  const r = vm(['init', VAULT, '--project', PROJECT, '--json'], 'init');
  must(r.status === 0, `exit ${r.status}: ${r.stdout.slice(0, 300)}`);
  must(r.json.notesFound === Object.keys(NOTES).length, `found ${r.json.notesFound} notes, wanted ${Object.keys(NOTES).length}`);
  must(fs.readdirSync(PROJECT).sort().join(',') === 'AGENTS.md,CLAUDE.md', `rule files in the project folder: ${fs.readdirSync(PROJECT).join(',')}`);
  must(!fs.readFileSync(path.join(PROJECT, 'CLAUDE.md'), 'utf8').includes('\r'), 'the rule file has Windows line endings');
  return `${r.json.notesFound} notes found; the index folder is ${r.json.indexDir}`;
});

step('first sync', () => {
  const r = vm(['sync', '--json'], 'first sync');
  vm(['sync'], 'sync again (as a person sees it)');
  must(r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).slice(0, 400)}`);
  must(r.json.inStep === true, 'not in step after the sync');
  return `${r.json.counts.added} notes, ${r.json.passages.total} passages in ${r.json.seconds} s`;
});

let engineLine = '';
step('status says in step', () => {
  const human = vm(['status']);
  const r = vm(['status', '--json'], 'status');
  const v = vm(['status', '--verify', '--json'], 'status --verify');
  must(r.status === 0 && r.json.inStep === true, `status: exit ${r.status}, inStep ${r.json && r.json.inStep}`);
  must(v.status === 0 && v.json.inStep === true, `status --verify: exit ${v.status}, inStep ${v.json && v.json.inStep}; failing checks: ${v.json ? v.json.checks.filter((/** @type {any} */ c) => !c.ok).map((/** @type {any} */ c) => c.name).join(',') : '?'}`);
  must(/In step: yes/.test(human.stdout), 'the plain status did not say "In step: yes"');
  must(r.json.counts.notesIndexed === Object.keys(NOTES).length, `indexed ${r.json.counts.notesIndexed} of ${Object.keys(NOTES).length}; left out: ${JSON.stringify(r.json.counts.leftOut)}`);
  engineLine = JSON.stringify(r.json.versions || {});
  return `${r.json.counts.notesIndexed} notes on disk = ${r.json.counts.notesIndexed} in the index; ${v.json.checks.length} checks in --verify`;
});

/** Search and return the hit for one note. */
function find(/** @type {string[]} */ wordings, /** @type {string} */ wantPath, /** @type {string} */ label) {
  const r = vm(['search', ...wordings, '--json'], label);
  must(r.status === 0, `exit ${r.status}: ${(r.stdout + r.stderr).slice(0, 300)}`);
  const all = [...(r.json.results || []), ...(r.json.exactWords || [])];
  const hit = all.find((/** @type {any} */ x) => x.vaultPath === wantPath);
  must(hit, `"${wordings[0]}" did not return ${wantPath}; got ${all.map((/** @type {any} */ x) => x.vaultPath).join(', ')}`);
  return { hit, r };
}

step('search returns the passage, with a working way back to the note', () => {
  const { hit, r } = find(['when do the tomatoes go outside', 'tomato seedlings after the last frost'], 'Garden plan.md', 'search');
  vm(['search', 'when do the tomatoes go outside'], 'search (as a person sees it)');
  must(/last frost/.test(hit.text), `the passage text is missing: ${String(hit.text).slice(0, 120)}`);
  must(fs.existsSync(hit.path) && fs.realpathSync.native(hit.path) === path.join(VAULT, 'Garden plan.md'), `the file path does not lead to the note: ${hit.path}`);
  must(hit.line > 0, 'no line number');
  const link = new URL(hit.link);
  must(link.protocol === 'obsidian:' && link.searchParams.get('vault') === 'My Vault', `link vault: ${hit.link}`);
  must(String(link.searchParams.get('file')).split('#')[0] === 'Garden plan.md', `link file: ${hit.link}`);
  const engine = r.json.engine || r.json.searched?.engine || '';
  return `link ${hit.link}${engine ? `; engine ${engine}` : ''}`;
});

step('notes with non-English letters are found, and their links decode back', () => {
  for (const [q, want] of /** @type {[string, string][]} */ ([['Birchermüesli at the café', 'Café Zürich notes.md'], ['lentejas con chorizo', 'Recetas/Año nuevo señor Peña.md'], ['prune the roses in spring', '日本語/庭の手入れ.md'], ['north pier lighthouse', 'Work/Meeting notes 2031-03-04.md']])) {
    const { hit } = find([q], want, `search ${want}`);
    must(fs.existsSync(hit.path), `path does not exist: ${hit.path}`);
    must(String(new URL(hit.link).searchParams.get('file')).split('#')[0] === want, `the link for ${want} decodes to ${new URL(hit.link).searchParams.get('file')}`);
    must(!/\r/.test(hit.text), 'a passage kept a carriage return');
  }
  return '4 notes, each found by its own words';
});

step('edit a note, sync again, search finds the new text', () => {
  const p = path.join(VAULT, 'Garden plan.md');
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8') + '\n## Bees\n\nThe invented kestrel hive gets a second brood box when the lime trees flower.\n');
  expected = snapshot(); // this script's own edit
  const stale = vm(['status', '--json'], 'status after an edit');
  must(stale.json.inStep === false, 'status still said in step after an edit');
  const r = vm(['sync', '--json'], 'sync after one edit');
  must(r.status === 0 && r.json.inStep === true, `exit ${r.status}`);
  must(r.json.counts.updated === 1, `updated ${r.json.counts.updated} notes, wanted 1`);
  const { hit } = find(['second brood box for the kestrel hive'], 'Garden plan.md', 'search after the edit');
  must(/brood box/.test(hit.text), 'the new text is not in the passage');
  return `1 note updated, ${r.json.passages.embedded} passages read again, in ${r.ms} ms`;
});

step('delete a note, sync, it is gone from search', () => {
  fs.rmSync(path.join(VAULT, 'Café Zürich notes.md'));
  expected = snapshot();
  const r = vm(['sync', '--json'], 'sync after a delete');
  must(r.status === 0 && r.json.inStep === true, `exit ${r.status}`);
  const s = vm(['search', 'Birchermüesli at the café', '--json']);
  must(![...(s.json.results || []), ...(s.json.exactWords || [])].some((/** @type {any} */ x) => x.vaultPath === 'Café Zürich notes.md'), 'a deleted note is still returned');
  return 'removed';
});

step('rebuild, then still in step', () => {
  const r = vm(['rebuild', '--json'], 'rebuild');
  must(r.status === 0 && r.json.inStep === true, `exit ${r.status}: ${(r.stdout + r.stderr).slice(0, 300)}`);
  const v = vm(['status', '--verify', '--json']);
  must(v.json.inStep === true, 'not in step after rebuild');
  find(['when do the tomatoes go outside'], 'Garden plan.md', 'search after rebuild');
  return `mode ${r.json.mode}`;
});

step('doctor at the end', () => {
  const r = vm(['doctor', '--json'], 'doctor at the end');
  vm(['doctor']);
  const failed = r.json ? r.json.checks.filter((/** @type {any} */ c) => c.status === 'fail').map((/** @type {any} */ c) => c.name) : ['no JSON'];
  must(r.status === 0 && failed.length === 0, `exit ${r.status}; failed checks: ${failed.join(', ')}`);
  return 'no failed check';
});

step('not one file in the vault changed', () => {
  must(snapshot() === expected, 'the vault differs from its checksum listing');
  must(!fs.readdirSync(VAULT).some((n) => /vault-mirror|ruvector|\.db$/.test(n)), 'a tool file is in the vault');
  return `checksum listing identical after ${checks} commands`;
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} of ${results.length} member steps passed on ${process.platform} (node ${process.version})${failed.length ? `; FAILED: ${failed.map((f) => f.name).join('; ')}` : ''}.`);
console.log(`Timings (ms): ${JSON.stringify(timings)}`);
if (engineLine) console.log(`Versions: ${engineLine}`);
if (!opt.keep) { try { fs.rmSync(base, { recursive: true, force: true }); } catch { console.log(`Could not remove ${base}`); } } else console.log(`Kept: ${base}`);
process.exit(failed.length ? 1 : 0);
