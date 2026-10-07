# Changelog

All notable changes to vault-mirror are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A change to how notes are cut into passages, or to the reading model, makes every note re-read once on the next sync. Such a change is always called out under **Changed**.

## [Unreleased]

## [0.1.0] - 2026-10-07

The first release.

### Added

- `init`: sets the one current vault and writes a one-line rule for your AI into `CLAUDE.md` and `AGENTS.md`.
- `sync`: brings the index in step with the vault. Only changed notes are read (size and date first, then a SHA-256 fingerprint). Edits replace, renames move, deletes remove. It resumes after an interruption, queues behind another sync, and `--detach` runs it in the background.
- `search`: one call returns two lists, by meaning and by exact words. Several wordings can be passed in one call. Every result carries the note, heading trail, file path, line, an `obsidian://` link and the full passage.
- `status`: the 1:1 proof, as nine named checks. `--verify` fingerprints every note and checks every passage in the engine; `--list` and `--screen` name what is left out or flagged.
- `rebuild`: rebuilds the index from saved passages without re-reading a note. `--full` re-reads everything.
- `doctor`: checks Node, the engine, the pinned versions, the model, the disk and the vault, and ends with one next step, or says the vault is in step.
- The read-only guarantee: one module may read vault paths and has no write call; one module may write and refuses any path inside a vault. Tested by before-and-after checksum listings, a read-only vault on disk, a write spy and a static scan.
- A safety screen that flags passages that look like they hold a key or password and masks them in results.
- `--json` on every command: one object, a stable shape, plain error codes with one next action each.
- Leaving notes out: `exclude` folders, `index: false` in a note's properties, and Obsidian's own "Excluded files" setting.

### Known limits

- Verified on Apple Silicon Macs. Windows, Intel Macs and Linux are not yet verified.
- Every benchmark so far comes from one machine. See [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).
- One current vault at a time. No MCP server, no file watcher, no reranking.
- Whether an `obsidian://` link opens when clicked has been unit-tested for format and not yet confirmed by a person on every platform.

[Unreleased]: https://github.com/HeroForgeAI/vault-mirror/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HeroForgeAI/vault-mirror/releases/tag/v0.1.0
