// @ts-check
// The flat self-test, run on every newly created engine file before any row is loaded.
// It is the guard against a future ruvector release changing what "no hnswConfig" means.
import { fileIsFlat } from './ruvector-flat.js';

const PROBE_ID = '__vault-mirror-selftest__';

/** @param {number} dimensions @param {number} hot */
function unit(dimensions, hot) {
  const v = new Float32Array(dimensions);
  v[hot % dimensions] = 1;
  return v;
}

/**
 * Throws with code VM_E_ENGINE_NOT_FLAT when any part fails.
 * @param {import('./engine.js').Engine} engine
 * @param {number} dimensions
 * @param {(() => boolean) | string} flatCheck   the file to inspect, or a function (tests)
 */
export async function flatSelfTest(engine, dimensions, flatCheck) {
  const fail = (/** @type {string} */ why) => Object.assign(new Error(`engine self-test failed: ${why}`), { code: 'VM_E_ENGINE_NOT_FLAT' });
  const isFlat = typeof flatCheck === 'function' ? flatCheck() : fileIsFlat(flatCheck);
  if (!isFlat) throw fail('the file does not say it is flat');
  const first = unit(dimensions, 0); const second = unit(dimensions, 1);
  await engine.insert([{ id: PROBE_ID, vector: first }]);
  await engine.insert([{ id: PROBE_ID, vector: second }]);
  const hits = await engine.search(second, 3);
  const mine = hits.filter((h) => h.id === PROBE_ID);
  if (mine.length !== 1) throw fail(`one id came back ${mine.length} times`);
  if (mine[0].score < 0.999) throw fail('a replaced vector was still the one found');
  if ((await engine.count()) !== 1) throw fail('count after inserting one id twice was not 1');
  await engine.remove([PROBE_ID]);
  if ((await engine.count()) !== 0) throw fail('count after a delete was not 0');
}
