// @ts-check
// The reading model's files on disk. vault-mirror only reads and stats them; the library downloads them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { VmError } from '../errors.js';
import { createWordPiece } from './wordpiece.js';

/** Where the library keeps a model. @param {import('./models.js').ModelEntry} entry */
export function modelDir(entry) {
  const base = process.env.RUVECTOR_CACHE_DIR || process.env.HOME || process.env.USERPROFILE || os.tmpdir();
  return path.join(base, '.ruvector', 'models', entry.name);
}

/** @param {string} file */
function statOrNull(file) {
  try { const s = fs.statSync(file); return { size: s.size, mtimeMs: Math.floor(s.mtimeMs) }; } catch { return null; }
}

/** @param {string} file */
export function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** @param {import('./models.js').ModelEntry} entry */
export function modelFiles(entry) {
  const dir = modelDir(entry);
  const model = path.join(dir, entry.files.model);
  const tokenizer = path.join(dir, entry.files.tokenizer);
  return { dir, model, tokenizer, modelStat: statOrNull(model), tokenizerStat: statOrNull(tokenizer) };
}

/**
 * @typedef {object} Identity
 * @property {string} model
 * @property {number} dimensions
 * @property {number} maxLength
 * @property {number} windowTokens
 * @property {string} modelSha256
 * @property {string} tokenizerSha256
 * @property {number} modelSize
 * @property {number} modelMtimeMs
 * @property {number} tokenizerSize
 * @property {number} tokenizerMtimeMs
 */

/**
 * The model's identity from the files on disk. Hashes are re-taken only when a file's
 * size or modified time differs from what is already known.
 * @param {import('./models.js').ModelEntry} entry
 * @param {Partial<Identity> | null} [known]
 * @returns {Identity}
 */
export function readIdentity(entry, known) {
  const f = modelFiles(entry);
  if (!f.modelStat || !f.tokenizerStat) throw new VmError('VM_E_MODEL_OFFLINE');
  if (f.modelStat.size < 1024 * 1024) throw new VmError('VM_E_MODEL_BROKEN', { path: f.dir });
  const sameModel = known && known.model === entry.name && known.modelSha256 && known.modelSize === f.modelStat.size && known.modelMtimeMs === f.modelStat.mtimeMs;
  const sameTok = known && known.tokenizerSha256 && known.tokenizerSize === f.tokenizerStat.size && known.tokenizerMtimeMs === f.tokenizerStat.mtimeMs;
  return {
    model: entry.name,
    dimensions: entry.dimensions,
    maxLength: entry.maxLength,
    windowTokens: entry.windowTokens,
    modelSha256: sameModel ? /** @type {string} */ (known.modelSha256) : sha256File(f.model),
    tokenizerSha256: sameTok ? /** @type {string} */ (known.tokenizerSha256) : sha256File(f.tokenizer),
    modelSize: f.modelStat.size,
    modelMtimeMs: f.modelStat.mtimeMs,
    tokenizerSize: f.tokenizerStat.size,
    tokenizerMtimeMs: f.tokenizerStat.mtimeMs,
  };
}

/** True when the four things that define "the model" are equal. @param {Partial<Identity> | null | undefined} a @param {Partial<Identity> | null | undefined} b */
export function sameIdentity(a, b) {
  return Boolean(a && b && a.model === b.model && a.modelSha256 === b.modelSha256 && a.tokenizerSha256 === b.tokenizerSha256 && a.dimensions === b.dimensions);
}

/** True when both hashes are the ones this version was tested with. @param {import('./models.js').ModelEntry} entry @param {Identity} id */
export function isTested(entry, id) {
  return id.modelSha256 === entry.tested.model && id.tokenizerSha256 === entry.tested.tokenizer;
}

/**
 * Build the token counter from the model's own vocabulary.
 * @param {import('./models.js').ModelEntry} entry
 */
export function loadCounter(entry) {
  const f = modelFiles(entry);
  try {
    return createWordPiece(JSON.parse(fs.readFileSync(f.tokenizer, 'utf8')));
  } catch {
    throw new VmError('VM_E_MODEL_BROKEN', { path: f.dir });
  }
}
