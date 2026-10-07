// @ts-check
// Opens an existing engine file in a short child process. A truncated file aborts Node
// from inside the storage library, and no try can catch that, so the main process never
// opens an existing file first. Run as: node probe.js <file> <dimensions>
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} file @param {number} dimensions
 * @param {{ timeoutMs?: number, spawnFn?: typeof spawn }} [opts]
 * @returns {Promise<{ ok: boolean, count: number, flat: boolean, reason: string | null, ms: number }>}
 */
export function probeEngineFile(file, dimensions, opts = {}) {
  const started = Date.now();
  const run = opts.spawnFn || spawn;
  return new Promise((resolve) => {
    let out = ''; let done = false;
    const finish = (/** @type {{ ok: boolean, count?: number, flat?: boolean, reason?: string | null }} */ r) => {
      if (done) return; done = true; clearTimeout(timer);
      resolve({ ok: r.ok, count: r.count ?? 0, flat: r.flat ?? false, reason: r.reason ?? null, ms: Date.now() - started });
    };
    const child = run(process.execPath, [fileURLToPath(import.meta.url), file, String(dimensions)], { stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } finish({ ok: false, reason: 'timeout' }); }, opts.timeoutMs ?? 20000);
    child.stdout?.on('data', (d) => { out += d; });
    child.on('error', () => finish({ ok: false, reason: 'spawn' }));
    child.on('close', (code, signal) => {
      if (signal) return finish({ ok: false, reason: `signal ${signal}` });
      if (code !== 0) return finish({ ok: false, reason: `exit ${code}` });
      try {
        const r = JSON.parse(out.trim().split('\n').pop() || '');
        if (typeof r.count !== 'number') return finish({ ok: false, reason: 'no number' });
        finish({ ok: true, count: r.count, flat: Boolean(r.flat) });
      } catch { finish({ ok: false, reason: 'no number' }); }
    });
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [file, dims] = process.argv.slice(2);
  const { openFlat, fileIsFlat } = await import('./ruvector-flat.js');
  try {
    const flat = fileIsFlat(file);
    const { engine } = await openFlat(file, Number(dims));
    process.stdout.write(JSON.stringify({ count: await engine.count(), flat }) + '\n');
    process.exit(0);
  } catch {
    process.exit(3);
  }
}
