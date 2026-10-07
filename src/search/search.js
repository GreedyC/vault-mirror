// @ts-check
// Search: ask the index, return the best passage of each note with a way back to the note.
import path from 'node:path';
import { loadManifest } from '../store/manifest.js';
import { readRecord } from '../store/sidecar.js';
import { liveOwner } from '../store/lock.js';
import { ensureEngine } from '../engine/build.js';
import { parseId } from '../engine/engine.js';
import { createEmbedder } from '../embed/embedder.js';
import { lookupVault } from '../vault/obsidian-registry.js';
import { buildLink } from './link.js';
import { maskSecrets } from '../screen/screen.js';
import { runSync } from '../sync/run.js';
import { readProgress } from '../sync/progress.js';
import { VmError } from '../errors.js';
import { debug, runLine, setLogDir } from '../log.js';
import { plural } from '../cli/output.js';

/** At most `max` characters, whitespace collapsed, never cut inside a word. @param {string} text @param {number} [max] */
export function snippet(text, max = 400) {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max + 1);
  const at = cut.lastIndexOf(' ');
  return (at > 0 ? cut.slice(0, at) : flat.slice(0, max)).trimEnd();
}

/**
 * Keep the best passage per note, across one or several phrasings of the question.
 * @param {import('../engine/engine.js').Hit[][]} hitLists   one list per phrasing
 * @param {(id: string) => boolean} known                    false for ids the manifest does not know
 * @returns {{ path: string, n: number, score: number, morePassages: number }[]}  best first
 */
export function collapse(hitLists, known) {
  /** @type {Map<string, { n: number, score: number, seen: Set<number> }>} */
  const byNote = new Map();
  for (const hits of hitLists) {
    for (const h of hits) {
      if (!known(h.id)) continue;
      const { path: p, n } = parseId(h.id);
      const cur = byNote.get(p);
      if (!cur) byNote.set(p, { n, score: h.score, seen: new Set([n]) });
      else { cur.seen.add(n); if (h.score > cur.score) { cur.score = h.score; cur.n = n; } }
    }
  }
  return [...byNote.entries()].map(([p, v]) => ({ path: p, n: v.n, score: v.score, morePassages: v.seen.size - 1 }))
    .sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
}

/**
 * Fetch, collapse, and fetch four times as many once when one long note crowds the hits.
 * @param {import('../engine/engine.js').Engine} engine
 * @param {Float32Array[]} vectors
 * @param {number} count
 * @param {(id: string) => boolean} known
 */
export async function fetchNotes(engine, vectors, count, known) {
  let k = Math.max(count * 8, 50);
  for (let round = 0; ; round++) {
    const lists = [];
    let full = false;
    for (const v of vectors) { const hits = await engine.search(v, k); if (hits.length >= k) full = true; lists.push(hits); }
    const notes = collapse(lists, known);
    if (notes.length >= count || !full || round === 1) return notes.slice(0, count);
    k *= 4;
  }
}

/**
 * @param {import('../sync/run.js').Context} ctx
 * @param {{ queries: string[], count?: number, noSync?: boolean }} opts
 * @param {import('../cli/output.js').Ui} ui
 */
