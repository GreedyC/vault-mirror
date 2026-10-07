// @ts-check
// Builds an Embedder from the model table. The rest of the tool talks to this interface only.
import { modelEntry } from './models.js';
import { modelFiles, readIdentity, loadCounter, bytesPresent, isTested } from './model.js';
import { createPool, createStallWatch } from './pool.js';
import { hold, release } from './quiet.js';
import { VmError } from '../errors.js';
import { loadRuvector } from '../engine/ruvector-loader.js';

/**
 * @typedef {object} Embedder
 * @property {string} name
 * @property {number} dimensions
 * @property {number} windowTokens
 * @property {number} budgetTokens
 * @property {string} counterName
 * @property {boolean} modelPresent
 * @property {(known?: Partial<import('./model.js').Identity> | null) => import('./model.js').Identity} identity
 * @property {(opts?: { queries?: string[] }) => Promise<void>} init
 * @property {(text: string) => number} countTokens
 * @property {(texts: string[]) => Promise<(Float32Array | null)[]>} embedPassages
 * @property {(text: string) => Promise<Float32Array>} embedQuery
 * @property {(workers: number) => Promise<void>} startPool
 * @property {() => number} poolWorkers
 * @property {() => Promise<void>} shutdown
 * @property {() => boolean} tested
 */

/**
 * Why a vector may not be stored, or null when it is fine.
 * @param {ArrayLike<number> | null | undefined} vec
 * @param {number} dimensions
 */
export function vectorProblem(vec, dimensions) {
  if (!vec || vec.length !== dimensions) return 'wrong length';
  let anyNonZero = false;
  for (let i = 0; i < vec.length; i++) {
    if (!Number.isFinite(vec[i])) return 'not finite';
    if (vec[i] !== 0) anyNonZero = true;
  }
  return anyNonZero ? null : 'all zero';
}

/**
 * @param {object} opts
 * @param {string} opts.model                          the key in models.js
 * @param {any} [opts.lib]                             the embedding library; tests pass a fake
 * @param {(line: string) => void} [opts.debug]        receives library chatter and events
 * @param {(line: string) => void} [opts.notice]       one-line notices for the person
 * @returns {Embedder}
 */
