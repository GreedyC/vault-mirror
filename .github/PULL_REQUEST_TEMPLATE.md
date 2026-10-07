## What changed, and why

<!-- One or two sentences. Link the issue if there is one. -->

## How it was tested

- [ ] `npm test`
- [ ] `npm run typecheck` and `npm run lint`
- [ ] `npm run acceptance` (needed for any change under `src/`)
- [ ] A test that fails without this change

Platform and Node version it was run on:

## Checklist

- [ ] A line under **Unreleased** in `CHANGELOG.md`
- [ ] No note text, real note names or index files in the diff, the fixtures or this description
- [ ] If the chunker's output changed: `CHUNKER_VERSION` is bumped and the changelog says every note is re-read once
- [ ] If a number in the README or docs changed: it comes from a command in `docs/BENCHMARKS.md`, with its conditions
