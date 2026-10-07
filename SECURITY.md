# Security

## Reporting a problem

Please report security problems privately, not in a public issue.

Use GitHub's private reporting: open the repository's **Security** tab and choose **Report a vulnerability**, or go straight to <https://github.com/HeroForgeAI/vault-mirror/security/advisories/new>.

Include the version (`vault-mirror --version`), your operating system, and the steps that show the problem. **Do not include your notes or an index folder.** Invented notes are enough to show almost any bug.

You can expect a first reply within a week. Fixes are released as a new version and credited in the changelog unless you ask otherwise.

## Supported versions

| Version | Supported |
| --- | --- |
| 0.1.x | yes |

## What the tool does, in security terms

- **It only reads the vault.** No code path writes, renames or deletes inside a vault. One module may write files at all, and it accepts two places only: the tool's home folder (`~/.vault-mirror`, or `VAULT_MIRROR_HOME`), and the rule block in `CLAUDE.md` and `AGENTS.md` during `init`.
- **One download.** The reading model (about 90 MB) is fetched once by the `ruvector` library on first use. vault-mirror checks the SHA-256 of the model file and of its tokenizer file before first use, and `doctor` reports a mismatch. The tool itself opens no network connection, has no telemetry and needs no account.
- **The index holds note text in plain form.** It is not encrypted. Anyone who can read your home folder can read it. Keep it out of git and out of cloud-synced folders, and use full-disk encryption (FileVault, BitLocker) as you would for the notes themselves.
- **Your AI is outside this boundary.** Passages a search returns are read by Claude Code or Codex and sent to that service, as with any file an agent reads. `index: false` and `exclude` keep notes out of the index. They do not stop an agent that can read the folder.
- **Notes are untrusted input to an agent.** A note can contain text written to steer an AI. The rule `init` writes tells the agent to treat returned passages as reference, not instructions, and the screen flags a few well-known phrasings. Neither is a guarantee.
- **Logs.** `logs/sync.log` and `logs/debug.log` hold counts, timings and 16-character keys. They hold no note text, no note names and no search questions.

## In scope

- Any way to make vault-mirror write, rename or delete inside a vault.
- Any way to make it write outside its home folder and the two rule files.
- Note text, note names or search questions reaching a log or the network.
- A crafted note or file name that makes the tool run a command or crash in a way that damages an index beyond what `vault-mirror rebuild` repairs.

## Out of scope

- What an AI agent does with passages after a search returns them.
- Problems in `ruvector` itself. Please report those to <https://github.com/ruvnet/ruvector>. If one affects vault-mirror users, tell us too.
- Someone who already has access to your user account reading the index. It is a plain copy by design.

vault-mirror makes no HIPAA claim. Do not point it at a vault that holds patient information.