export function createEmbedder(opts) {
  const entry = modelEntry(opts.model);
  const debug = opts.debug || (() => {});
  const notice = opts.notice || (() => {});
  /** @type {any} */
  let lib = opts.lib || null;
  /** @type {ReturnType<typeof loadCounter> | null} */
  let counter = null;
  /** @type {import('./model.js').Identity | null} */
  let id = null;
  let ready = false;
  /** @type {any} */
  let initError = null;
  /** @type {ReturnType<typeof createPool> | null} */
  let pool = null;
  let poolErrors = 0;
  let poolSize = 0;
  /** @type {ReturnType<typeof createStallWatch> | null} */
  let stall = null;

  /** Translate the library's two raw errors. They are never shown. @param {any} e */
  function translate(e) {
    const text = String(e && e.message ? e.message : e);
    debug(`embedder error: ${text.slice(0, 200)}`);
    if (/fetch failed\s*$/.test(text)) return new VmError('VM_E_MODEL_OFFLINE');
    if (/undefined\s*$/.test(text)) return new VmError('VM_E_MODEL_BROKEN', { path: modelFiles(entry).dir });
    return e;
  }

  /** Let the library download while a watchdog watches the folder grow. */
  async function initWithWatchdog(/** @type {number} */ maxLength) {
    const files = modelFiles(entry);
    const missing = !files.modelStat || !files.tokenizerStat;
    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {Promise<never> | null} */
    let stalled = null;
    if (missing) {
      notice(`Downloading the reading model once (about ${entry.downloadMB} MB). After this, everything runs on your computer.`);
      let lastBytes = bytesPresent(files.dir); let lastGrowth = Date.now();
      stalled = new Promise((_, reject) => {
        timer = setInterval(() => {
          const now = bytesPresent(files.dir);
          if (now > lastBytes) { lastBytes = now; lastGrowth = Date.now(); notice(`Downloaded ${Math.round(now / 1e6)} MB so far.`); }
          else if (Date.now() - lastGrowth > 60000) reject(new VmError('VM_E_MODEL_OFFLINE'));
        }, 5000);
      });
    }
    try {
      const work = lib.initOnnxEmbedder({ maxLength });
      await (stalled ? Promise.race([work, stalled]) : work);
    } finally { if (timer) clearInterval(timer); }
  }

  /** @type {Embedder} */
  const embedder = {
    name: entry.name,
    dimensions: entry.dimensions,
    windowTokens: entry.windowTokens,
    budgetTokens: entry.budgetTokens,
    counterName: entry.counter,
    get modelPresent() { const f = modelFiles(entry); return Boolean(f.modelStat && f.tokenizerStat); },

    identity(known) {
      if (!id) id = readIdentity(entry, known);
      return id;
    },

    tested() { return isTested(entry, embedder.identity()); },

    async init(o = {}) {
      if (ready) return;
      if (initError) throw initError; // the library caches a failed init; a second try cannot succeed
      hold(debug);
      try {
        if (!lib) lib = loadRuvector();
        let maxLength = entry.maxLength;
        if (o.queries && o.queries.length && embedder.modelPresent) {
          // A question is short. A smaller padding gives the same vector for less work.
          const longest = Math.max(...o.queries.map((q) => embedder.countTokens(entry.queryLead + q)));
          for (const pad of [16, 32, 64]) if (longest + 2 <= pad && pad < maxLength) { maxLength = pad; break; }
        }
        await initWithWatchdog(maxLength);
        id = null;
        const now = embedder.identity(); // hash check of both files before first use
        if (now.modelSize < 1024 * 1024) throw new VmError('VM_E_MODEL_BROKEN', { path: modelFiles(entry).dir });
        ready = true;
      } catch (e) {
        initError = translate(e);
        release();
        throw initError;
      }
    },

    countTokens(text) {
      if (!counter) counter = loadCounter(entry);
      return counter.count(text);
    },

    async startPool(workers) {
      if (!ready) await embedder.init();
      if (workers < 1 || pool) return;
      poolSize = workers;
      pool = createPool(lib, workers);
      stall = createStallWatch();
      await pool.start();
    },

    poolWorkers() { return pool && pool.running ? poolSize : 0; },

    async embedPassages(texts) {
      if (!ready) await embedder.init();
      const leadTexts = entry.passageLead ? texts.map((t) => entry.passageLead + t) : texts;
      /** @type {ArrayLike<number>[] | null} */
      let raw = null;
      if (pool && pool.running) {
        for (let attempt = 0; attempt < 2 && !raw && pool; attempt++) {
          try { raw = await pool.embed(leadTexts); }
          catch (e) {
            // Never keep using a pool after an error: a late reply could pair a vector with the wrong text.
            const afterStall = stall ? stall.recentlyStalled() : false;
            debug(`pool error (${afterStall ? 'after a stall, not counted' : 'counted'}): ${String(/** @type {any} */ (e)?.message).slice(0, 160)}`);
            await pool.stop();
            if (!afterStall) poolErrors++;
            if (poolErrors >= 2) { pool = null; notice('The readers had trouble twice. Finishing with one reader.'); }
            else { pool = createPool(lib, poolSize); await pool.start(); }
          }
        }
      }
      if (!raw) {
        raw = [];
        for (const t of leadTexts) raw.push((await lib.embed(t)).embedding);
      }
      /** @type {(Float32Array | null)[]} */
      const out = [];
      for (let i = 0; i < leadTexts.length; i++) {
        let vec = raw[i];
        if (vectorProblem(vec, entry.dimensions)) {
          debug(`vector rejected (${vectorProblem(vec, entry.dimensions)}); trying once more with one reader`);
          try { vec = (await lib.embed(leadTexts[i])).embedding; } catch { vec = /** @type {any} */ (null); }
        }
        out.push(vectorProblem(vec, entry.dimensions) ? null : Float32Array.from(/** @type {ArrayLike<number>} */ (vec)));
      }
      return out;
    },

    async embedQuery(text) {
      if (!ready) await embedder.init({ queries: [text] });
      const vec = (await lib.embedQuery(entry.queryLead + text)).embedding;
      const problem = vectorProblem(vec, entry.dimensions);
      if (problem) throw new Error(`question vector ${problem}`);
      return Float32Array.from(vec);
    },

    async shutdown() {
      const p = pool; pool = null;
      if (stall) { stall.stop(); stall = null; }
      try { if (p) await p.stop(); } finally { release(); }
    },
  };
  return embedder;
}

/**
 * Run work with an embedder and always shut it down afterwards: on success, on any thrown
 * error and on a safety stop. A pool left running would keep the command from ever returning.
 * @template T
 * @param {Embedder} embedder
 * @param {() => Promise<T>} work
 * @returns {Promise<T>}
 */
export async function withEmbedder(embedder, work) {
  try { return await work(); } finally { await embedder.shutdown(); }
}