export async function runSearch(ctx, opts, ui) {
  const t0 = performance.now();
  const timings = { syncMs: 0, modelAndEmbedMs: 0, engineMs: 0, probeMs: 0, searchMs: 0, readMs: 0 };
  const v = /** @type {NonNullable<typeof ctx.cfg.vault>} */ (ctx.cfg.vault);
  const count = Math.max(1, Math.min(50, opts.count ?? v.resultCount));
  setLogDir(path.join(ctx.indexDir, 'logs'));
  let loaded = loadManifest(ctx.indexDir);
  if (!loaded || loaded.manifest.totals.passages === 0) throw new VmError('VM_E_NOT_SYNCED');

  // A quick sync first, only when the waiting work is small.
  /** @type {string | null} */
  let syncNotice = null; let inStep = false;
  const running = liveOwner(path.join(ctx.indexDir, 'sync.lock'));
  if (running) {
    const p = readProgress(ctx.indexDir);
    syncNotice = `A sync is running${p ? ` (${p.percent}% done)` : ''}. This search covers what is saved so far.`;
  } else if (!opts.noSync) {
    const quiet = { ...ui, out() {}, info() {}, progress() {}, progressEnd() {} };
    try {
      const r = /** @type {any} */ (await runSync(ctx, { quickMaxPassages: v.searchAutoSyncMaxPassages }, quiet));
      if (r.deferred) syncNotice = r.waiting ? `${plural(r.waiting, 'note')} ${r.waiting === 1 ? 'is' : 'are'} waiting to sync. This search covers what is indexed so far. Next: vault-mirror sync --detach` : 'The index needs a sync. This search covers what is indexed so far. Next: vault-mirror sync --detach';
      else { inStep = r.nothing ? true : Boolean(r.inStep); loaded = loadManifest(ctx.indexDir) || loaded; }
    } catch (e) {
      if (e instanceof VmError && (e.code === 'VM_E_BUSY' || e.code === 'VM_E_LOCK_LOST')) syncNotice = 'A sync is running. This search covers what is saved so far.';
      else if (e instanceof VmError && e.exitCode === 4) syncNotice = `${e.message} This search covers what is indexed so far.`;
      else throw e;
    }
  }
  timings.syncMs = Math.round(performance.now() - t0);
  const { manifest, dataDir } = loaded;
  const dimensions = Number(manifest.embedding.dimensions);

  // The engine probe runs in a child process while this process loads the model and reads the question.
  let t = performance.now();
  const enginePromise = ensureEngine({ indexDir: ctx.indexDir, loaded: { manifest, dataDir }, dimensions });
  enginePromise.catch(() => {}); // handled below
  const embedder = createEmbedder({ model: String(manifest.embedding.model), debug, notice: (line) => ui.info(line) });
  /** @type {Float32Array[]} */
  const vectors = [];
  try {
    await embedder.init({ queries: opts.queries });
    for (const q of opts.queries) vectors.push(await embedder.embedQuery(q));
  } finally { await embedder.shutdown(); }
  timings.modelAndEmbedMs = Math.round(performance.now() - t);
  t = performance.now();
  const eng = await enginePromise;
  timings.engineMs = Math.round(performance.now() - t); timings.probeMs = eng.probeMs;
  for (const n of eng.notices) ui.warn(n);
  for (const w of eng.warnings) ui.warnings.push(w);

  t = performance.now();
  const known = (/** @type {string} */ id) => { const { path: p, n } = parseId(id); const e = manifest.notes[p]; return Boolean(e) && n >= 0 && n < e.passages; };
  const notes = await fetchNotes(eng.engine, vectors, count, known);
  timings.searchMs = Math.round(performance.now() - t);

  t = performance.now();
  const registry = lookupVault(ctx.vault.real);
  if (registry.state !== 'registered' && !(registry.state === 'no-list' && registry.vaultParam)) ui.warn('Open this folder as a vault in Obsidian once, and links will work.');
  const results = notes.map((hit, i) => {
    const rec = readRecord(dataDir, manifest.notes[hit.path].log);
    const p = rec.passages[hit.n];
    const text = maskSecrets(p.text);
    return {
      rank: i + 1,
      score: Math.round(hit.score * 1000) / 1000,
      note: (hit.path.split('/').pop() || '').replace(/\.md$/i, ''),
      section: p.trail.join(' > '),
      path: path.join(ctx.vault.real, ...hit.path.split('/')),
      vaultPath: hit.path,
      line: p.line,
      link: buildLink({ vaultParam: registry.vaultParam, vaultPath: hit.path, heads: p.heads || [], repeats: Boolean(p.rep), recovered: Boolean(p.recovered) }),
      snippet: snippet(text),
      text,
      passage: `${hit.path}#${hit.n}`,
      morePassages: hit.morePassages,
      flags: p.flags || [],
    };
  });
  timings.readMs = Math.round(performance.now() - t);
  const tookMs = Math.round(performance.now() - t0);
  runLine('search', { results: results.length, phrasings: opts.queries.length, ms: tookMs }); // never the question text
  return { query: opts.queries[0], queries: opts.queries, results, searched: { notes: manifest.totals.notes, passages: manifest.totals.passages }, inStep, syncNotice, tookMs, timings, engine: eng.engine.name };
}
