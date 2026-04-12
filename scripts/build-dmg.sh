#!/bin/bash
#
# Build a distributable DMG for Agent Server.
#
# Prerequisites:
#   1. Xcode Archive + Developer ID export of "Agent Server.app" (notarized)
#   2. `brew install create-dmg`
#   3. Background PNG at macos-app/dmg-assets/background.png (1320x800)
#
# Usage:
#   ./scripts/build-dmg.sh <path-to-exported-Agent-Server.app> [version]
#
# Example:
#   ./scripts/build-dmg.sh ~/Desktop/AgentServer-export/Agent\ Server.app 1.0.0
#
# Output:
#   dist/AgentServer-<version>.dmg

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:?Usage: $0 <path-to-Agent-Server.app> [version]}"
VERSION="${2:-1.0.0}"

BACKGROUND="$REPO_ROOT/macos-app/dmg-assets/background.tiff"
DMG_OUT="$REPO_ROOT/dist/AgentServer-$VERSION.dmg"

# Validate inputs
if [[ ! -d "$APP_PATH" ]]; then
  echo "Error: App not found at $APP_PATH"
  exit 1
fi

if [[ ! -f "$BACKGROUND" ]]; then
  echo "Error: Background TIFF not found at $BACKGROUND"
  echo "To (re)generate it from a 2640x1600 PNG export:"
  echo "  cd macos-app/dmg-assets"
  echo "  sips --resampleHeightWidth 800 1320 background.png --out background-2x.png"
  echo "  sips --resampleHeightWidth 400 660 background.png --out background-1x.png"
  echo "  tiffutil -cathidpicheck background-1x.png background-2x.png -out background.tiff"
  echo "  rm background-1x.png background-2x.png"
  exit 1
fi

if ! command -v create-dmg >/dev/null 2>&1; then
  echo "Error: create-dmg not installed. Run: brew install create-dmg"
  exit 1
fi

# Clean previous build
mkdir -p "$REPO_ROOT/dist"
rm -f "$DMG_OUT"

echo "Building DMG for Agent Server v$VERSION..."
echo "  App:        $APP_PATH"
echo "  Background: $BACKGROUND"
echo "  Output:     $DMG_OUT"
echo ""

# Window coordinates match the drop-zone brackets in background.png.
#
# Background image is 1320x800 (2x retina for a 660x400 window).
# In window points (half of image px), drop zone centers are:
#   - Agent Server.app:      (355, 200)  <- left drop zone
#   - Applications symlink:  (555, 200)  <- right drop zone
#
# If you edit the PNG and move the brackets, update these numbers too.
create-dmg \
  --volname "Agent Server" \
  --background "$BACKGROUND" \
  --window-pos 200 120 \
  --window-size 660 400 \
  --icon-size 96 \
  --icon "Agent Server.app" 355 200 \
  --app-drop-link 555 200 \
  --hide-extension "Agent Server.app" \
  --no-internet-enable \
  --hdiutil-quiet \
  "$DMG_OUT" \
  "$APP_PATH"

echo ""
echo "Done: $DMG_OUT"
echo ""
echo "Next steps:"
echo "  1. Mount and inspect:  open \"$DMG_OUT\""
echo "  2. Verify signing:     codesign --verify --deep --strict --verbose=2 \"$DMG_OUT\""
echo "  3. (Optional) Notarize the DMG itself for extra polish:"
echo "       xcrun notarytool submit \"$DMG_OUT\" --keychain-profile <profile> --wait"
echo "       xcrun stapler staple \"$DMG_OUT\""
