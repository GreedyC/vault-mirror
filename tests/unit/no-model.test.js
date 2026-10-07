import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir } from '../helpers/tmp.mjs';

// The unit tests are "no model, no engine": they must pass on a computer (or a CI runner) that has
// never downloaded the reading model. This runs every other unit test file with an empty home folder.
test('every unit test passes with no reading model on this computer', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(here).filter((f) => f.endsWith('.test.js') && f !== path.basename(fileURLToPath(import.meta.url))).map((f) => path.join(here, f));
  const emptyHome = tmpDir('no-model-home');
  const env = { ...process.env, HOME: emptyHome, USERPROFILE: emptyHome };
  delete env.RUVECTOR_CACHE_DIR;
  delete env.NODE_TEST_CONTEXT; // the child is its own test run, not a part of this one
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...files], { encoding: 'utf8', env });
  const failed = r.stdout.split('\n').filter((l) => /^\s*not ok /.test(l)).map((l) => l.trim());
  assert.deepEqual(failed, [], 'these tests need the real model');
  assert.equal(r.status, 0, r.stderr.slice(0, 2000));
  assert.ok(!fs.existsSync(path.join(emptyHome, '.ruvector')), 'and nothing tried to download it');
});
