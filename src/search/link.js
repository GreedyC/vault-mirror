// @ts-check
// Links back to the note. Built at print time; nothing about links is stored.

/** encodeURIComponent, then also ! ' ( ) *. Never URLSearchParams or encodeURI. @param {string} s */
export function encodeStrict(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

/** Obsidian's own rule for heading text in a link. @param {string} heading */
export function stripHeading(heading) {
  return heading.replace(/%%|\[\[|\]\]|[:#|^\\]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The part after '#', or null when the link should point at the note alone.
 * @param {string[]} heads   heading chain as written
 * @param {boolean} repeats  the deepest heading appears more than once in the note
 */
export function headingPart(heads, repeats) {
  if (!heads || !heads.length) return null;
  const deepest = stripHeading(heads[heads.length - 1]);
  if (!deepest) return null;
  if (!repeats) return deepest;
  const chain = heads.map(stripHeading);
  return chain.every(Boolean) ? chain.join('#') : null;
}

/**
 * @param {object} o
 * @param {string | null} o.vaultParam   the vault name or id, or null when Obsidian does not know the vault
 * @param {string} o.vaultPath           vault-relative path, forward slashes, .md kept
 * @param {string[]} [o.heads]
 * @param {boolean} [o.repeats]
 * @param {boolean} [o.recovered]        found below a fence that never closed
 * @returns {string | null}
 */
export function buildLink(o) {
  if (!o.vaultParam) return null;
  if (o.vaultPath.includes('#')) return null; // no Obsidian link can open such a file
  const file = o.vaultPath.normalize('NFC').replace(/ /g, ' ');
  const heading = o.recovered ? null : headingPart(o.heads || [], Boolean(o.repeats));
  return `obsidian://open?vault=${encodeStrict(o.vaultParam)}&file=${encodeStrict(heading ? `${file}#${heading}` : file)}`;
}
