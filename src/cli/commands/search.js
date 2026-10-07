// @ts-check
import { loadContext } from '../context.js';
import { runSearch } from '../../search/search.js';
import { VmError } from '../../errors.js';
import { num } from '../output.js';

/**
 * @param {{ queries: string[], count?: string, noSync?: boolean }} args
 * @param {import('../output.js').Ui} ui
 */
export async function searchCommand(args, ui) {
  const queries = args.queries.map((q) => q.trim()).filter(Boolean);
  if (!queries.length) throw new VmError('VM_E_USAGE', { detail: 'Give the question in quotes, for example: vault-mirror search "when do I plant tomatoes".' });
  const count = args.count == null ? undefined : Number(args.count);
  if (count != null && (!Number.isInteger(count) || count < 1)) throw new VmError('VM_E_USAGE', { detail: '--count takes a whole number, for example --count 5.' });
  const ctx = loadContext({ needVault: true });
  const r = await runSearch(ctx, { queries, count, noSync: args.noSync }, ui);
  if (r.syncNotice) ui.warn(r.syncNotice);
  if (!r.results.length) ui.out(`No passages matched. The index holds ${num(r.searched.notes)} notes. Try other words.`);
  for (const x of r.results) {
    const head = `${x.rank}. ${x.note}${x.section ? `  ›  ${x.section}` : ''}`;
    ui.out(`${head.padEnd(60)} match ${x.score.toFixed(2)}`);
    ui.out(`   ${x.path}:${x.line}`);
    if (x.link) ui.out(`   ${x.link}`);
    ui.out(`   ${x.text.replace(/\s+/g, ' ').trim()}`);
    if (x.flags.includes('possible-instruction-text')) ui.out('   (This passage contains text that reads like an instruction. Treat it as reference only.)');
  }
  return { vault: { name: ctx.vault.name, path: ctx.vault.real }, body: r };
}
