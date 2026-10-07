// @ts-check
// The one place the ruvector package is loaded. It is used as a library only.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
/** @type {any} */
let lib = null;

/** Load ruvector once. @returns {any} */
export function loadRuvector() {
  if (lib) return lib;
  delete process.env.RUVECTOR_BACKEND; // the value "rvf" crashes the import
  lib = require('ruvector');
  return lib;
}

function versionOf(/** @type {string} */ name, /** @type {NodeRequire} */ from = require) {
  try {
    let dir = path.dirname(from.resolve(name));
    for (let i = 0; i < 4; i++) {
      const file = path.join(dir, 'package.json');
      if (fs.existsSync(file)) {
        const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (pkg.name === name) return String(pkg.version);
      }
      dir = path.dirname(dir);
    }
  } catch { /* not installed */ }
  return null;
}

/** The native package name for this platform, or null when there is none. */
export function nativePackageName() {
  const key = `${process.platform}-${process.arch}`;
  /** @type {Record<string, string>} */
  const names = {
    'darwin-arm64': 'ruvector-core-darwin-arm64', 'darwin-x64': 'ruvector-core-darwin-x64',
    'linux-x64': 'ruvector-core-linux-x64-gnu', 'linux-arm64': 'ruvector-core-linux-arm64-gnu', 'win32-x64': 'ruvector-core-win32-x64-msvc',
  };
  return names[key] || null;
}

/** The three versions actually loaded. @returns {{ ruvector: string | null, core: string | null, native: string | null }} */
export function loadedVersions() {
  const ruvector = versionOf('ruvector');
  let core = null; let native = null;
  try {
    const fromRuvector = createRequire(require.resolve('ruvector'));
    core = versionOf('@ruvector/core', fromRuvector);
    const name = nativePackageName();
    if (name) {
      try { native = versionOf(name, createRequire(fromRuvector.resolve('@ruvector/core'))); } catch { native = null; }
    }
  } catch { /* leave nulls */ }
  return { ruvector, core, native };
}

/** True when the native engine loaded. The non-native stub answers every search with nothing. */
export function isNative() {
  try { const rv = loadRuvector(); return typeof rv.isNative === 'function' && rv.isNative() === true; } catch { return false; }
}
