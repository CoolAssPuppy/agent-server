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
#   - notarytool keychain profile "agent-server" (see SPARKLE.md step 6c)
#   - Sparkle sign_update at ~/bin/sparkle/sign_update
#   - create-dmg installed (brew install create-dmg)
#   - doppler CLI logged in with access to the agent-server/prd config
#     (provides CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, R2_BUCKET_NAME, R2_PUBLIC_BASE_URL)
#   - wrangler available (npm i -g wrangler) or npx on PATH
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

NOTARY_PROFILE="agent-server"
SPARKLE_SIGN_UPDATE="${SPARKLE_SIGN_UPDATE:-$HOME/bin/sparkle/sign_update}"
SIGN_IDENTITY="Developer ID Application: Prashant Sridharan (955GSY56UT)"

APP_FOLDER="agent-server"
DUB_SHORTLINK="https://coolasspuppy.com/agent-server-updates"

DOPPLER_PROJECT="agent-server"
DOPPLER_CONFIG="prd"

# Notarization auth. Prefer inline credentials sourced from Doppler so a release
# works on any machine with Doppler access — no per-machine `notarytool
# store-credentials` keychain bootstrap required. Falls back to the keychain
# profile when the app-specific password isn't in Doppler.
NOTARY_APPLE_ID="${NOTARY_APPLE_ID:-prashant_sridharan@hotmail.com}"
NOTARY_TEAM_ID="955GSY56UT"
NOTARY_PASSWORD="$(doppler secrets get SPARKLE_APP_SPECIFIC_PASSWORD \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || true)"
if [ -n "$NOTARY_PASSWORD" ]; then
  NOTARY_AUTH=(--apple-id "$NOTARY_APPLE_ID" --team-id "$NOTARY_TEAM_ID" --password "$NOTARY_PASSWORD")
else
  NOTARY_AUTH=(--keychain-profile "$NOTARY_PROFILE")
fi
export NOTARY_APPLE_ID NOTARY_TEAM_ID NOTARY_PASSWORD

if command -v wrangler >/dev/null 2>&1; then
  WRANGLER=(wrangler)
else
  WRANGLER=(pnpm dlx wrangler)
fi

#----------------------------------------------------------------------
# Preflight
#----------------------------------------------------------------------
for tool in xcodebuild xcodegen create-dmg doppler python3 "$SPARKLE_SIGN_UPDATE"; do
  if ! command -v "$tool" >/dev/null 2>&1 && [ ! -x "$tool" ]; then
    echo "Error: required tool not found: $tool"
    exit 1
  fi
done

if ! "${WRANGLER[@]}" --version >/dev/null 2>&1; then
  echo "Error: wrangler not available. Install with: npm i -g wrangler"
  exit 1
fi

if ! xcrun notarytool history "${NOTARY_AUTH[@]}" >/dev/null 2>&1; then
  echo "Error: notarization credentials invalid (using ${NOTARY_AUTH[0]})."
  echo "Ensure SPARKLE_APP_SPECIFIC_PASSWORD is set in Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG,"
  echo "or store a keychain profile: xcrun notarytool store-credentials \"$NOTARY_PROFILE\" --apple-id ... --team-id ... --password ..."
  exit 1
fi

mkdir -p "$DIST"

R2_PUBLIC_BASE=$(doppler secrets get R2_PUBLIC_BASE_URL \
  --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG" --plain 2>/dev/null || echo "https://downloads.strategicnerds.com")
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
# 2. Regenerate project
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
# 3. Archive
#----------------------------------------------------------------------
ARCHIVE="$DIST/AgentServer-$VERSION.xcarchive"
rm -rf "$ARCHIVE"
echo "==> Archiving"
xcodebuild -project "$MACOS_APP/AgentServer.xcodeproj" \
  -scheme AgentServer \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  POSTHOG_API_KEY="$POSTHOG_PUBLIC_KEY" \
  archive | xcpretty 2>/dev/null || \
xcodebuild -project "$MACOS_APP/AgentServer.xcodeproj" \
  -scheme AgentServer \
  -configuration Release \
  -archivePath "$ARCHIVE" \
  POSTHOG_API_KEY="$POSTHOG_PUBLIC_KEY" \
  archive >/dev/null

#----------------------------------------------------------------------
# 4. Export Developer ID .app
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
# 5. Notarize + staple the .app
#----------------------------------------------------------------------
echo "==> Notarizing .app (takes a few minutes)"
APP_ZIP="$DIST/export-$VERSION/AgentServer.app.zip"
ditto -c -k --sequesterRsrc --keepParent "$APP_PATH" "$APP_ZIP"
xcrun notarytool submit "$APP_ZIP" "${NOTARY_AUTH[@]}" --wait
rm -f "$APP_ZIP"

echo "==> Stapling .app"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

#----------------------------------------------------------------------
# 6. DMG + notarize + staple + Sparkle sign
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
# 7. Stage, validate, and publish in recoverable order
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
if [ -z "$CLOUDFLARE_API_TOKEN" ] || [ -z "$CLOUDFLARE_ACCOUNT_ID" ]; then
  echo "Error: missing CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID in Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG"
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
