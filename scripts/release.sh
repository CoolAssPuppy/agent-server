#!/bin/bash
#
# One-shot release automation for Agent Server.
#
# Does the whole thing:
#   1. Runs server and macOS behavior checks
#   2. Bumps the macOS and bundled server versions
#   3. Builds the server and regenerates the Xcode project
#   4. Archives + exports Developer ID .app
#   5. Notarizes + staples the .app
#   6. Builds DMG, notarizes + staples DMG, Sparkle-signs it
#   7. Uploads DMG + appcast.xml to Cloudflare R2 (strategic-nerds-downloads)
#   8. Verifies everything is live
#
# Prerequisites:
#   - notarytool keychain profile "agent-server" (see docs/SPARKLE.md)
#   - Sparkle sign_update at ~/bin/sparkle/sign_update
#   - create-dmg installed (brew install create-dmg)
#   - doppler CLI logged in with access to the agent-server/prd config
#     (provides CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL)
#   - workspace dependencies installed with pnpm
#   - python3 on PATH (for appcast manipulation)
#   - xcodegen on PATH
#
# Usage:
#   ./scripts/release.sh <version> "<release notes HTML>"
#
# Example:
#   ./scripts/release.sh 2.3.0 "<li>New feature.</li><li>Bug fixes.</li>"

set -euo pipefail

VERSION="${1:?Usage: $0 <version> \"<release notes HTML>\"}"
NOTES="${2:?Usage: $0 <version> \"<release notes HTML>\"}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MACOS_APP="$REPO_ROOT/macos-app"
DIST="$REPO_ROOT/dist"
SCRIPTS="$REPO_ROOT/scripts"
. "$SCRIPTS/release-helpers.sh"

NOTARY_PROFILE="agent-server"
SPARKLE_SIGN_UPDATE="${SPARKLE_SIGN_UPDATE:-$HOME/bin/sparkle/sign_update}"
SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application: Prashant Sridharan (955GSY56UT)}"
APP_FOLDER="agent-server"
DUB_SHORTLINK="https://coolasspuppy.com/agent-server-updates"

DOPPLER_PROJECT="agent-server"
DOPPLER_CONFIG="prd"

WRANGLER=(pnpm exec wrangler)

#----------------------------------------------------------------------
# Preflight
#----------------------------------------------------------------------
for tool in xcodebuild xcodegen create-dmg doppler python3 "$SPARKLE_SIGN_UPDATE"; do
  if ! command -v "$tool" >/dev/null 2>&1 && [ ! -x "$tool" ]; then
    echo "Error: required tool not found: $tool"
    exit 1
  fi
done

# Both the Swift checks and the archive need a full Xcode. On a Mac where
# xcode-select points at CommandLineTools, `swift test` fails with "no such
# module 'XCTest'" a few minutes in, which reads as a broken test suite rather
# than a missing toolchain. Choosing one here needs no sudo and leaves the
# machine's own selection alone.
if ! xcrun --find xctest >/dev/null 2>&1; then
  for candidate in /Applications/Xcode.app /Applications/Xcode*.app; do
    [ -d "$candidate/Contents/Developer" ] || continue
    export DEVELOPER_DIR="$candidate/Contents/Developer"
    break
  done
  if ! xcrun --find xctest >/dev/null 2>&1; then
    echo "Error: no full Xcode found. xcode-select points at $(xcode-select -p)."
    echo "Install Xcode, or export DEVELOPER_DIR=/path/to/Xcode.app/Contents/Developer."
    exit 1
  fi
  echo "==> Using Xcode at $DEVELOPER_DIR"
fi

if ! "${WRANGLER[@]}" --version >/dev/null 2>&1; then
  echo "Error: pinned wrangler is unavailable. Run pnpm install --frozen-lockfile."
  exit 1
fi

# Where the notarization profile lives. The login keychain refuses writes from
# a process with no window server access, so `store-credentials` cannot run
# from an automated session, and a release from one would stop here. Keeping
# the profile in a dedicated keychain removes that dependency: it is unlocked
# with a password from Doppler rather than by a person clicking Allow.
#
# Unset NOTARY_KEYCHAIN to fall back to the default keychain search.
NOTARY_KEYCHAIN="${NOTARY_KEYCHAIN:-$HOME/Library/Keychains/agent-server-notary.keychain-db}"
export NOTARY_KEYCHAIN

run_notarytool() {
  if [ -n "$NOTARY_KEYCHAIN" ] && [ -f "$NOTARY_KEYCHAIN" ]; then
    xcrun notarytool "$@" --keychain-profile "$NOTARY_PROFILE" --keychain "$NOTARY_KEYCHAIN"
  else
    xcrun notarytool "$@" --keychain-profile "$NOTARY_PROFILE"
  fi
}

