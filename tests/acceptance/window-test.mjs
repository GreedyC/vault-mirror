#!/usr/bin/env node
// The window test: proves the token counter against the real reading model.
// For the densest passages of a vault, the real token count of prefix plus body must be
// within the model's window for every one, and changing the last word of each must change
// its vector. One failure fails the test.
//
//   node tests/acceptance/window-test.mjs <vault> [sample-size]
import path from 'node:path';
import { walkVault } from '../../src/vault/walk.js';
import { readBytes } from '../../src/vault/read-only-fs.js';
import { chunk } from '../../src/chunker/index.js';
import { createEmbedder } from '../../src/embed/embedder.js';
import { VAULT_DEFAULTS } from '../../src/config/config.js';
import { DEFAULT_MODEL } from '../../src/embed/models.js';
import { writeOut } from '../../src/embed/quiet.js';

const vault = path.resolve(process.argv[2]);
const sampleSize = Number(process.argv[3] || 200);
const embedder = createEmbedder({ model: DEFAULT_MODEL });
const walk = walkVault(vault, {});
const names = new Map();
for (const n of walk.notes) { const b = (n.key.split('/').pop() || '').toLowerCase(); names.set(b, (names.get(b) || 0) + 1); }
/** @type {{ text: string, tokens: number }[]} */
const all = [];
for (const note of walk.notes) {
  const fip = (names.get((note.key.split('/').pop() || '').toLowerCase()) || 0) > 1;
  const c = chunk(await readBytes(note.abs), note.key, { countTokens: embedder.countTokens, budgetTokens: embedder.budgetTokens, minWords: VAULT_DEFAULTS.minWords, dropFences: VAULT_DEFAULTS.dropFences, folderInPrefix: fip });
  for (const p of c.passages) all.push({ text: p.embedText, tokens: embedder.countTokens(p.embedText) });
}
all.sort((a, b) => b.tokens - a.tokens || (a.text < b.text ? -1 : 1)); // the densest first
const sample = all.slice(0, sampleSize);
const withinWindow = sample.filter((s) => s.tokens <= embedder.windowTokens).length;
const overBudget = all.filter((s) => s.tokens > embedder.budgetTokens).length;
const changed = sample.map((s) => {
  const m = /(\S+)(\s*)$/.exec(s.text);
  const swap = m && m[1].toLowerCase() === 'zebra' ? 'giraffe' : 'zebra';
  return m ? s.text.slice(0, m.index) + swap + m[2] : `${s.text} zebra`;
});
let lastWordSeen = 0;
try {
  await embedder.startPool(Math.min(4, Number(process.env.VM_WINDOW_WORKERS || 4)));
  for (let i = 0; i < sample.length; i += 32) {
    const a = await embedder.embedPassages(sample.slice(i, i + 32).map((s) => s.text));
    const b = await embedder.embedPassages(changed.slice(i, i + 32));
    a.forEach((v, k) => { const w = b[k]; if (v && w && v.some((x, d) => Math.abs(x - w[d]) > 1e-7)) lastWordSeen++; });
  }
} finally { await embedder.shutdown(); }
const out = { available: all.length, sampled: sample.length, withinWindow, lastWordSeen, overBudget, maxTokens: sample.length ? sample[0].tokens : 0, minTokens: sample.length ? sample[sample.length - 1].tokens : 0, budgetTokens: embedder.budgetTokens, windowTokens: embedder.windowTokens };
writeOut(JSON.stringify(out) + '\n');
process.exit(withinWindow === sample.length && lastWordSeen === sample.length && overBudget === 0 ? 0 : 1);
