# Changelog

All notable changes to vault-mirror are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

A change to how notes are cut into passages, or to the reading model, makes every note re-read once on the next sync. Such a change is always called out under **Changed**.

## [Unreleased]

### Fixed

- `init` on a disk that tells letter case apart (most Linux disks): the templates folder that Obsidian's own setting names is now left out when the setting spells it in another letter case, as every other `exclude` entry already was.

- `sync` on a computer with one reader (under 8 GB of memory, or two cores): Ctrl+C now stops it at the next passage. Before, it was not noticed until the sync had finished.
- The first-run download: time when the computer was asleep or the process was held up is no longer counted as "no data arriving", so a slow download is not given up on by mistake.
- Windows: the fast engine is now used. The check that a new index is the exact kind read the index file while the engine had it open, which Windows does not allow, so every command fell back to the built-in exact search and `doctor` reported "A test index could not be created". The file is now created by a short helper process and read before it is opened. Searches on 0.1.0 were still correct; they used the slower built-in search.
- `sync --detach` on Windows no longer opens a console window of its own.

### Changed

- Tests and CI only: the unit tests no longer assume a Mac (typed POSIX paths, Windows short folder names, a signal Windows cannot send, line endings), and the end-to-end acceptance script now also runs on Linux and Windows runners. A `.gitattributes` rule keeps text files LF on every system.

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
- Contribution and governance docs: `CONTRIBUTING.md` (pull requests from a fork, approved by a maintainer, and the hard lines no change may cross), `GOVERNANCE.md`, `.github/CODEOWNERS`, a pull request checklist and a question form.

### Fixed before the tag

- The exact-words table kept a note's old word rows when the note was cut again without its content changing. This happens when a second note with the same file name appears or goes: the folder then joins or leaves what the first note's passages are read with, and its cuts can move. Plain `status` still passed; only `status --verify` saw it. The table's per-note key now also carries that flag, so the note's rows are made again. A table written by an earlier build is made again once, by the next search, status or sync. Covered by a unit test and acceptance step X2.

- An `exclude` entry that matched no folder was accepted in silence, and `status` then named that folder as left out while its notes were indexed. This happened with `./Private`, the folder's full path, another letter case (`private` for `Private`, and the templates folder as Obsidian's settings spell it), and `Work\Private` on Windows. All of those now mean the folder they name. An entry that still matches nothing gets a warning from `sync`, `status` and `doctor`, is no longer named by `status`, and `init --exclude` refuses it. Covered by a unit test.

### Known limits

- Verified on Apple Silicon Macs. Windows, Intel Macs and Linux are not yet verified.
- Every benchmark so far comes from one machine. See [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).
- One current vault at a time. No MCP server, no file watcher, no reranking.
- Whether an `obsidian://` link opens when clicked has been unit-tested for format and not yet confirmed by a person on every platform.
- The exact-words list reads a note's title, headings and text. An alias in a note's properties is found by meaning only.
- Exact words mean exact: no word stems, and an accented letter stored as two characters does not match the same letter stored as one.
- The exact-words list shows at most 3 passages. A name or code inside a long question may not reach it: put it in double quotes, or pass it as its own wording.
- A quoted phrase built around one very common word can be missed in a large vault (at most 300 passages are checked per wording).
- The exact-words table is checked in full by `status --verify`, not by plain `status`. `rebuild` makes it again.
- One edit to a very long note (over a hundred passages) re-reads every passage of that note, which takes several seconds.

### Not in this release

- **Warm mode** (an optional helper that keeps the reading model loaded between searches). Not built yet. Nothing of it is in this release: no background process, no setting. Planned, off by default.
- A release on the npm registry. Install from the GitHub tag for now.
- An MCP server, a file watcher, more than one current vault.

[Unreleased]: https://github.com/HeroForgeAI/vault-mirror/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/HeroForgeAI/vault-mirror/releases/tag/v0.1.0