# Unlock first: a dedicated keychain locks on its own schedule, and finding
# that out mid-notarization means an archive has already been uploaded.
ensure_notary_ready() {
  if [ -f "$NOTARY_KEYCHAIN" ]; then
    NOTARY_KEYCHAIN_PASSWORD="${NOTARY_KEYCHAIN_PASSWORD:-$(doppler secrets get NOTARY_KEYCHAIN_PASSWORD --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || true)}"
    if [ -n "$NOTARY_KEYCHAIN_PASSWORD" ]; then
      security unlock-keychain -p "$NOTARY_KEYCHAIN_PASSWORD" "$NOTARY_KEYCHAIN"
    fi
  fi

  if run_notarytool history >/dev/null 2>&1; then
    return 0
  fi

  echo "Error: notarization keychain profile '$NOTARY_PROFILE' is missing or invalid."
  echo "Store it with:"
  echo "  xcrun notarytool store-credentials \"$NOTARY_PROFILE\" \\"
  echo "    --apple-id <apple-id> --team-id <team-id> --password <app-specific-password> \\"
  echo "    --keychain \"$NOTARY_KEYCHAIN\""
  echo "Create that keychain first if it does not exist, and put its password in"
  echo "Doppler as NOTARY_KEYCHAIN_PASSWORD so an unattended release can unlock it."
  exit 1
}

# Checked here rather than at step 6. A missing credential used to surface
# after the tests, the version bump, and a ten minute archive, with the tree
# already rewritten for a release that could not finish.
echo "==> Checking the notarization credential"
ensure_notary_ready

mkdir -p "$DIST"

R2_PUBLIC_BASE=$(doppler secrets get R2_PUBLIC_BASE_URL \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || echo "https://downloads.strategicnerds.com")
if [ -z "$R2_PUBLIC_BASE" ]; then
  echo "Error: missing R2_PUBLIC_BASE_URL in Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG"
  exit 1
fi
R2_APPCAST_URL="$R2_PUBLIC_BASE/apps/$APP_FOLDER/appcast.xml"
LIVE_APPCAST="$DIST/appcast.live.xml"
echo "==> Capturing and validating the live appcast baseline"
BASELINE_DIGEST=$(PYTHONPATH="$SCRIPTS" python3 -m release_tools.cli snapshot \
  --url "$R2_APPCAST_URL" --output "$LIVE_APPCAST")

#----------------------------------------------------------------------
# 1. Verify behavior before changing release metadata
#----------------------------------------------------------------------
echo "==> Running server checks"
(cd "$REPO_ROOT/server-app" && pnpm test && pnpm run type-check && pnpm run lint)

echo "==> Running macOS behavior checks"
(cd "$MACOS_APP/AgentServerSwiftTests" && swift test)

#----------------------------------------------------------------------
# 2. Bump version in project.yml
#----------------------------------------------------------------------
echo "==> Bumping version to $VERSION"
NEW_BUILD=$(PYTHONPATH="$SCRIPTS" python3 -m release_tools.cli prepare \
  --version "$VERSION" \
  --project "$MACOS_APP/project.yml" \
  --package "$REPO_ROOT/server-app/package.json" \
  --live "$LIVE_APPCAST")
echo "  MARKETING_VERSION=$VERSION CURRENT_PROJECT_VERSION=$NEW_BUILD"
echo "  server-app/package.json version=$VERSION"

echo "==> Building bundled server"
(cd "$REPO_ROOT/server-app" && pnpm run build)

#----------------------------------------------------------------------
# 3. Regenerate project
#----------------------------------------------------------------------
echo "==> Regenerating Xcode project"
(cd "$MACOS_APP" && xcodegen generate)

echo "==> Loading the public PostHog project key"
POSTHOG_PUBLIC_KEY=$(doppler secrets get POSTHOG_PUBLIC_KEY \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || true)
if [ -z "$POSTHOG_PUBLIC_KEY" ]; then
  echo "Error: missing POSTHOG_PUBLIC_KEY in Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG"
  exit 1
fi

#----------------------------------------------------------------------
# 4. Archive
#----------------------------------------------------------------------
ARCHIVE="$DIST/AgentServer-$VERSION.xcarchive"
rm -rf "$ARCHIVE"
echo "==> Archiving"
xcodebuild -project "$MACOS_APP/AgentServer.xcodeproj" \
  -scheme AgentServer \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  POSTHOG_API_KEY="$POSTHOG_PUBLIC_KEY" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$SIGN_IDENTITY" \
  DEVELOPMENT_TEAM=955GSY56UT \
  archive | xcpretty 2>/dev/null || \
xcodebuild -project "$MACOS_APP/AgentServer.xcodeproj" \
  -scheme AgentServer \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  POSTHOG_API_KEY="$POSTHOG_PUBLIC_KEY" \
  CODE_SIGN_STYLE=Manual \
  CODE_SIGN_IDENTITY="$SIGN_IDENTITY" \
  DEVELOPMENT_TEAM=955GSY56UT \
  archive >/dev/null

