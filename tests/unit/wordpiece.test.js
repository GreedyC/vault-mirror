import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createWordPiece } from '../../src/embed/wordpiece.js';
import { MODELS, DEFAULT_MODEL, modelEntry } from '../../src/embed/models.js';
import { modelFiles } from '../../src/embed/model.js';
import { tinyTokenizer } from '../helpers/tmp.mjs';

test('pinned counts with a tiny invented vocabulary', () => {
  const wp = createWordPiece(tinyTokenizer());
  assert.deepEqual(wp.tokenize('The garden is behind the house.'), ['the', 'garden', 'is', 'behind', 'the', 'house', '.']);
  assert.deepEqual(wp.tokenize('watering waters'), ['water', '##ing', 'water', '##s']);
  assert.deepEqual(wp.tokenize('| a | b | c |'), ['|', 'a', '|', 'b', '|', 'c', '|']); // a table row
  assert.deepEqual(wp.tokenize('ETH/USDT'), ['eth', '/', 'usd', '##t']); // a ticker
  assert.deepEqual(wp.tokenize('$4.75'), ['$', '4', '.', '75']); // a price
  assert.deepEqual(wp.tokenize('9f86'), ['[UNK]']); // a hex word with a piece missing from the vocabulary is one unknown token
  assert.deepEqual(wp.tokenize('abc'), ['a', '##b', '##c']);
  assert.deepEqual(wp.tokenize('Café CAFÉ'), ['cafe', 'cafe']); // accents stripped, lower-cased
  assert.deepEqual(wp.tokenize('庭園'), ['庭', '園']); // CJK characters are split one by one
  assert.equal(wp.count('x'.repeat(200)), 1); // a 200-character word is one unknown token
  assert.equal(wp.count(''), 0);
  assert.equal(wp.count('the​garden'), 1, 'a zero-width space is removed, giving one unknown word');
});

test('the counter refuses a tokenizer file it does not understand', () => {
  assert.throws(() => createWordPiece({ model: { type: 'BPE', vocab: {} } }), /WordPiece/);
  assert.throws(() => createWordPiece({ model: { type: 'WordPiece', vocab: { a: 0 } }, normalizer: { type: 'Sequence' } }), /normaliser/);
  assert.throws(() => createWordPiece(null), /WordPiece/);
  assert.throws(() => createWordPiece({}), /WordPiece/);
});

test('the model table has one default entry with a budget below its window', () => {
  const entry = modelEntry(DEFAULT_MODEL);
  assert.ok(entry.budgetTokens < entry.windowTokens);
  assert.equal(entry.windowTokens + 2, entry.maxLength);
  assert.equal(Object.keys(MODELS).length, 1);
  assert.throws(() => modelEntry('no-such-model'), /Unknown reading model/);
});

test('pinned counts with the real vocabulary, when the model is on this computer', (t) => {
  const f = modelFiles(modelEntry(DEFAULT_MODEL));
  if (!f.tokenizerStat) return t.skip('the model is not cached here');
  const wp = createWordPiece(JSON.parse(fs.readFileSync(path.join(f.dir, 'tokenizer.json'), 'utf8')));
  const pins = JSON.parse(fs.readFileSync(new URL('../fixtures/token-pins.json', import.meta.url), 'utf8'));
  for (const [text, n] of pins) assert.equal(wp.count(text), n, text);
});
