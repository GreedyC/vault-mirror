# Benchmarks

Measured numbers for vault-mirror 0.1.0. Nothing here is a promise for another computer.

**Read this first.** Every number below was taken on one machine while other heavy jobs were running on it (load average between 8 and 16 on 16 cores). So every speed is labelled **busy** and is a rough lower bound. None of them may be quoted in a README, guide or slide until it has been measured again with nothing else running.

| | |
| --- | --- |
| Machine | Apple M4 Max, 16 cores, 64 GB |
| Node | 24.15.0 |
| Engine | `ruvector` 0.3.3, `@ruvector/core` 0.1.32, native package 0.1.30, flat index, cosine |
| Reading model | the default entry in `src/embed/models.js` |
| Date | Oct 6, 2026 |
| Priority | every sync ran at `nice -n 15` with 4 readers |

Three sets of data were used:

- **Fixture**: the invented vault in `tests/fixtures/vault` plus invented filler notes made at test time (about 170 notes, about 640 passages).
- **Practice vault**: a public set of English help pages used as a stand-in vault (176 notes, 2,199 passages). Real text, real vectors.
- **Scale check**: `tests/bench/scale.mjs`, 2,000 invented notes and 40,000 passages whose vectors are **synthetic** (clustered, unit length). The engine, the sidecar, the vault walk and the question embedding are real. Search results mean nothing there; only the timings do.

## The performance budget (spec section 15)

| Operation | Budget | Measured | Data | Machine state |
| --- | --- | --- | --- | --- |
| First sync, 4 readers | 30 minutes or less at about 40,000 passages | 60.6 s for 2,199 passages: 36 passages a second. At that rate 40,000 passages would take about 18.5 minutes (a projection, not a measurement) | Practice vault | busy |
| Sync with nothing changed | 2 s or less (0.5 s for about 2,000 notes) | 0.05 s at 176 notes; 0.06 s at 2,000 notes. The model and the engine are not loaded | Practice vault; scale check | busy |
| Sync after one edited note | 6 s or less (1.5 s wanted) | 0.59 s (one passage re-read) at 640 passages; 0.93 s at 40,000 passages, which includes rewriting the whole sidecar and applying the change to the engine | Fixture; scale check | busy |
| Search, cold process, nothing changed | 1.5 s or less (0.7 s wanted at about 40,000 passages) | 0.34 s at 2,199 passages; 0.46 s at 40,000; 0.50 s with three wordings in one call | Practice vault; scale check | busy |
| Engine reload from the sidecar | 5 s or less | 0.6 s for 40,000 rows (the whole `rebuild` command) | Scale check | busy |
| `status` | 2 s or less (0.3 s wanted) | 0.12 s at 176 notes and 2,199 passages; 0.23 s at 2,000 notes and 40,000 passages. The model is not loaded | Practice vault; scale check | busy |
| `status --verify` | 60 s or less | 0.31 s at 2,199 passages; 2.8 s at 40,000 | Practice vault; scale check | busy |
| Peak memory, sync with 4 readers | 2 GB | 1.85 GB | Practice vault | |
| Peak memory, search | 0.7 GB | 0.79 GB at 40,000 passages. **Over the budget by about 0.1 GB** | Scale check | |
| Peak memory, `status` and a sync with nothing changed | | 0.25 GB and 0.07 GB at 40,000 passages | Scale check | |
| Disk | 300 MB or less | 14 MB for 2,199 passages (5 MB sidecar, 8.5 MB engine file); 208 MB for 40,000 passages (129 MB engine file, the rest sidecar) | Practice vault; scale check | |
| CPU while syncing | At most 4 readers, below-normal priority | 216 CPU-seconds over 60.6 s: about 3.6 cores | Practice vault | busy |
| Background activity | None | No process started by any command was alive after it returned (acceptance steps 17, 24 and 25); a sync returned 8 ms after its last line | Fixture; practice vault | |

### Where a search's time goes

