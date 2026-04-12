# Sparkle auto-update setup

The macOS app ships with [Sparkle 2](https://sparkle-project.org) wired in. Users get "Check for Updates..." in the status-bar right-click menu and in Settings > Updates, plus daily automatic checks.

This project hosts the appcast and zips in a **public Supabase Storage bucket**, and fronts the appcast URL with a **Dub.co shortlink** so the feed location can be moved later without re-shipping the app. Enclosure (zip) URLs are **not** shortlinked — they point directly at Supabase.

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

## 2. Create the Supabase Storage bucket

In the Supabase dashboard for the project hosting updates:

1. Storage > New bucket.
2. Name it `agent-server-updates` (or whatever; the name ends up in your URLs forever, so pick carefully).
3. Toggle **Public bucket = ON**. Appcast + zip must be reachable without auth.
4. File size limit: raise to something like `200 MB` (the default 50 MB is smaller than a notarized macOS app once it embeds `node_modules`).
5. Create the bucket.

The public URL pattern is:

```
https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/<filename>
```

Note the `<project-ref>` (e.g. `abcdefghijklmnop`) — you'll use it in step 4.

Upload a placeholder `appcast.xml` now so the URL resolves before you wire up Dub:

```xml
<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Agent Server</title>
    <link>https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/appcast.xml</link>
    <description>Agent Server updates</description>
    <language>en</language>
  </channel>
</rss>
```

Upload it via the dashboard (Storage > bucket > Upload file). Verify by opening `https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/appcast.xml` in a browser — you should see the XML.

## 3. Create the Dub.co shortlink

Log in to [dub.co](https://dub.co) and create a link:

- **Destination URL**: `https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/appcast.xml`
- **Short URL**: pick a stable slug on a domain you control or on `dub.sh`. Example: `updates.strategicnerds.com/agent-server` or `dub.sh/agent-server-updates`.
- Leave cloaking/frame OFF. Sparkle needs a plain HTTP redirect, not an iframe wrapper.
- Leave password OFF. Leave link expiration OFF.

Test the redirect:

```bash
curl -sI "https://<your-shortlink>" | grep -i '^location:'
```

You should see a `location:` header pointing at the Supabase public URL. If you see a 200 response with HTML instead, cloaking is on — turn it off.

**Write down the shortlink URL.** It is about to be baked into every copy of the app you ship and you can never change which URL the app checks without shipping a new build.

## 4. Put the public key and feed URL in Info.plist

Edit `macos-app/AgentServer/Info.plist`.

Replace the `SUPublicEDKey` placeholder with the base64 string from step 1:

```xml
<key>SUPublicEDKey</key>
<string>PASTE_BASE64_PUBLIC_KEY_HERE</string>
```

Replace the `SUFeedURL` placeholder with your **Dub shortlink** from step 3:

```xml
<key>SUFeedURL</key>
<string>https://your-shortlink-from-step-3</string>
```

Do not use the raw Supabase URL here. The shortlink is the whole point — it lets you migrate hosts later by repointing the Dub link.

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

### 6b. Build, archive, notarize, staple

Follow the existing macOS deployment process. The output you need is:

- `Agent Server.app`, fully signed, notarized, and stapled.
- Zipped as `Agent-Server-<shortVersion>.zip` with the `.app` at the archive root (no wrapper folder).

Create the zip with `ditto`, not Finder's Compress, so resource forks and signing survive:

```bash
ditto -c -k --sequesterRsrc --keepParent "Agent Server.app" "Agent-Server-1.1.0.zip"
```

### 6c. Sign the zip with Sparkle

`sign_update` is in the same directory as `generate_keys`:

```bash
cd ~/Library/Developer/Xcode/DerivedData/AgentServer-*/SourcePackages/artifacts/sparkle/Sparkle/bin
./sign_update /path/to/Agent-Server-1.1.0.zip
```

Output looks like:

```
sparkle:edSignature="MC4CAQAwBQYDK2Vw..." length="12345678"
```

Copy both values. `length` must match the zip's byte size exactly. Do not recompress after this step.

### 6d. Upload the zip to Supabase

Upload `Agent-Server-1.1.0.zip` to the `agent-server-updates` bucket. The public URL is:

```
https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/Agent-Server-1.1.0.zip
```

Verify it's reachable:

```bash
curl -sI "https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/Agent-Server-1.1.0.zip" | head -5
```

You want `HTTP/2 200` and `content-length:` matching the `length` from step 6c.

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
    url="https://<project-ref>.supabase.co/storage/v1/object/public/agent-server-updates/Agent-Server-1.1.0.zip"
    sparkle:edSignature="MC4CAQAwBQYDK2Vw..."
    length="12345678"
    type="application/octet-stream" />
</item>
```

Rules:
- `pubDate` must be RFC 822 (the format shown). Wrong format = Sparkle ignores the item.
- `sparkle:version` is the build number (`CFBundleVersion`). `sparkle:shortVersionString` is the user-facing version.
- `enclosure url` is the **raw Supabase URL**, not the Dub shortlink. Shortlinking downloads breaks nothing today but buys nothing either, and adds a third-party dependency on every install.
- `sparkle:edSignature` and `length` are exactly what `sign_update` printed.
- `type` stays `application/octet-stream`.

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
- The zip must itself be notarized + stapled, not just the `.app` inside. Sparkle verifies notarization before installing.
- Dub's free tier is fine for this. If Dub goes down, update checks fail silently (users stay on their current version) until it recovers.
