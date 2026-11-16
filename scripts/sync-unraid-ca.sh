#!/usr/bin/env bash
# Sync Community Apps files from unraid/community-apps/ → borrowarr-unraid/ (nested git repo).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/unraid/community-apps"
DEST="$ROOT/borrowarr-unraid"

if [[ ! -d "$DEST/.git" ]]; then
  echo "Missing nested repo at $DEST — clone first:"
  echo "  git clone https://github.com/EverettIV/borrowarr-unraid.git \"$DEST\""
  exit 1
fi

rsync -a --delete \
  --exclude '.git' \
  "$SRC/" "$DEST/"

cp "$ROOT/unraid/MANUAL-SETUP.md" "$DEST/MANUAL-SETUP.md"

echo "Synced to $DEST"
echo "Next: cd borrowarr-unraid && git status && git commit && git push"