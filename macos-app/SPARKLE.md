# Sparkle auto-update setup

The macOS app ships with [Sparkle 2](https://sparkle-project.org) wired in. Users get "Check for Updates..." in the status-bar right-click menu and in Settings > Updates, plus daily automatic checks.

Appcast and release DMGs are hosted in the **Cloudflare R2 `strategic-nerds-downloads` bucket** (shared with Mail Notifier and Meeting Notifier — each app has its own folder under `apps/`). The bucket is exposed publicly at `https://downloads.strategicnerds.com`. The appcast URL is fronted by a **Dub.co shortlink** at `https://coolasspuppy.com/agent-server-updates` so the feed location can be moved later without re-shipping the app. Enclosure (DMG) URLs point directly at R2.

URLs:

- **Feed (baked into the app)**: `https://coolasspuppy.com/agent-server-updates` (Dub shortlink)
- **Appcast destination**: `https://downloads.strategicnerds.com/apps/agent-server/appcast.xml`
- **DMG pattern**: `https://downloads.strategicnerds.com/apps/agent-server/AgentServer-<version>.dmg`
- **Latest DMG (stable URL)**: `https://downloads.strategicnerds.com/apps/agent-server/AgentServer-latest.dmg` (overwritten on every release)

Do steps 1 through 5 once. Then step 6 on every release.

## 1. Generate the signing key (one time, irreversible)

Sparkle's `generate_keys` tool creates an EdDSA (Ed25519) key pair. The private key lives in your macOS keychain. **If you lose it, every installed copy of the app is permanently stranded** because it can no longer verify new updates. There is no recovery.

After running `xcodebuild` or opening the project in Xcode once (so SPM resolves Sparkle), the tool is at:

```
~/Library/Developer/Xcode/DerivedData/AgentServer-*/SourcePackages/artifacts/sparkle/Sparkle/bin/generate_keys
```

Run it:

```bash
cd ~/Library/Developer/Xcode/DerivedData/AgentServer-*/SourcePackages/artifacts/sparkle/Sparkle/bin
./generate_keys
```

It will:
- Generate a new key pair (first run only — on later runs it just prints the existing public key).
- Store the private key in the login keychain under "Private key for signing Sparkle updates".
- Print the base64 **public** key to stdout.

**Back up the private key now.** Export from Keychain Access:

1. Open Keychain Access, select "login" keychain.
2. Search for "Private key for signing Sparkle updates".
3. Right-click > Export > save as a `.p12` to a secure location (1Password, a hardware key, an offline drive — not your repo, not iCloud Drive shared with teammates).
4. Use a strong password when exporting and store it alongside.

Copy the public key string that `generate_keys` printed. You'll paste it in step 3.

## 2. Confirm the R2 bucket

The `strategic-nerds-downloads` R2 bucket is public via `downloads.strategicnerds.com`. Each app lives under `apps/<app-name>/`. No file size limit issues — R2 handles multi-GB objects fine.

Public URL pattern:

```
https://downloads.strategicnerds.com/apps/agent-server/<filename>
```

The release script automatically uploads `dist/appcast.xml` to `apps/agent-server/appcast.xml` on every release. The bootstrap appcast (an empty channel) is checked into `dist/appcast.xml` and looks like:

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Agent Server</title>
    <link>https://downloads.strategicnerds.com/apps/agent-server/appcast.xml</link>
    <description>Agent Server updates</description>
    <language>en</language>
  </channel>
</rss>
```

After the first release, verify by opening `https://downloads.strategicnerds.com/apps/agent-server/appcast.xml` in a browser — you should see the XML with at least one `<item>`.

## 3. Confirm the Dub.co shortlink

The shortlink is already created:

- **Short URL**: `https://coolasspuppy.com/agent-server-updates`
- **Destination URL**: `https://downloads.strategicnerds.com/apps/agent-server/appcast.xml`

In the Dub dashboard, verify:
- Cloaking/frame is **OFF**. Sparkle needs a plain HTTP redirect, not an iframe wrapper.
- Password is **OFF**. Link expiration is **OFF**.

Test the redirect:

```bash
curl -sI "https://coolasspuppy.com/agent-server-updates" | grep -i '^location:'
```

You should see a `location:` header pointing at the R2 URL above. If you see a 200 response with HTML instead, cloaking is on — turn it off.

**This shortlink slug is baked into every shipped copy of the app and cannot be changed.** You can repoint the destination URL later (the destination already moved from Supabase to R2 once), but the slug is forever.

## 4. Put the public key and feed URL in Info.plist

Edit `macos-app/AgentServer/Info.plist`.

Replace the `SUPublicEDKey` placeholder with the base64 string from step 1:

```xml
<key>SUPublicEDKey</key>
<string>PASTE_BASE64_PUBLIC_KEY_HERE</string>
```

`SUFeedURL` is already set to the Dub shortlink:

```xml
<key>SUFeedURL</key>
<string>https://coolasspuppy.com/agent-server-updates</string>
```

Do not change this to the raw Supabase URL. The shortlink is the whole point — it lets you migrate hosts later by repointing the Dub link.

## 5. Build once and verify

```bash
cd macos-app
xcodegen generate
xcodebuild -project AgentServer.xcodeproj -scheme AgentServer build
```

Launch the built app, right-click the menu bar icon > "Check for Updates…". You should see "You're up to date!" (because the placeholder appcast has no `<item>` entries). If you see an error about a bad signature or unreachable feed, the Dub link or the public key is wrong — fix before shipping anything.

## 6. Release flow (every release)

Do these in order. Skipping a step produces an appcast that Sparkle will reject and users won't get the update.

### 6a. Bump the version

In `macos-app/AgentServer/Info.plist`:
- `CFBundleShortVersionString` — the user-visible version (e.g. `1.1.0`).
- `CFBundleVersion` — a monotonically increasing integer (e.g. `42`). Sparkle compares this for update detection. **Must increase on every release, no exceptions.**

### 6b. Archive and export in Xcode

1. In Xcode, Product > Archive.
2. Distribute App > Developer ID > Export.
3. Choose "Upload to notary service" so Apple notarizes the `.app`.
4. When export finishes, Xcode writes a folder containing `Agent Server.app` — it's already signed, notarized, and stapled.

### 6c. Build, notarize, and Sparkle-sign the DMG

One-time setup (skip if already done): register a `notarytool` keychain profile so the script can notarize the DMG without prompting:

```bash
xcrun notarytool store-credentials "agent-server" \
  --apple-id "you@example.com" \
  --team-id "YOURTEAMID" \
  --password "app-specific-password"
```

Then run the release script. It creates the DMG, notarizes and staples it, and signs it with Sparkle in one shot:

```bash
cd ~/Developer/saas-apps/agents/agent-server
./scripts/build-dmg.sh "/path/to/exported/Agent Server.app" 1.1.0 agent-server
```

Outputs:
- `dist/AgentServer-1.1.0.dmg` — signed, notarized, stapled, ready to ship.
- `dist/AgentServer-1.1.0.sparkle.txt` — the `sparkle:edSignature` + `length` values you paste into `appcast.xml`.

Print the sparkle info to paste later:

```bash
cat dist/AgentServer-1.1.0.sparkle.txt
```

Do not modify the DMG after this step. Any change invalidates both the notarization ticket and the Sparkle signature.

### 6d. Upload the DMG to Supabase

Upload `dist/AgentServer-1.1.0.dmg` to the `downloads` bucket via the Supabase dashboard. The public URL is:

```
https://hlwjnusdotqtmtwrjidu.supabase.co/storage/v1/object/public/downloads/AgentServer-1.1.0.dmg
```

Verify it's reachable and matches the size Sparkle signed:

```bash
curl -sI "https://hlwjnusdotqtmtwrjidu.supabase.co/storage/v1/object/public/downloads/AgentServer-1.1.0.dmg" | head -5
```

You want `HTTP/2 200` and `content-length:` matching the `length` printed in `AgentServer-1.1.0.sparkle.txt`.

### 6e. Update appcast.xml

Download the current `appcast.xml` from Supabase, add a new `<item>` at the top of the `<channel>` (newest first), and re-upload. An item looks like this:

```xml
<item>
  <title>Version 1.1.0</title>
  <pubDate>Mon, 13 Apr 2026 10:00:00 +0000</pubDate>
  <sparkle:version>42</sparkle:version>
  <sparkle:shortVersionString>1.1.0</sparkle:shortVersionString>
  <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
  <description><![CDATA[
    <ul>
      <li>What changed in this release.</li>
    </ul>
  ]]></description>
  <enclosure
    url="https://hlwjnusdotqtmtwrjidu.supabase.co/storage/v1/object/public/downloads/AgentServer-1.1.0.dmg"
    sparkle:edSignature="MC4CAQAwBQYDK2Vw..."
    length="12345678"
    type="application/x-apple-diskimage" />
</item>
```

Rules:
- `pubDate` must be RFC 822 (the format shown). Wrong format = Sparkle ignores the item.
- `sparkle:version` is the build number (`CFBundleVersion`). `sparkle:shortVersionString` is the user-facing version.
- `enclosure url` is the **raw Supabase URL**, not the Dub shortlink. Shortlinking downloads breaks nothing today but buys nothing either, and adds a third-party dependency on every install.
- `sparkle:edSignature` and `length` are exactly what `sign_update` printed.
- `type` is `application/x-apple-diskimage` for DMGs.

Re-upload `appcast.xml` to Supabase, overwriting the existing file.

### 6f. Verify end-to-end

On a machine running a previous version of the app:

1. Click the menu bar icon > right-click > "Check for Updates…".
2. You should see the update prompt with your release notes.
3. Let it download and install.

If the check says "You're up to date", something is wrong. Common causes:
- `CFBundleVersion` didn't actually increase.
- `pubDate` is malformed, so Sparkle discarded the item.
- Supabase is serving a stale `appcast.xml` (rare, but re-upload with a slightly different filename then rename).
- Dub shortlink returned a non-redirect response.

If the download fails signature verification, `sparkle:edSignature` or `length` are wrong, or the zip was modified (recompressed, re-signed) after `sign_update` ran. Regenerate both and try again.

## Notes

- **Do not amend released `<item>` entries.** If you ship a bad build, bump the version again and ship a new one. Rewriting an existing item may not invalidate caches on user machines.
- **Never rotate the Dub shortlink slug.** The slug is baked into every shipped app's `Info.plist`. You can repoint the destination URL as often as you want. You cannot change the slug.
- **Never rotate the Ed25519 key** unless you're willing to manually reach every user. No key rotation mechanism exists in Sparkle.
- Sparkle's XPC services are embedded in the SPM product; the project is unsandboxed so no extra entitlements are needed.
- The DMG must itself be signed + notarized + stapled, not just the `.app` inside. Sparkle verifies notarization before mounting.
- Dub's free tier is fine for this. If Dub goes down, update checks fail silently (users stay on their current version) until it recovers.
