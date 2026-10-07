// @ts-check
// The small pool of readers used by a large sync. Never the library's own default count.

/**
 * @param {any} lib  the ruvector library (or a fake in tests)
 * @param {number} workers
 */
export function createPool(lib, workers) {
  let running = false;
  return {
    get running() { return running; },
    workers,
    async start() {
      if (running || workers < 1) return;
      await lib.initParallelEmbedder(workers);
      running = true;
    },
    /** @param {string[]} texts @returns {Promise<number[][]>} */
    async embed(texts) {
      if (!running) throw new Error('pool is not running');
      return lib.embedBatchParallel(texts);
    },
    /** Stops the readers. Safe to call twice. Gives up after 5 s so the command can still end. */
    async stop() {
      if (!running) return;
      running = false;
      /** @type {NodeJS.Timeout | undefined} */
      let timer;
      const cap = new Promise((resolve) => { timer = setTimeout(resolve, 5000); });
      try { await Promise.race([Promise.resolve(lib.shutdown()).catch(() => {}), cap]); } finally { clearTimeout(timer); }
    },
  };
}

/** Watches for a laptop that slept or a paused process: a 1 s ticker that fires more than 15 s late. */
export function createStallWatch() {
  let last = Date.now();
  let stalledAt = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    if (now - last > 16000) stalledAt = now;
    last = now;
  }, 1000);
  timer.unref();
  return {
    recentlyStalled: () => Date.now() - stalledAt < 45000 || Date.now() - last > 16000,
    stop: () => clearInterval(timer),
  };
}
