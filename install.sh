#!/bin/bash
# Installs relay: links the CLI into ~/.local/bin and adds the /relay skill.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
bin="${RELAY_BIN_DIR:-$HOME/.local/bin}"

command -v python3 >/dev/null || { echo "relay needs python3"; exit 1; }
command -v claude >/dev/null || { echo "relay needs Claude Code (claude) on your PATH"; exit 1; }

mkdir -p "$bin"
chmod +x "$here/relay"
ln -sf "$here/relay" "$bin/relay"
echo "linked $bin/relay"

"$here/relay" install-skill

case ":$PATH:" in
  *":$bin:"*) ;;
  *) echo
     echo "$bin isn't on your PATH yet. Add this to your ~/.zshrc (or ~/.bashrc):"
     echo "  export PATH=\"$bin:\$PATH\"" ;;
esac

echo
echo "Next: add your accounts."
echo "  relay add main --login     # the account claude is already logged into"
echo "  relay add second           # opens a browser login for another account"
echo "  relay status"
