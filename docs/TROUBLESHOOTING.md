# Troubleshooting

Every message the tool prints is one plain sentence and one next step. These are the ones people meet. Your notes are the original and the index is a copy, so nothing here can harm a note.

## The first sync is slow, and the fan is running

> Your computer may feel a little slower and its fan may run while this reads your notes. That is normal. You can keep working, and it picks up where it left off if it is interrupted.

It reads every note once. After that only changed notes are read. From an AI's shell, use `vault-mirror sync --detach` so a long first sync is not cut off, then ask "is my vault in sync?"

## "Nothing is indexed yet."

A search ran before any sync finished. Run `vault-mirror sync`.

## "Another sync is still running (41% done). Nothing is wrong."

Wait for it, or ask "is my vault in sync?" Searches work in the meantime and cover what is saved so far. There is no lock file to delete.

## "Obsidian has not opened this folder as a vault yet, so links to notes will not work."

Open the folder in Obsidian once ("Open folder as vault"). File paths in results work either way.

## "The reading model is not on this computer yet and the download did not get through."

Connect to the internet and run `vault-mirror doctor`. It is a one-time download of about 90 MB.

## "... is not one vault (it is your home folder, a folder of several vaults, or a folder inside a vault)."

Run `vault-mirror init` with the folder of the one vault you want: the folder that holds `.obsidian`.

## "640 notes would leave the index since the last sync. Nothing was changed, in case that is a mistake."

A safety stop, for the day a cloud drive has not finished downloading or a folder was moved by accident. If the removal is what you want, run `vault-mirror sync --allow-mass-delete`.

## The index looks wrong, or "Something unexpected went wrong. Your notes were not touched."

Run `vault-mirror rebuild`. A rebuild is always safe. If it happens again, `logs/debug.log` in the index folder holds no note names or text and can be attached to an issue.

## npm reports a permission error (EACCES) during install

Do not use `sudo`. Run `npm config set prefix ~/.npm-global`, add `~/.npm-global/bin` to your path, and install again.
