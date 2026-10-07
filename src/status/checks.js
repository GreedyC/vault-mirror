// @ts-check
// What "in step" means, and how it is proved. Each line is a named check.
import path from 'node:path';
import { loadManifest } from '../store/manifest.js';
import { scanLog } from '../store/sidecar.js';
import { liveOwner } from '../store/lock.js';
import { planOnly, chunkerBlock, engineBlock } from '../sync/run.js';
import { readProgress } from '../sync/progress.js';
import { syncWouldStop } from '../sync/plan.js';
import { ensureEngine, engineStamp, exactFromSidecar } from '../engine/build.js';
import { probeEngineFile } from '../engine/probe.js';
import { passageId } from '../engine/engine.js';
import { createEmbedder } from '../embed/embedder.js';
import { sameIdentity } from '../embed/model.js';
import { readVectors } from '../store/sidecar.js';
import { debug } from '../log.js';
import { TOOL_VERSION, CHUNKER_VERSION } from '../version.js';

const LEFT_OUT_KEYS = { excluded: 'excluded', 'obsidian-excluded': 'obsidianExcluded', 'index-false': 'indexFalse', empty: 'empty', 'not-downloaded': 'notDownloaded', symlink: 'symlink', 'nested-vault': 'nestedVault', 'duplicate-path': 'duplicatePath' };

/**
 * @param {import('../sync/run.js').Context} ctx
 * @param {{ verify?: boolean, engine?: import('../engine/engine.js').Engine }} opts
 * @param {import('../cli/output.js').Ui} ui
 */
