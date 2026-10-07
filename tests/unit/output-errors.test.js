import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ERRORS, VmError, toVmError } from '../../src/errors.js';
import { num, duration, eta, plural } from '../../src/cli/output.js';
import { skippedSentence } from '../../src/sync/run.js';
import { tmpDir } from '../helpers/tmp.mjs';

const BIN = fileURLToPath(new URL('../../bin/vault-mirror.js', import.meta.url));
const run = (/** @type {string[]} */ args, env = {}) => spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8', env: { ...process.env, VAULT_MIRROR_HOME: tmpDir('out'), ...env } });

test('code, exit and wording table', () => {
  /** @type {[string, number, Record<string, any>, RegExp, RegExp][]} */
  const table = [
    ['VM_E_NO_VAULT', 2, {}, /^No vault is set up yet\.$/, /vault-mirror init "<path to your vault>"/],
    ['VM_E_NOT_ONE_VAULT', 2, { path: '/x' }, /^\/x is not one vault \(it is your home folder, a folder of several vaults, or a folder inside a vault\)\.$/, /vault-mirror init/],
    ['VM_E_NOT_SYNCED', 2, {}, /^Nothing is indexed yet\.$/, /^Run `vault-mirror sync`\.$/],
    ['VM_E_INDEX_IN_VAULT', 2, {}, /must stay outside so your notes are never touched/, /VAULT_MIRROR_HOME/],
    ['VM_E_MANIFEST_NEWER', 2, {}, /made by a newer vault-mirror/, /rebuild --full/],
    ['VM_E_VAULT_MISSING', 4, { path: '/x' }, /was not found at \/x\. Nothing was changed\.$/, /run it again/],
    ['VM_E_VAULT_EMPTY', 4, { path: '/x', indexed: '1,230' }, /but the index has 1,230\. Nothing was changed\.$/, /finish downloading/],
    ['VM_E_VAULT_DOWNLOADING', 4, {}, /Nothing was removed\.$/, /vault-mirror sync/],
    ['VM_E_MASS_DELETE', 4, { count: '640' }, /^640 notes would leave the index since the last sync\. Nothing was changed, in case that is a mistake\.$/, /--allow-mass-delete/],
    ['VM_E_NODE_OLD', 5, { version: '18.1.0' }, /Node 20 or newer\. You have 18\.1\.0\.$/, /vault-mirror doctor/],
    ['VM_E_MODEL_OFFLINE', 5, {}, /download did not get through/, /vault-mirror doctor/],
    ['VM_E_MODEL_BROKEN', 5, { path: '/m' }, /did not finish downloading/, /^Delete the folder \/m, then run `vault-mirror doctor`\.$/],
    ['VM_E_EMBED_FAILING', 5, {}, /What was done is saved\.$/, /vault-mirror doctor/],
    ['VM_E_DISK_FULL', 5, {}, /Your notes were not touched\.$/, /Free about 500 MB/],
    ['VM_E_BUSY', 6, { percent: 41 }, /^Another sync is still running \(41% done\)\. Nothing is wrong\.$/, /is my vault in sync/],
    ['VM_E_LOCK_LOST', 6, {}, /Nothing is wrong\.$/, /is my vault in sync/],
    ['VM_E_INDEX_BUSY', 6, {}, /using the index right now/, /Try again in a moment/],
    ['VM_E_STOPPED', 130, { done: '812', total: '1,240' }, /^Stopped at 812 of 1,240 notes\.$/, /^Run it again to continue\.$/],
    ['VM_E_INTERNAL', 1, {}, /Your notes were not touched\.$/, /^Run `vault-mirror rebuild`\. It is always safe\./],
  ];
  for (const [code, exit, params, message, next] of table) {
    const e = new VmError(code, params);
    assert.equal(e.exitCode, exit, code);
    assert.match(e.message, message, code);
    assert.match(e.next, next, code);
    assert.ok(!/\n/.test(e.message), 'one plain sentence');
  }
  assert.deepEqual(Object.keys(ERRORS).filter((c) => c !== 'VM_E_USAGE').sort(), table.map((t) => t[0]).sort(), 'every code is in the table');
  // No message offers both rebuild and doctor.
  for (const code of Object.keys(ERRORS)) { const e = new VmError(code, { path: '/x' }); assert.ok(!(/rebuild/.test(e.next) && /doctor/.test(e.next)), code); }
  assert.equal(toVmError(Object.assign(new Error('x'), { code: 'ENOSPC' })).code, 'VM_E_DISK_FULL');
  assert.equal(toVmError(new TypeError('oops')).code, 'VM_E_INTERNAL');
});

test('plain numbers and durations', () => {
  assert.equal(num(18400), '18,400');
  assert.equal(duration(1.42), '1.4 s');
  assert.equal(duration(490), '8 min 10 s');
  assert.equal(duration(62), '1 min 2 s');
  assert.equal(eta(300), 'about 5 min left');
  assert.equal(plural(1, 'note'), '1 note');
  assert.equal(plural(1240, 'note'), '1,240 notes');
  assert.equal(skippedSentence([{ path: 'a', reason: 'changing' }]), 'In step: not yet. 1 note was being saved while it was read. Run vault-mirror sync again.');
});

test('--json prints exactly one object and nothing else, also for an error', () => {
  const r = run(['status', '--json']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, '');
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  const body = JSON.parse(lines[0]);
  assert.deepEqual([body.schema, body.ok, body.command, body.version, body.error.code, body.error.exitCode], [1, false, 'status', '0.1.0', 'VM_E_NO_VAULT', 2]);
  assert.ok(body.error.message && body.error.next && Array.isArray(body.warnings));
});

test('human errors: one sentence, one next action, no stack trace', () => {
  const r = run(['sync']);
  assert.equal(r.status, 2);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, 'No vault is set up yet.\nNext: Run `vault-mirror init "<path to your vault>"`.\n');
  const bad = run(['sync', '--no-such-flag']);
  assert.equal(bad.status, 2);
  assert.ok(!/at .*\.js:\d+/.test(bad.stderr), 'no stack trace on screen');
  assert.equal(run(['frobnicate']).status, 2);
  assert.equal(run(['sync', '/some/path']).status, 2, 'sync takes no path');
});

test('--help lists exactly the six commands and makes no saving claim', () => {
  const r = run(['--help']);
  assert.equal(r.status, 0);
  const commands = r.stdout.split('Commands:')[1].split('Options for every command:')[0].trim().split('\n').map((l) => l.trim().split(/\s+/)[0]);
  assert.deepEqual(commands, ['init', 'sync', 'search', 'status', 'rebuild', 'doctor']);
  assert.ok(!/times less|x fewer|instant|hybrid/i.test(r.stdout));
  assert.equal(run(['--version']).stdout, '0.1.0\n');
});
