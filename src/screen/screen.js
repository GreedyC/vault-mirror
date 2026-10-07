// @ts-check
// The screen: flags passages that look like they hold a secret or instruction text.
// It only reports. It never removes a passage, so ids never have gaps.
// The matched text is never printed or logged.

/** @type {{ rule: string, flag: 'possible-secret' | 'possible-instruction-text', re: RegExp }[]} */
const RULES = [
  { rule: 'private-key-block', flag: 'possible-secret', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g },
  { rule: 'api-key', flag: 'possible-secret', re: /\bsk-[A-Za-z0-9_-]{20,}/g },
  { rule: 'github-token', flag: 'possible-secret', re: /\b(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{22,})/g },
  { rule: 'aws-access-key-id', flag: 'possible-secret', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { rule: 'slack-token', flag: 'possible-secret', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { rule: 'json-web-token', flag: 'possible-secret', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  { rule: 'ignore-previous-instructions', flag: 'possible-instruction-text', re: /\bignore\s+(all\s+)?(of\s+)?(the\s+|your\s+)?(previous|prior|above|earlier)\s+instructions\b/gi },
  { rule: 'disregard-the-above', flag: 'possible-instruction-text', re: /\bdisregard\s+(all\s+)?(of\s+)?(the\s+|your\s+)?(above|previous|prior)\b/gi },
];

/**
 * @param {string} text
 * @returns {{ flags: string[], rules: string[], secretSpans: [number, number][] }}
 */
export function screenText(text) {
  /** @type {Set<string>} */
  const flags = new Set(); const rules = new Set();
  /** @type {[number, number][]} */
  const secretSpans = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    for (let m = r.re.exec(text); m; m = r.re.exec(text)) {
      flags.add(r.flag); rules.add(r.rule);
      if (r.flag === 'possible-secret') secretSpans.push([m.index, m.index + m[0].length]);
      if (m[0].length === 0) r.re.lastIndex++;
    }
  }
  return { flags: [...flags], rules: [...rules], secretSpans };
}

/** Replace anything that looks like a key before text is shown. @param {string} text */
export function maskSecrets(text) {
  const spans = screenText(text).secretSpans.sort((a, b) => b[0] - a[0]);
  let out = text;
  for (const [from, to] of spans) out = out.slice(0, from) + '[hidden: looks like a key]' + out.slice(to);
  return out;
}
