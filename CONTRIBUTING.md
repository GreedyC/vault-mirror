# Contributing to vault-mirror

Thank you for looking. This is a small tool with a narrow promise, and the most useful contributions keep it that way.

## Before anything else: never share your notes

An index folder holds a plain-text copy of your notes. **Never attach notes, an index folder, `passages.jsonl` or `manifest.json` to an issue or pull request.** What is safe to share:

- the output of `vault-mirror status` and `vault-mirror doctor` (counts and versions only);
- `logs/sync.log` and `logs/debug.log` from the index folder. By design they hold no note text, no note names and no search questions.

If a bug needs a note to reproduce it, write a small invented one.

## Reporting a bug

Open an issue with the bug form. It asks for your version (`vault-mirror --version`), operating system, Node version, the command you ran, and what `status` and `doctor` print. Reports from Windows, Intel Macs and Linux are especially welcome: those platforms are not yet verified.

## Setting up

```bash
git clone https://github.com/HeroForgeAI/vault-mirror.git
cd vault-mirror
npm ci            # never --omit=optional: the native engine is an optional package
```

Node 20 or newer. There is no build step.

## Checks to run

```bash
npm test                 # unit tests: no network, a few seconds
npm run typecheck        # tsc --noEmit over the JSDoc types
npm run lint             # eslint
npm run acceptance       # end to end on the invented fixture vault: a few minutes, needs the reading model
```

All four are expected to pass before a pull request is merged. The acceptance run copies the fixture vault to a temp folder, runs the real binary against it, and compares a checksum listing of the vault after every command. To keep your own index out of it, the run uses its own home folder; set `VAULT_MIRROR_TEST_TMP` to choose where.

## The rules the code lives by

These are checked by tests, so a pull request that breaks one will fail.

1. **The vault is only ever read.** `src/vault/read-only-fs.js` is the only module that touches vault paths, and it can only list, stat and read. `src/store/safe-write.js` is the only module that writes, renames or deletes, and it refuses any path inside a vault.
2. **One runtime dependency.** `ruvector`, pinned exactly. New runtime dependencies need a strong reason.
3. **The chunker is a pure function and is versioned.** Any change to what `src/chunker/` produces bumps `CHUNKER_VERSION` in `src/version.js`, because it makes every user re-read every note once. Say so in the changelog.
4. **Model names and vector sizes stay inside `src/embed/`. Engine details stay inside `src/engine/`.**
5. **Every error is one plain sentence and one next action.** Wording lives in `src/errors.js`.
6. **Fixtures are invented.** Never copy real notes, or pages from any documentation site, into `tests/fixtures/`.
7. **No claim without a measurement.** A number in the README or docs comes from a command in `docs/BENCHMARKS.md`, with its conditions.

The design and the reasons behind it are in [`docs/SPEC.md`](docs/SPEC.md).

## What fits, and what does not

Fits: correctness of the 1:1 sync, the read-only guarantee, clearer messages, platform fixes, tests, measured speed-ups.

Probably does not fit 0.1.x: writing into a vault for any reason, a background watcher that is on by default, a hosted service, telemetry.

If you are unsure, open an issue first and describe the change in two sentences.

## Pull requests

- Keep each one to a single change.
- Add or update a test that fails without your change.
- Add a line to `CHANGELOG.md` under **Unreleased**.
- Plain commit messages that say what changed.

## Re-recording the demo

```bash
bash docs/demo/setup.sh    # builds a throwaway sandbox from the fixture vault
vhs docs/demo/demo.tape    # writes docs/demo/demo.gif
node scripts/make-dark-svg.mjs   # after editing a *-light.svg in docs/assets
```

By contributing you agree that your work is released under the [MIT license](LICENSE), and to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
