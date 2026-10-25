#!/bin/bash
# Builds the given commit (default: main) in a dedicated worktree and installs
# it to /Applications. Run by .git/hooks/post-merge after merges into main.
# If the app is open, waits for it to quit rather than killing running agents.
set -euo pipefail

REF="${1:-main}"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
BUILD_DIR="$HOME/Library/Caches/vibe-ide/build"
LOCK_DIR="$HOME/Library/Caches/vibe-ide/update.lock"
DEST="${APP_DEST:-/Applications/Vibe IDE.app}"

notify() {
  osascript -e "display notification \"$1\" with title \"Vibe IDE\"" >/dev/null 2>&1 || true
}

mkdir -p "$(dirname "$BUILD_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another update is already running; skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT
trap 'notify "Update failed — see ~/Library/Logs/vibe-ide-update.log"' ERR

SHA="$(git -C "$REPO" rev-parse "$REF")"
echo "[$(date)] Building $REF ($SHA)"

if [ ! -e "$BUILD_DIR/.git" ]; then
  git -C "$REPO" worktree prune
  git -C "$REPO" worktree add --detach "$BUILD_DIR" "$SHA"
else
  git -C "$BUILD_DIR" checkout --detach --force "$SHA"
  git -C "$BUILD_DIR" clean -fdx -e node_modules
fi

cd "$BUILD_DIR"
pnpm install --frozen-lockfile
pnpm exec electron-vite build
pnpm exec electron-builder --mac --dir

BUILT="$(find "$BUILD_DIR/dist" -maxdepth 2 -name 'Vibe IDE.app' -type d | head -n 1)"
[ -n "$BUILT" ]

if pgrep -f "$DEST/Contents/MacOS/" >/dev/null; then
  notify "Update ready — it will install when you quit Vibe IDE."
  echo "App is running; waiting for it to quit."
  while pgrep -f "$DEST/Contents/MacOS/" >/dev/null; do sleep 5; done
fi

STAGING="$DEST.new"
rm -rf "$STAGING"
ditto "$BUILT" "$STAGING"
rm -rf "$DEST"
mv "$STAGING" "$DEST"

echo "[$(date)] Installed $SHA to $DEST"
notify "Updated to ${SHA:0:7}."
