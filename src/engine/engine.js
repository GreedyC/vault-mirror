// @ts-check
// The storage engine interface. Nothing outside src/engine/ knows which engine is in use.

/**
 * @typedef {{ id: string, vector: Float32Array }} Row
 * @typedef {{ id: string, score: number }} Hit        score = similarity, higher is better
 * @typedef {object} Engine
 * @property {string} name
 * @property {(rows: Row[]) => Promise<void>} insert
 * @property {(ids: string[]) => Promise<void>} remove
 * @property {(vector: Float32Array, k: number) => Promise<Hit[]>} search
 * @property {(id: string) => Promise<boolean>} has
 * @property {() => Promise<number>} count
 * @property {() => Promise<void>} close               a no-op for ruvector: its lock frees at exit
 */

/** The one place a cosine distance becomes a similarity: 1 - distance, kept within 0..1. @param {number} distance */
export function similarity(distance) {
  const s = 1 - distance;
  return s < 0 ? 0 : s > 1 ? 1 : s;
}

/** @param {string} notePath @param {number} n */
export function passageId(notePath, n) { return `${notePath}#${n}`; }

/** Split an id at its last '#'. @param {string} id @returns {{ path: string, n: number }} */
export function parseId(id) {
  const at = id.lastIndexOf('#');
  return { path: id.slice(0, at), n: Number(id.slice(at + 1)) };
}
