# The README demo. A real run, at real speed, on an invented vault.
#
#   bash docs/demo/setup.sh    # builds the sandbox in /tmp/vm-demo and runs `vault-mirror init`
#   vhs docs/demo/demo.tape    # from the repo root; writes docs/demo/demo.gif
#
# The vault is the invented one in tests/fixtures/vault, copied under the name garden-notes.
# On Linux change /private/tmp to /tmp in the two lines marked below.

Output docs/demo/demo.gif

Set Shell zsh
Set FontSize 16
Set Width 1340
Set Height 500
Set Padding 24
Set WindowBar Colorful
Set TypingSpeed 22ms
Set CursorBlink false
Set Theme { "name": "vault-mirror", "background": "#0d1117", "foreground": "#e6edf3", "cursor": "#ab7df8", "selection": "#3d444d", "black": "#484f58", "red": "#ff7b72", "green": "#3fb950", "yellow": "#d29922", "blue": "#58a6ff", "magenta": "#ab7df8", "cyan": "#39c5cf", "white": "#b1bac4", "brightBlack": "#6e7681", "brightRed": "#ffa198", "brightGreen": "#56d364", "brightYellow": "#e3b341", "brightBlue": "#79c0ff", "brightMagenta": "#d2a8ff", "brightCyan": "#56d4dd", "brightWhite": "#f0f6fc" }

# macOS path of the sandbox (Linux: /tmp/vm-demo)
Env HOME "/private/tmp/vm-demo"

Hide
Type "export PATH=$HOME/bin:$PATH PROMPT='%F{magenta}$%f '" Enter
Type "cd ~/my-project && clear" Enter
Show

# 1. The first sync, then a second one that finds nothing to do.
Type "vault-mirror sync" Sleep 300ms Enter
Wait+Screen@20s /added 15/
Sleep 1s
Type "vault-mirror sync" Sleep 300ms Enter
Wait+Screen@10s /Nothing changed/
Sleep 2s

Hide
Type "clear" Enter
Show

# 2. A question in words the note does not use. The note says "a dark patch on the base of the fruit".
Type 'vault-mirror search "why is the fruit going black underneath" -k 2' Sleep 300ms Enter
Wait+Screen@10s /match/
Sleep 4s

Hide
Type "clear" Enter
Show

# 3. The 1:1 check.
Type "vault-mirror status" Sleep 300ms Enter
Wait+Screen@10s /Last sync/
Sleep 3.5s
