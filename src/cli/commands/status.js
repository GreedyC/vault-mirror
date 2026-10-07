// @ts-check
import path from 'node:path';
import { loadContext } from '../context.js';
import { computeStatus } from '../../status/checks.js';
import { readRecord } from '../../store/sidecar.js';
import { screenText } from '../../screen/screen.js';
import { tildify } from '../../config/paths.js';
import { setLogDir } from '../../log.js';
import { num, duration, eta } from '../output.js';

/** @param {string} iso */
function when(iso) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The human view of a status result. @param {any} s @param {import('../../sync/run.js').Context} ctx @param {import('../output.js').Ui} ui */
export function printStatus(s, ctx, ui) {
  const c = s.counts; const lo = c.leftOut;
  const v = /** @type {NonNullable<typeof ctx.cfg.vault>} */ (ctx.cfg.vault);
  const row = (/** @type {string} */ label, /** @type {number} */ n, extra = '') => ui.out(`  ${label.padEnd(31)}${num(n).padStart(7)}${extra ? `   ${extra}` : ''}`);
  ui.out(`${ctx.vault.name}   ${tildify(ctx.vault.real)}`);
  const pending = c.pending.new + c.pending.changed + c.pending.removed;
  if (s.running) ui.out(`A sync is running: ${s.running.percent}% done${s.running.etaSeconds != null ? `, ${eta(s.running.etaSeconds)}` : ''}. Searches work now and cover what is saved so far.`);
  else if (s.inStep) ui.out(`In step: yes${v.exclude.length ? ', with these folders left out: ' + v.exclude.join(', ') : ''} (${s._verify ? 'every note was read and every passage checked' : 'checked by size and date; --verify reads every note'})`);
  else if (!s._manifest) ui.out('In step: not yet. Nothing is indexed yet.');
  else ui.out(`In step: not yet. ${pending ? `${num(pending)} ${pending === 1 ? 'note is' : 'notes are'} waiting to sync.` : 'The index needs a refresh.'}`);
  ui.out('');
  const others = [['symlink', lo.symlink], ['nested vault', lo.nestedVault], ['not downloaded', lo.notDownloaded], ['same name twice', lo.duplicatePath]].filter(([, n]) => n).map(([k, n]) => ` · ${k} ${n}`).join('');
  row('Notes on disk', c.notesOnDisk);
  row('Left out on purpose', s._leftOutTotal, `excluded folder ${lo.excluded} · excluded in Obsidian ${lo.obsidianExcluded} · index: false ${lo.indexFalse} · empty ${lo.empty}${others}`);
  row('Notes that belong in the index', c.eligible);
  row('Notes in the index', c.notesIndexed);
  row('Passages recorded', c.passagesRecorded);
  row('Passages in ruvector', c.passagesInEngine);
  row('Waiting to sync', pending, `new ${c.pending.new} · changed ${c.pending.changed} · removed ${c.pending.removed}`);
  row('Could not read', c.unreadable);
  if (c.otherFiles) row('Other files (not notes)', c.otherFiles);
  ui.out('');
  const last = s.lastSync ? `Last sync ${when(s.lastSync.at)}, took ${duration(s.lastSync.seconds)}. ` : '';
  ui.out(`${last}Model ${s.versions.model}. vault-mirror ${s.versions.tool}, ruvector ${s.versions.ruvector}.`);
  if (!s.inStep && !s.running) {
    const failed = s.checks.filter((/** @type {any} */ k) => !k.ok);
    if (s._verify) for (const k of failed) ui.out(`  not ok: ${k.name} (${k.detail})`);
    ui.out(`Next: ${s._indexLooksWrong ? 'vault-mirror rebuild' : 'vault-mirror sync'}`);
  }
}

/**
 * @param {{ verify?: boolean, list?: boolean, screen?: boolean }} args
 * @param {import('../output.js').Ui} ui
 */
export async function statusCommand(args, ui) {
  const ctx = loadContext({ needVault: true });
  setLogDir(path.join(ctx.indexDir, 'logs'));
  const s = await computeStatus(ctx, { verify: args.verify }, ui);
  for (const w of ctx.vaultWarnings) ui.warn(w);
  printStatus(s, ctx, ui);
  /** @type {Record<string, any>} */
  const extra = {};
  if (args.list) {
    extra.list = { leftOut: s._plan.leftOutList.map((x) => ({ path: x.key, reason: x.reason })), waiting: s._plan.pendingList.map((x) => ({ path: x.key, kind: x.kind })), unreadable: s._plan.skipped.map((x) => ({ path: x.key, reason: x.reason })) };
    ui.out('');
    if (!extra.list.leftOut.length && !extra.list.waiting.length && !extra.list.unreadable.length) ui.out('Nothing is left out, waiting or unreadable.');
    for (const x of extra.list.leftOut) ui.out(`  left out (${x.reason}): ${x.path}`);
    for (const x of extra.list.waiting) ui.out(`  waiting (${x.kind}): ${x.path}`);
    for (const x of extra.list.unreadable) ui.out(`  could not read (${x.reason}): ${x.path}`);
  }
  if (args.screen) {
    /** @type {{ path: string, line: number, rule: string }[]} */
    const flagged = [];
    if (s._manifest && s._dataDir) {
      for (const [key, e] of Object.entries(s._manifest.notes)) {
        if (!e.flagged) continue;
        for (const p of readRecord(s._dataDir, e.log).passages) for (const rule of screenText(p.text).rules) flagged.push({ path: key, line: p.line, rule });
      }
    }
    extra.screen = flagged;
    ui.out('');
    ui.out(flagged.length ? 'Passages the screen flagged (the matched text is never shown):' : 'The screen flagged nothing.');
    for (const f of flagged) ui.out(`  ${f.path}:${f.line}  ${f.rule}`);
  }
  const { _plan, _leftOutTotal, _indexLooksWrong, _verify, _manifest, _dataDir, ...body } = s;
  void _plan; void _leftOutTotal; void _indexLooksWrong; void _verify; void _manifest; void _dataDir;
  return { vault: { name: ctx.vault.name, path: ctx.vault.real }, body: { ...body, ...extra } };
}
