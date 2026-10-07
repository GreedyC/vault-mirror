## What changed, and why

<!-- One or two sentences. Link the issue if there is one. Anything bigger than a small fix needs an issue first. -->

## How it was tested

- [ ] `npm test` passes
- [ ] `npm run typecheck` and `npm run lint` pass
- [ ] `npm run acceptance` (needed for any change under `src/`)
- [ ] A test that fails without this change

Platform and Node version it was run on:

## Checklist

- [ ] No vault writes: nothing here writes, moves or deletes inside a vault
- [ ] No new network calls
- [ ] No new runtime dependency (or the issue that agreed to it is linked above)
- [ ] A line under **Unreleased** in `CHANGELOG.md`
- [ ] No note text, real note names or index files in the diff, the fixtures or this description
- [ ] If the chunker's output changed: `CHUNKER_VERSION` is bumped and the changelog says every note is re-read once
- [ ] If a number in the README or docs changed: it comes from a command in `docs/BENCHMARKS.md`, with its conditions
- [ ] I agree my contribution is under this repo's license (MIT)
