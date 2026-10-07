// @ts-check
// Keeps the embedding library's own chatter away from the person and the agent.
// While held, anything that does not come from src/cli/output.js goes to the debug log.

const realOut = process.stdout.write.bind(process.stdout);
const realErr = process.stderr.write.bind(process.stderr);
const realConsole = { log: console.log, warn: console.warn, error: console.error, info: console.info };

/** Our own lines always use these. @param {string} text */
export function writeOut(text) { return realOut(text); }
/** @param {string} text */
export function writeErr(text) { return realErr(text); }

let held = false;

/**
 * Start holding library output.
 * @param {(line: string) => void} sink  receives each line, cut at 200 characters
 */
export function hold(sink) {
  if (held) return;
  held = true;
  const take = (/** @type {any} */ chunk) => {
    for (const line of String(chunk).split('\n')) if (line.trim()) { try { sink(line.slice(0, 200)); } catch { /* never throw from a log */ } }
    return true;
  };
  /** @type {any} */ (process.stdout).write = take;
  /** @type {any} */ (process.stderr).write = take;
  console.log = console.info = (...a) => { take(a.join(' ')); };
  console.warn = console.error = (...a) => { take(a.join(' ')); };
}

export function release() {
  if (!held) return;
  held = false;
  /** @type {any} */ (process.stdout).write = realOut;
  /** @type {any} */ (process.stderr).write = realErr;
  Object.assign(console, realConsole);
}

export function isHeld() { return held; }
