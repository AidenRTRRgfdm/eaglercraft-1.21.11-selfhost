#!/bin/zsh
set -eu
cd -- "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  print -u2 'Node.js 24 or newer is required. Install Node.js, then open Start Bridge.command again.'
  read -r '?Press Return to close.'
  exit 1
fi
exec node Server.js
