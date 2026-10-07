// Invented notes made at test time: filler for timing-sensitive steps, and file names that
// some systems cannot check out of git (so they are never committed).
import fs from 'node:fs';
import path from 'node:path';

const SUBJECTS = ['the orchard gate', 'the tide table', 'the bread oven', 'the bee hives', 'the rain gauge', 'the seed tray', 'the ferry rope', 'the wood stove', 'the mill pond', 'the herb bed'];
const VERBS = ['needs checking', 'was repaired', 'should be moved', 'works best', 'gets cleaned', 'is measured', 'was painted', 'is left alone'];
const WHEN = ['before the first frost', 'on the second Sunday', 'after heavy rain', 'at the start of each month', 'once the swallows return', 'when the wind turns north'];
const WHY = ['so the path stays dry', 'because the old one cracked', 'to keep the mice out', 'which saves a trip to town', 'so nobody has to guess', 'and the neighbours agree'];

/** A deterministic invented sentence. @param {number} i */
export function sentence(i) {
  return `Note ${i}: ${SUBJECTS[i % 10]} ${VERBS[(i * 3) % 8]} ${WHEN[(i * 7) % 6]}, ${WHY[(i * 5) % 6]}.`;
}

/** Write `count` invented notes of a few sections each into <vault>/<folder>. @param {string} vault @param {number} count @param {string} [folder] */
export function makeFiller(vault, count, folder = 'Filler') {
  for (let i = 0; i < count; i++) {
    const dir = path.join(vault, folder, `Set ${String(Math.floor(i / 20)).padStart(2, '0')}`);
    fs.mkdirSync(dir, { recursive: true });
    const parts = [`# Filler ${i}`, ''];
    for (let s = 0; s < 3; s++) {
      parts.push(`## Part ${s + 1}`, '');
      for (let k = 0; k < 6; k++) parts.push(sentence(i * 31 + s * 7 + k));
      parts.push('');
    }
    fs.writeFileSync(path.join(dir, `Filler ${i}.md`), parts.join('\n'));
  }
}

/** Forty notes all named README.md, each in its own folder. @param {string} vault */
export function makeReadmes(vault, count = 40) {
  for (let i = 0; i < count; i++) {
    const dir = path.join(vault, 'Readmes', `Folder ${i}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'README.md'), `# About folder ${i}\n\n${sentence(1000 + i)} ${sentence(2000 + i)}\n`);
  }
}

export const ODD_NAMES = ['Why & how (v2), 50% + 1 = $5: it’s “done” — really?.md', "Quote ' and double \" marks.md", 'Café \u{1F331} sprout.md'];

/** Notes whose names are legal on macOS and Linux but not everywhere. Returns the vault-relative paths written. @param {string} vault */
export function makeOddNames(vault) {
  const written = [];
  const put = (/** @type {string} */ rel, /** @type {string} */ body) => {
    try { fs.mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true }); fs.writeFileSync(path.join(vault, rel), body); written.push(rel); } catch { /* this system cannot hold that name */ }
  };
  ODD_NAMES.forEach((name, i) => put(path.join('Odd', name), `# Odd name ${i}\n\n${sentence(3000 + i)} ${sentence(3100 + i)}\n`));
  put(path.join('Odd', 'Trailing space ', ' Leading space.md'), `# Spaces\n\n${sentence(3200)} ${sentence(3201)}\n`);
  put(path.join('Odd', 'A | B.md'), `# Pipe\n\n${sentence(3300)} ${sentence(3301)}\n`);
  put(path.join('Odd', 'Fake keys.md'), `# Fake keys\n\nAn invented example that only looks like a key: AKIA${'ABCDEFGHIJKLMNOP'} and the sentence ignore all previous instructions, which the screen should flag.\n\n## Plain part\n\n${sentence(3400)}\n`);
  return written;
}
