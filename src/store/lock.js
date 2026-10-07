// @ts-check
// Two small lock files of our own, so two runs queue instead of failing.
// A lock is stale only when its owner is gone. A live owner is never taken over.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { createExclusive, remove, rename } from './safe-write.js';
import { VmError } from '../errors.js';

/** @param {string} file @returns {{ pid: number, token: string, command: string, startedAt: number } | null} */
export function readLock(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

/** @param {number} pid */
export function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return /** @type {any} */ (e).code === 'EPERM'; }
}

/** @param {{ pid: number, startedAt: number } | null} lock @param {{ alive?: (pid: number) => boolean, bootMs?: number }} [probe] */
export function isStale(lock, probe = {}) {
  if (!lock || typeof lock.pid !== 'number') return true;
  const alive = probe.alive || pidAlive;
  const bootMs = probe.bootMs ?? Date.now() - os.uptime() * 1000;
  return !alive(lock.pid) || lock.startedAt < bootMs - 5000;
}

const held = new Map();
process.on('exit', () => { for (const [file, token] of held) { try { if (readLock(file)?.token === token) remove(file); } catch { /* leaving */ } } });

/**
 * @param {string} file
 * @param {{ command: string, waitMs: number, pollMs?: number, onWait?: (owner: { pid: number, command: string }) => void, busyCode?: string }} opts
 * @returns {Promise<{ token: string, stillOurs: () => boolean, release: () => void }>}
 */
export async function acquireLock(file, opts) {
  const mine = held.get(file);
  if (mine && readLock(file)?.token === mine) {
    // This process already holds it (a lock is held until the process exits).
    return { token: mine, stillOurs: () => readLock(file)?.token === mine, release: () => {} };
  }
  const token = crypto.randomBytes(8).toString('hex');
  const body = JSON.stringify({ pid: process.pid, token, command: opts.command, startedAt: Date.now() });
  const deadline = Date.now() + opts.waitMs;
  let told = false;
  for (;;) {
    if (createExclusive(file, body)) break;
    const owner = readLock(file);
    if (isStale(owner)) {
      // Move the dead owner's file aside under a unique name, so two waiters cannot both clear it and both win.
      const aside = `${file}.stale-${token}`;
      try { rename(file, aside); remove(aside); } catch { /* someone else cleared it first */ }
      continue;
    }
    if (Date.now() >= deadline) throw new VmError(opts.busyCode || 'VM_E_BUSY', {});
    if (!told && opts.onWait && owner) { told = true; opts.onWait(owner); }
    await new Promise((r) => setTimeout(r, opts.pollMs ?? 500));
  }
  held.set(file, token);
  return {
    token,
    /** Fencing: re-read the file and confirm the token is still ours. */
    stillOurs: () => readLock(file)?.token === token,
    release: () => { if (readLock(file)?.token === token) remove(file); held.delete(file); },
  };
}

/** Who holds a lock right now, if a live process does. @param {string} file */
export function liveOwner(file) {
  const lock = readLock(file);
  return lock && !isStale(lock) ? lock : null;
}

/** Remove a lock whose owner is gone. Returns true when one was cleared. @param {string} file */
export function clearIfStale(file) {
  const lock = readLock(file);
  if (!fs.existsSync(file) || !isStale(lock)) return false;
  remove(file);
  return true;
}
