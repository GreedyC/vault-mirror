// @ts-check
// The built-in exact engine: a plain cosine scan over the sidecar's vectors.
// It is the cross-check for status --verify and doctor, and the automatic fallback.
import { similarity } from './engine.js';

/**
 * @param {Float32Array} vectors      all vectors, one after another
 * @param {(position: number) => string | null} idAt   the id stored at a position, or null when that position is dead
 * @param {number} dimensions
 * @returns {import('./engine.js').Engine}
 */
export function createExact(vectors, idAt, dimensions) {
  const total = Math.floor(vectors.length / dimensions);
  /** @type {(string | null)[]} */
  const ids = Array.from({ length: total }, (_, i) => idAt(i));
  const live = ids.filter(Boolean).length;
  return {
    name: 'exact',
    async insert() { throw new Error('the exact engine reads the sidecar and takes no writes'); },
    async remove() { throw new Error('the exact engine reads the sidecar and takes no writes'); },
    async search(query, k) {
      let qn = 0;
      for (let d = 0; d < dimensions; d++) qn += query[d] * query[d];
      qn = Math.sqrt(qn) || 1;
      /** @type {{ id: string, score: number }[]} */
      const hits = [];
      for (let i = 0; i < total; i++) {
        const id = ids[i];
        if (!id) continue;
        let dot = 0; let n = 0;
        const base = i * dimensions;
        for (let d = 0; d < dimensions; d++) { const v = vectors[base + d]; dot += v * query[d]; n += v * v; }
        hits.push({ id, score: similarity(1 - dot / ((Math.sqrt(n) || 1) * qn)) });
      }
      hits.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
      return hits.slice(0, k);
    },
    async has(id) { return ids.includes(id); },
    async count() { return live; },
    async close() {},
  };
}