export async function computeStatus(ctx, opts, ui) {
  const loaded = loadManifest(ctx.indexDir);
  const manifest = loaded ? loaded.manifest : null;
  const embedder = createEmbedder({ model: ctx.cfg.embedding.model, debug });
  const { plan } = await planOnly(ctx, { shallow: true, verify: opts.verify, embedder, manifest });
  for (const w of plan.warnings) ui.warn(w);

  /** @type {Record<string, number>} */
  const leftOut = { excluded: 0, obsidianExcluded: 0, indexFalse: 0, empty: 0, notDownloaded: 0, symlink: 0, nestedVault: 0, duplicatePath: 0 };
  for (const [reason, n] of Object.entries(plan.leftOut)) leftOut[/** @type {Record<string, string>} */ (LEFT_OUT_KEYS)[reason] || reason] = n;
  const leftOutTotal = Object.values(plan.leftOut).reduce((a, b) => a + b, 0);
  const notesIndexed = manifest ? manifest.totals.notes : 0;
  const passagesRecorded = manifest ? manifest.totals.passages : 0;
  const owner = liveOwner(path.join(ctx.indexDir, 'sync.lock'));
  const progress = owner ? readProgress(ctx.indexDir) : null;
  const running = owner ? { pid: owner.pid, percent: progress ? progress.percent : 0, etaSeconds: progress ? progress.etaSeconds : null } : null;

  // The engine: count it through the child-process probe; bring it in step when it is behind.
  let passagesInEngine = 0; let engineCurrent = false;
  /** @type {import('../engine/engine.js').Engine | null} */
  let engine = null;
  if (loaded && manifest && passagesRecorded > 0 && opts.engine) {
    // This process already holds the engine open (a rebuild just made it): count it directly.
    engine = opts.engine;
    passagesInEngine = await engine.count();
    engineCurrent = engineStamp(ctx.indexDir)?.stamp === manifest.stamp || engine.name === 'exact';
  } else if (loaded && manifest && passagesRecorded > 0) {
    const stamp = engineStamp(ctx.indexDir);
    const dimensions = Number(manifest.embedding.dimensions);
    let needLoad = Boolean(opts.verify) || !stamp || stamp.stamp !== manifest.stamp;
    if (!needLoad && stamp) {
      const probe = await probeEngineFile(path.join(ctx.indexDir, 'engine', stamp.file), dimensions);
      if (probe.ok && probe.flat && probe.count === passagesRecorded) { passagesInEngine = probe.count; engineCurrent = true; } else needLoad = true;
    }
    if (needLoad && !running) {
      try {
        const r = await ensureEngine({ indexDir: ctx.indexDir, loaded, dimensions });
        for (const n of r.notices) ui.warn(n);
        for (const w of r.warnings) ui.warnings.push(w);
        engine = r.engine;
        passagesInEngine = await r.engine.count();
        engineCurrent = r.how !== 'exact' || passagesInEngine === passagesRecorded;
      } catch (e) { debug(`status could not load the engine: ${String(/** @type {any} */ (e)?.message).slice(0, 160)}`); }
    }
  }

  const pendingTotal = plan.pending.new + plan.pending.changed + plan.pending.removed;
  const sumPassages = manifest ? Object.values(manifest.notes).reduce((n, e) => n + e.passages, 0) : 0;
  let versionsOk = false;
  if (manifest) {
    const nowChunker = chunkerBlock(ctx, embedder);
    let modelOk = true;
    if (embedder.modelPresent) { try { modelOk = sameIdentity(manifest.embedding, embedder.identity(manifest.embedding)); } catch { modelOk = false; } }
    const nowEngine = engineBlock();
    versionsOk = manifest.chunker.version === nowChunker.version && manifest.chunker.settingsHash === nowChunker.settingsHash && modelOk
      && manifest.engine.version === nowEngine.version && manifest.engine.core === nowEngine.core && manifest.engine.native === nowEngine.native;
  }
  /** @type {{ name: string, ok: boolean, detail: string }[]} */
  const checks = [
    { name: 'disk-matches-manifest', ok: Boolean(manifest) && plan.pending.new === 0 && plan.pending.removed === 0, detail: `${plan.eligible} notes on disk belong in the index; the index lists ${notesIndexed}` },
    { name: 'nothing-pending', ok: pendingTotal === 0, detail: `new ${plan.pending.new}, changed ${plan.pending.changed}, removed ${plan.pending.removed} (${opts.verify ? 'every note hashed' : 'by size and date'})` },
    { name: 'nothing-skipped', ok: plan.skipped.length === 0 && (!manifest || !manifest.lastRun || (manifest.lastRun.counts.skipped || 0) === 0 || pendingTotal === 0), detail: `${plan.skipped.length} could not be read` },
    { name: 'counts-add-up', ok: plan.seen === notesIndexed + leftOutTotal, detail: `${plan.seen} on disk, ${notesIndexed} in the index, ${leftOutTotal} left out` },
    { name: 'passages-match', ok: Boolean(manifest) && sumPassages === passagesRecorded && passagesRecorded === passagesInEngine, detail: `${sumPassages} summed, ${passagesRecorded} recorded, ${passagesInEngine} in the engine` },
    { name: 'engine-current', ok: engineCurrent || passagesRecorded === 0, detail: engineCurrent ? 'the engine was built from this manifest' : 'the engine is behind the manifest' },
    { name: 'no-old-text', ok: Boolean(manifest) && manifest?.sidecar.deadRecords === 0, detail: `${manifest ? manifest.sidecar.deadRecords : 0} old records waiting for the next sync` },
    { name: 'versions-match', ok: versionsOk, detail: versionsOk ? 'chunker, model and engine are the ones the index was made with' : 'the tool, model or engine changed since the index was made' },
  ];

  if (opts.verify && loaded && manifest && engine) {
    const dimensions = Number(manifest.embedding.dimensions);
    let idsOk = true; let missing = 0;
    for (const [key, e] of Object.entries(manifest.notes)) {
      for (let i = 0; i < e.passages; i++) if (!(await engine.has(passageId(key, i)))) { idsOk = false; missing++; }
      if (await engine.has(passageId(key, e.passages))) { idsOk = false; missing++; }
    }
    checks.push({ name: 'verify-every-id', ok: idsOk, detail: idsOk ? 'every passage id is in the engine and no extra one is' : `${missing} ids differ` });
    const exact = exactFromSidecar(loaded, dimensions);
    const vectors = readVectors(loaded.dataDir, manifest.sidecar.vectors, dimensions);
    const total = manifest.sidecar.vectors; let agree = 0; let tried = 0;
    for (let s = 0; s < 50 && total > 0; s++) {
      const at = Math.floor((s * total) / 50);
      const q = vectors.slice(at * dimensions, (at + 1) * dimensions);
      // Compared by score, not by id: two notes that hold the same sentence have the same vector,
      // and either one may fill the last place.
      const a = await engine.search(q, 10); const b = await exact.search(q, 10);
      tried++; if (a.length === b.length && a.every((h, i) => Math.abs(h.score - b[i].score) < 1e-4)) agree++;
    }
    checks.push({ name: 'verify-spot-check', ok: agree === tried, detail: `${agree} of ${tried} sampled searches agree with an exact scan (a spot-check)` });
    const scan = scanLog(loaded.dataDir, 0, manifest.sidecar.logBytes);
    const recordsOk = scan.goodBytes === manifest.sidecar.logBytes && scan.records.every((r) => r.rec.op !== 'put' || r.rec.passages.every((/** @type {any} */ p) => p.vec < manifest.sidecar.vectors));
    checks.push({ name: 'verify-sidecar', ok: recordsOk, detail: recordsOk ? 'every saved record parses and points at vectors that exist' : 'a saved record is damaged' });
  }

  const inStep = checks.every((c) => c.ok) && !running;
  const indexLooksWrong = checks.some((c) => !c.ok && ['passages-match', 'engine-current', 'no-old-text'].includes(c.name) || (!c.ok && c.name.startsWith('verify-')));
  const versions = { tool: TOOL_VERSION, ...(() => { const e = engineBlock(); return { ruvector: e.version, core: e.core, native: e.native }; })(), model: manifest ? manifest.embedding.model : ctx.cfg.embedding.model, chunker: CHUNKER_VERSION };
  return {
    inStep,
    counts: { notesOnDisk: plan.seen, leftOut, otherFiles: plan.otherFiles, eligible: plan.eligible, notesIndexed, passagesRecorded, passagesInEngine, pending: plan.pending, unreadable: plan.skipped.length },
    checks, running, lastSync: manifest ? manifest.lastRun : null, versions,
    // Not part of the JSON contract: used for the human view.
    _plan: plan, _stop: syncWouldStop(plan, manifest, { vaultPath: ctx.vault.real }), _leftOutTotal: leftOutTotal, _indexLooksWrong: indexLooksWrong && pendingTotal === 0, _verify: Boolean(opts.verify), _manifest: manifest, _dataDir: loaded ? loaded.dataDir : null,
  };
}
