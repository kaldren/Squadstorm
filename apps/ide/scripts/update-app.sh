#!/bin/bash
# Builds the given commit (default: main) in a dedicated worktree and installs
# it to /Applications. Run by .git/hooks/post-merge after merges into main.
# If the app is open, waits for it to quit rather than killing running agents.
set -euo pipefail

REF="${1:-main}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
APP_DIR="apps/ide"
BUILD_DIR="$HOME/Library/Caches/squadstorm-ide/build"
LOCK_DIR="$HOME/Library/Caches/squadstorm-ide/update.lock"
DEST="${APP_DEST:-/Applications/Squadstorm.app}"

notify() {
  osascript -e "display notification \"$1\" with title \"Squadstorm\"" >/dev/null 2>&1 || true
}

mkdir -p "$(dirname "$BUILD_DIR")"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another update is already running; skipping."
  exit 0
fi
trap 'rmdir "$LOCK_DIR"' EXIT
trap 'notify "Update failed — see ~/Library/Logs/squadstorm-ide-update.log"' ERR

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
cd "$APP_DIR"
pnpm exec electron-vite build
pnpm exec electron-builder --mac --dir

BUILT="$(find "$BUILD_DIR/$APP_DIR/dist" -maxdepth 2 -name 'Squadstorm.app' -type d | head -n 1)"
[ -n "$BUILT" ]

LEGACY_DEST="$(dirname "$DEST")/Squadstorm IDE.app"
running() { pgrep -f "$DEST/Contents/MacOS/" >/dev/null || pgrep -f "$LEGACY_DEST/Contents/MacOS/" >/dev/null; }

if running; then
  notify "Update ready — it will install when you quit Squadstorm."
  echo "App is running; waiting for it to quit."
  while running; do sleep 5; done
fi
rm -rf "$LEGACY_DEST"

STAGING="$DEST.new"
rm -rf "$STAGING"
ditto "$BUILT" "$STAGING"
rm -rf "$DEST"
mv "$STAGING" "$DEST"

echo "[$(date)] Installed $SHA to $DEST"
notify "Updated to ${SHA:0:7}."
