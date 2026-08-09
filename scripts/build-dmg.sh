#!/bin/bash
#
# Build a distributable, notarized, Sparkle-signed DMG for Agent Server.
#
# Prerequisites:
#   1. Xcode Archive + Developer ID export of "Agent Server.app" (the .app
#      must already be signed with Developer ID and notarized+stapled).
#   2. `brew install create-dmg`
#   3. Background TIFF at macos-app/dmg-assets/background.tiff
#   4. A `notarytool` keychain profile stored via:
#        xcrun notarytool store-credentials <profile-name> --apple-id ... --team-id ...
#      notarytool requests the app-specific password using a secure prompt.
#   5. Sparkle `sign_update` at ~/bin/sparkle/sign_update and the existing
#      private key in Doppler (see docs/SPARKLE.md).
#
# Usage:
#   ./scripts/build-dmg.sh <path-to-Agent-Server.app> <version> <notarytool-profile>
#
# Example:
#   ./scripts/build-dmg.sh ~/Desktop/AgentServer-export/Agent\ Server.app 1.0.0 agent-server
#
# Output:
#   dist/AgentServer-<version>.dmg               (signed, notarized, stapled)
#   dist/AgentServer-<version>.sparkle.txt       (edSignature + length for appcast)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:?Usage: $0 <path-to-Agent-Server.app> <version> <notarytool-profile>}"
VERSION="${2:?Usage: $0 <path-to-Agent-Server.app> <version> <notarytool-profile>}"
NOTARY_PROFILE="${3:?Usage: $0 <path-to-Agent-Server.app> <version> <notarytool-profile>}"

# Inherited from release.sh, which unlocks it before calling here. Set it when
# running this script on its own; leave it unset to use the default keychain.
NOTARY_KEYCHAIN="${NOTARY_KEYCHAIN:-}"

run_notarytool() {
  if [ -n "$NOTARY_KEYCHAIN" ] && [ -f "$NOTARY_KEYCHAIN" ]; then
    xcrun notarytool "$@" --keychain-profile "$NOTARY_PROFILE" --keychain "$NOTARY_KEYCHAIN"
  else
    xcrun notarytool "$@" --keychain-profile "$NOTARY_PROFILE"
  fi
}

SIGN_UPDATE="${SPARKLE_SIGN_UPDATE:-$HOME/bin/sparkle/sign_update}"
DOPPLER_PROJECT="${DOPPLER_PROJECT:-agent-server}"
DOPPLER_CONFIG="${DOPPLER_CONFIG:-prd}"

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

if ! command -v doppler >/dev/null 2>&1; then
  echo "Error: Doppler CLI not found"
  exit 1
fi

if [[ ! -x "$SIGN_UPDATE" ]]; then
  echo "Error: Sparkle sign_update not found at $SIGN_UPDATE"
  echo "Install it (see docs/SPARKLE.md) or set SPARKLE_SIGN_UPDATE to its path."
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
echo "DMG built: $DMG_OUT"
echo ""

# Codesign the DMG itself with Developer ID. Without this, Gatekeeper rejects
# the DMG with "no usable signature" even after notarization+stapling.
SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application: Prashant Sridharan (955GSY56UT)}"
echo "Codesigning DMG with: $SIGN_IDENTITY"
codesign --force --sign "$SIGN_IDENTITY" --timestamp "$DMG_OUT"

# Notarize the DMG. Sparkle 2 refuses to install an un-notarized DMG on macOS,
# so this is required, not optional.
echo "Notarizing DMG (this can take several minutes)..."
run_notarytool submit "$DMG_OUT" --wait

echo ""
echo "Stapling notarization ticket..."
xcrun stapler staple "$DMG_OUT"

echo ""
echo "Verifying notarization..."
xcrun stapler validate "$DMG_OUT"
spctl -a -t open --context context:primary-signature -v "$DMG_OUT"

echo ""
echo "Signing DMG with Sparkle..."
SPARKLE_OUT="${DMG_OUT%.dmg}.sparkle.txt"
doppler secrets get SPARKLE_PRIVATE_KEY \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain --no-read-env \
  | "$SIGN_UPDATE" --ed-key-file - "$DMG_OUT" \
  | tee "$SPARKLE_OUT"

echo ""
echo "============================================================"
echo "Release artifacts for v$VERSION"
echo "============================================================"
echo "  DMG:           $DMG_OUT"
echo "  Sparkle info:  $SPARKLE_OUT"
echo ""
echo "Next steps:"
echo "  When invoked by scripts/release.sh, publication continues with the R2 upload."
echo "  For a manual build, follow docs/SPARKLE.md, then test Check for Updates"
echo "  from a previous version of the app."