One cold `search` process at 40,000 passages, 0.46 s in all (scale check, busy):

| Part | Time |
| --- | --- |
| Start Node and load the tool | about 0.03 s |
| Look at the vault for changes (2,000 notes, size and date only) | 0.02 s (0.00 s with `--no-sync`) |
| Load the reading model and embed the question | 0.27 s |
| Open the engine file, after the probe child has checked it | 0.13 s |
| Search 40,000 rows | 0.012 s |
| Read the passages for the results | 0.001 s |

The probe (a child process that opens the existing engine file first, so a damaged file cannot crash the tool) runs while the model loads, so it adds little to the total. Its own cost is close to the whole `status` command, which is one vault walk plus one probe: 0.12 s at 2,199 passages and 0.23 s at 40,000.

A question is embedded at the smallest padding that gives the same vector. Padding 16, 32, 64 and 128 gave bit-identical vectors for three questions; the embed itself took about 0.02 s at padding 16 against about 0.11 s at 128.

## Items the spec listed as "not measured by anything yet"

| Item | State after this build |
| --- | --- |
| Passage count this chunker gives the reference vault | **Still owed.** This build did not run on it |
| The flat index with real vectors | Measured at 641 and 2,199 real vectors: every passage id present, and 50 of 50 sampled searches equal an exact scan (`status --verify`). At 40,000 rows only synthetic vectors were used (50 of 50) |
| End-to-end rate through this tool's own pipeline | 36 to 37 passages a second with 4 readers at low priority (busy) |
| First-sync time on an ordinary laptop | **Still owed.** One machine only |
| Crash safety of the sidecar | `kill -9` in the middle of a first sync, then `sync` again: the second run embedded only the remainder, totals matched an uninterrupted sync, and `status --verify` was in step (acceptance step 14, passed on every run). One kill point per run |
| Stopping with Ctrl-C | Exit 130 about 3 s after the signal, with "Run it again to continue"; the next sync finished the rest (step 15) |
| A sync paused for 150 s while a second one waits | The second never took over; it ran afterwards and found nothing to do (step 16) |
| Pool behaviour after a timeout | Only with a fake pool in unit tests: a pool error discards the pool, a second one finishes with one reader. **Not provoked on a real pool** |
| Installing from a git tag | **Still owed** (there is no public tag yet). Stand-in: `npm pack`, then `npm install --prefix <temp folder> <tarball>`; that copy's `doctor` showed the three pinned versions loaded and passed acceptance steps 1 to 5 |
| An interrupted or poisoned model download, end to end | **Still owed.** The translation of the library's two raw errors is unit-tested with a fake library; no real download was interrupted, because the model cache is shared with other tools on this machine |
| Any machine other than the build machine | **Still owed.** Verified on Apple Silicon Macs. Windows, Intel Macs and Linux are not yet verified |
| Whether an `obsidian://` link opens when clicked | **Still owed.** It needs a person. The format is unit-tested and round-trips |
| The token counter against the real model | Agreed at the exact edge of the window for 22 kinds of text (prose, prices, hex, web addresses, accents, emoji, Greek, Cyrillic, Japanese, CJK, symbols, zero-width and no-break spaces, a 120-character word). The window test passed 200 of 200 on the practice vault (densest passage 110 tokens) and 200 of 200 on the fixture |
| How often the index finds the right note for a question asked in other words | Ten reworded questions on the practice vault: the expected note was in the top 3 for 9 of 10 with one wording, and for 10 of 10 (rank 1 or 2) when three wordings were passed in one call. Two runs agreed on all ten. A small sample from one author: recorded, **not a number to print** |

## How to measure again

```bash
npm test
node tests/acceptance/run.mjs --vault tests/fixtures/vault
node tests/acceptance/run.mjs --vault <a vault> --read-only-vault --questions tests/acceptance/questions.obsidian-help.json
node tests/bench/scale.mjs --dir <an empty scratch folder>
```

Run them with nothing else heavy on the machine, and write the load average beside each number.
