# Direct distribution (outside the Mac App Store)

Agent Server is distributed directly because it needs unsandboxed filesystem access to `~/.agent-server/` and the ability to spawn a Node.js child process. These are not compatible with the Mac App Store sandbox.

## Prerequisites

1. **Apple Developer account** ($99/year) at https://developer.apple.com
2. **Developer ID Application certificate** (for code signing)
3. **Developer ID Installer certificate** (for `.pkg` distribution, optional)
4. **App-specific password** for notarization (generated at https://appleid.apple.com)

## One-time setup

### Create certificates

1. Open Xcode > Settings > Accounts > Manage Certificates
2. Click "+" and create a "Developer ID Application" certificate
3. Optionally create a "Developer ID Installer" certificate for `.pkg` builds

Or use the Apple Developer portal: Certificates, Identifiers & Profiles > Create a Certificate.

### Store credentials for notarization

```bash
xcrun notarytool store-credentials "AgentServer" \
  --apple-id "your@email.com" \
  --team-id "YOUR_TEAM_ID" \
  --password "your-app-specific-password"
```

This saves credentials in the Keychain under the profile name "AgentServer" so you don't pass them on every invocation.

### Find your Team ID

```bash
# Lists all teams associated with your Apple ID
xcrun notarytool store-credentials --help
# Or check: https://developer.apple.com/account > Membership Details
```

## Build and sign

### 1. Build the server

```bash
cd server-app
npm run build
```

### 2. Generate the Xcode project

```bash
cd macos-app
xcodegen generate
```

### 3. Build and sign the app

```bash
xcodebuild -project AgentServer.xcodeproj \
  -scheme AgentServer \
  -configuration Release \
  -archivePath build/AgentServer.xcarchive \
  archive \
  CODE_SIGN_IDENTITY="Developer ID Application: Your Name (TEAM_ID)" \
  DEVELOPMENT_TEAM="YOUR_TEAM_ID"
```

### 4. Export the archive

Create an `ExportOptions.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>developer-id</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
```

Then export:

```bash
xcodebuild -exportArchive \
  -archivePath build/AgentServer.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist
```

This produces `build/export/Agent Server.app`.

## Notarize

Apple requires notarization for all Developer ID-signed apps. Without it, Gatekeeper blocks the app on first launch.

### 1. Create a zip for notarization

```bash
ditto -c -k --keepParent "build/export/Agent Server.app" build/AgentServer.zip
```

### 2. Submit for notarization

```bash
xcrun notarytool submit build/AgentServer.zip \
  --keychain-profile "AgentServer" \
  --wait
```

The `--wait` flag blocks until Apple finishes processing (usually 2-5 minutes). You'll see a status of "Accepted" on success.

### 3. Check the log if it fails

```bash
xcrun notarytool log <submission-id> --keychain-profile "AgentServer"
```

Common failures:
- Missing hardened runtime entitlement (already set in `project.yml`)
- Unsigned frameworks or binaries inside the bundle
- Linking against private APIs

### 4. Staple the notarization ticket

```bash
xcrun stapler staple "build/export/Agent Server.app"
```

Stapling embeds the notarization ticket in the app so users don't need an internet connection for Gatekeeper to verify it.

## Create a DMG (recommended for distribution)

```bash
# Install create-dmg if you don't have it
brew install create-dmg

create-dmg \
  --volname "Agent Server" \
  --volicon "macos-app/AgentServer/Assets.xcassets/AppIcon.appiconset/icon_512x512.png" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "Agent Server.app" 150 190 \
  --hide-extension "Agent Server.app" \
  --app-drop-link 450 190 \
  "build/AgentServer.dmg" \
  "build/export/Agent Server.app"
```

Then notarize and staple the DMG too:

```bash
xcrun notarytool submit build/AgentServer.dmg \
  --keychain-profile "AgentServer" \
  --wait

xcrun stapler staple build/AgentServer.dmg
```

## Verify everything

```bash
# Verify code signing
codesign --verify --deep --strict "build/export/Agent Server.app"

# Verify notarization
spctl --assess --type execute "build/export/Agent Server.app"

# Check Gatekeeper acceptance
spctl --assess --verbose=4 "build/export/Agent Server.app"
```

All three should pass without errors.

## Automating with a script

Save as `macos-app/scripts/release.sh`:

```bash
#!/bin/bash
set -euo pipefail

TEAM_ID="${TEAM_ID:?Set TEAM_ID environment variable}"
PROFILE="AgentServer"

echo "Building server..."
(cd server-app && npm run build)

echo "Generating Xcode project..."
(cd macos-app && xcodegen generate)

echo "Archiving..."
xcodebuild -project macos-app/AgentServer.xcodeproj \
  -scheme AgentServer \
  -configuration Release \
  -archivePath build/AgentServer.xcarchive \
  archive \
  DEVELOPMENT_TEAM="$TEAM_ID"

echo "Exporting..."
xcodebuild -exportArchive \
  -archivePath build/AgentServer.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist macos-app/ExportOptions.plist

echo "Notarizing..."
ditto -c -k --keepParent "build/export/Agent Server.app" build/AgentServer.zip
xcrun notarytool submit build/AgentServer.zip \
  --keychain-profile "$PROFILE" \
  --wait

echo "Stapling..."
xcrun stapler staple "build/export/Agent Server.app"

echo "Creating DMG..."
create-dmg \
  --volname "Agent Server" \
  --window-pos 200 120 \
  --window-size 600 400 \
  --icon-size 100 \
  --icon "Agent Server.app" 150 190 \
  --hide-extension "Agent Server.app" \
  --app-drop-link 450 190 \
  "build/AgentServer.dmg" \
  "build/export/Agent Server.app"

xcrun notarytool submit build/AgentServer.dmg \
  --keychain-profile "$PROFILE" \
  --wait
xcrun stapler staple build/AgentServer.dmg

echo "Done. Output: build/AgentServer.dmg"
```

## Auto-updates (future)

For automatic updates without the App Store, consider Sparkle (https://sparkle-project.org). It is the standard for direct-distribution macOS apps. It handles:

- Checking for updates on a schedule
- Downloading and verifying signed updates
- Replacing the app in place
- Delta updates (smaller downloads)

Setup requires hosting an appcast XML file and signing updates with an EdDSA key. Sparkle is a Swift package you add to the Xcode project.

## Entitlements

The current entitlements file (`AgentServer.entitlements`) is already configured for direct distribution:

- `com.apple.security.app-sandbox`: `false` (unsandboxed)
- `com.apple.security.network.client`: `true` (localhost API + Anthropic API)
- `com.apple.security.files.user-selected.read-write`: `true` (file access)

Hardened runtime is enabled in `project.yml` (`ENABLE_HARDENED_RUNTIME: true`), which is required for notarization.

## Checklist

- [ ] Apple Developer account active
- [ ] Developer ID Application certificate created
- [ ] Notarization credentials stored in Keychain
- [ ] `ExportOptions.plist` created with your Team ID
- [ ] `server-app/dist/` is up to date (`npm run build`)
- [ ] Archive, export, notarize, staple
- [ ] Verify with `codesign` and `spctl`
- [ ] DMG created and notarized
- [ ] Test on a clean Mac (download DMG, open, drag to Applications, launch)
