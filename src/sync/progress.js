// @ts-check
// progress.json: rewritten every 2 s during a sync so status and a waiting second run can show it.
// It holds counts only, never a note name.
import fs from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, remove } from '../store/safe-write.js';
import { pidAlive } from '../store/lock.js';

/** @param {string} indexDir */
export function progressPath(indexDir) { return path.join(indexDir, 'progress.json'); }

/**
 * @param {string} indexDir
 * @param {{ notesTotal: number, passagesTotal: number }} totals
 */
export function createProgress(indexDir, totals) {
  const startedAt = Date.now();
  let lastWrite = 0;
  const state = { pid: process.pid, startedAt, phase: 'reading', notesDone: 0, notesTotal: totals.notesTotal, passagesDone: 0, passagesTotal: totals.passagesTotal, rate: 0, etaSeconds: /** @type {number | null} */ (null), updatedAt: startedAt };
  return {
    state,
    /** @param {{ notesDone: number, passagesDone: number, phase?: string }} p @param {boolean} [force] */
    update(p, force) {
      Object.assign(state, p);
      const now = Date.now();
      const elapsed = (now - startedAt) / 1000;
      state.rate = elapsed > 0 ? state.passagesDone / elapsed : 0;
      state.etaSeconds = state.rate > 0 ? Math.round((state.passagesTotal - state.passagesDone) / state.rate) : null;
      state.updatedAt = now;
      if (force || now - lastWrite >= 2000) {
        lastWrite = now;
        try { writeFileAtomic(progressPath(indexDir), JSON.stringify(state)); } catch { /* progress must never stop a sync */ }
      }
    },
    done() { try { remove(progressPath(indexDir)); } catch { /* fine */ } },
  };
}

/**
 * The progress of a sync that is running right now, or null.
 * @param {string} indexDir
 * @returns {{ pid: number, percent: number, etaSeconds: number | null, passagesDone: number, passagesTotal: number } | null}
 */
export function readProgress(indexDir) {
  try {
    const p = JSON.parse(fs.readFileSync(progressPath(indexDir), 'utf8'));
    if (!pidAlive(p.pid)) return null;
    return { pid: p.pid, percent: p.passagesTotal > 0 ? Math.floor((p.passagesDone / p.passagesTotal) * 100) : 0, etaSeconds: p.etaSeconds, passagesDone: p.passagesDone, passagesTotal: p.passagesTotal };
  } catch { return null; }
}