#----------------------------------------------------------------------
# 5. Export Developer ID .app
#----------------------------------------------------------------------
EXPORT_DIR="$DIST/export-$VERSION"
rm -rf "$EXPORT_DIR"
echo "==> Exporting .app"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$SCRIPTS/export-options.plist" >/dev/null

APP_PATH="$EXPORT_DIR/Agent Server.app"
if [ ! -d "$APP_PATH" ]; then
  echo "Error: export did not produce $APP_PATH"
  exit 1
fi

#----------------------------------------------------------------------
# 6. Notarize + staple the .app
#----------------------------------------------------------------------
# The credential was proved in preflight. Prove it again: an archive and an
# export sit between the two, long enough for a dedicated keychain to relock.
ensure_notary_ready

echo "==> Notarizing .app (takes a few minutes)"
APP_ZIP="$DIST/export-$VERSION/AgentServer.app.zip"
notarize_app_archive "$APP_PATH" "$APP_ZIP"

echo "==> Stapling .app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

#----------------------------------------------------------------------
# 7. DMG + notarize + staple + Sparkle sign
#----------------------------------------------------------------------
echo "==> Building DMG"
"$SCRIPTS/build-dmg.sh" "$APP_PATH" "$VERSION" "$NOTARY_PROFILE"

DMG="$DIST/AgentServer-$VERSION.dmg"
SPARKLE_TXT="$DIST/AgentServer-$VERSION.sparkle.txt"

if [ ! -f "$DMG" ] || [ ! -f "$SPARKLE_TXT" ]; then
  echo "Error: DMG or sparkle signature missing after build-dmg.sh"
  exit 1
fi

#----------------------------------------------------------------------
# 8. Stage, validate, and publish in recoverable order
#----------------------------------------------------------------------
echo "==> Fetching Cloudflare R2 credentials from Doppler ($DOPPLER_PROJECT/$DOPPLER_CONFIG)"
export CLOUDFLARE_API_TOKEN
CLOUDFLARE_API_TOKEN=$(doppler secrets get CLOUDFLARE_API_TOKEN \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || true)
export CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_ACCOUNT_ID=$(doppler secrets get CLOUDFLARE_ACCOUNT_ID \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || true)
R2_BUCKET=$(doppler secrets get R2_BUCKET_NAME \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || echo "strategic-nerds-downloads")
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ] || [ -z "$R2_BUCKET" ]; then
  echo "Error: missing Cloudflare credentials or bucket in Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG"
  exit 1
fi

DMG_NAME="AgentServer-$VERSION.dmg"
ENCLOSURE_URL="$R2_PUBLIC_BASE/apps/$APP_FOLDER/$DMG_NAME"
PUB_DATE=$(LC_ALL=C date -u +"%a, %d %b %Y %H:%M:%S +0000")
STAGED_APPCAST="$DIST/appcast.staged.xml"
APPCAST="$DIST/appcast.xml"

echo "==> Staging and validating appcast.xml"
PYTHONPATH="$SCRIPTS" python3 -m release_tools.cli stage \
  --version "$VERSION" --build "$NEW_BUILD" \
  --url "$ENCLOSURE_URL" --pub-date "$PUB_DATE" --notes "$NOTES" \
  --live "$LIVE_APPCAST" --signature-file "$SPARKLE_TXT" --dmg "$DMG" \
  --output "$STAGED_APPCAST"

echo "==> Publishing immutable DMG, appcast, then latest alias"
PYTHONPATH="$SCRIPTS" python3 -m release_tools.cli publish \
  --version "$VERSION" --build "$NEW_BUILD" \
  --url "$ENCLOSURE_URL" --pub-date "$PUB_DATE" --notes "$NOTES" \
  --signature-file "$SPARKLE_TXT" --dmg "$DMG" \
  --staged-appcast "$STAGED_APPCAST" --tracked-appcast "$APPCAST" \
  --baseline-digest "$BASELINE_DIGEST" --bucket "$R2_BUCKET" \
  --public-base "$R2_PUBLIC_BASE" --dub-url "$DUB_SHORTLINK"

echo ""
echo "============================================================"
echo "Released Agent Server $VERSION (build $NEW_BUILD)"
echo ""
echo "Local artifacts:"
echo "  $DMG"
echo "  $SPARKLE_TXT"
echo "  $APPCAST"
echo ""
echo "Live:"
echo "  $ENCLOSURE_URL"
echo "  $R2_APPCAST_URL"
echo "  $DUB_SHORTLINK"
echo ""
echo "Don't forget to commit: project.yml + dist/appcast.xml"
echo "============================================================"
