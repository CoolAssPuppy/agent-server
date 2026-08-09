# Sparkle release guide

This is the canonical release guide for Agent Server. The macOS app uses Sparkle 2, signed and notarized DMG files, and a public appcast hosted in Cloudflare R2.

## Published paths

The release script publishes these objects to the `strategic-nerds-downloads` R2 bucket by default:

- `apps/agent-server/AgentServer-<version>.dmg`
- `apps/agent-server/AgentServer-latest.dmg`
- `apps/agent-server/appcast.xml`

The default public origin is `https://downloads.strategicnerds.com`. Installed apps read the appcast through `https://coolasspuppy.com/agent-server-updates`, which must redirect to the public appcast URL.

## One-time setup

1. Generate the Sparkle Ed25519 key with Sparkle's `generate_keys` tool using the account `com.strategicnerds.agent-server`. Back up the private key as `SPARKLE_PRIVATE_KEY` in Doppler, and keep it out of the repository.
2. Set the printed public key as `SUPublicEDKey` in `macos-app/AgentServer/Info.plist`.
3. Point `SUFeedURL` at `https://coolasspuppy.com/agent-server-updates` and configure that URL to redirect to `https://downloads.strategicnerds.com/apps/agent-server/appcast.xml`.
4. Put Sparkle's `sign_update` tool at `~/bin/sparkle/sign_update`, or set `SPARKLE_SIGN_UPDATE` to its executable path. The release reads `SPARKLE_PRIVATE_KEY` from Doppler through standard input so remote releases do not require a Keychain prompt.
5. Install Xcode 15+ and the local release tools: `xcodegen`, `create-dmg`, Doppler, Python 3, and Wrangler. The script can also run Wrangler through pnpm.
6. Give the Doppler `agent-server/prd` config these secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `R2_BUCKET_NAME`, if the default bucket is not used
   - `R2_PUBLIC_BASE_URL`, if the default public origin is not used
   - `POSTHOG_PUBLIC_KEY`

The Cloudflare token must be able to write objects to the selected R2 bucket.

Notarization credentials live in a dedicated keychain rather than the login keychain, so a release can run without anybody present to click Allow. The login keychain refuses writes from a process with no window server access, which means `store-credentials` fails there under automation and takes the whole release with it.

Set it up once:

```bash
KC="$HOME/Library/Keychains/agent-server-notary.keychain-db"
KCPASS=$(openssl rand -base64 24)

security create-keychain -p "$KCPASS" "$KC"
security unlock-keychain -p "$KCPASS" "$KC"

# So an unattended release can unlock it later.
printf '%s' "$KCPASS" | doppler secrets set NOTARY_KEYCHAIN_PASSWORD \
  --project agent-server --config prd

xcrun notarytool store-credentials agent-server \
  --apple-id "you@example.com" \
  --team-id "955GSY56UT" \
  --password "$(doppler secrets get SPARKLE_APP_SPECIFIC_PASSWORD \
    --project agent-server --config prd --plain)" \
  --keychain "$KC"
```

`release.sh` finds that keychain by default, unlocks it from Doppler, and passes it to every `notarytool` call. Point `NOTARY_KEYCHAIN` somewhere else to use a different one, or set it empty to fall back to the default keychain search and the interactive setup.

Check it without running a release:

```bash
xcrun notarytool history --keychain-profile agent-server \
  --keychain "$HOME/Library/Keychains/agent-server-notary.keychain-db"
```

## Cut a release

Start from a clean checkout with the release changes reviewed. Use this command form:

```bash
./scripts/release.sh <version> "<release notes HTML>"
```

For example, `version` can be `3.3.0` and the release notes can be an HTML list such as `<li>Describe the user-visible change.</li>`. The script updates version files and `dist/appcast.xml`, so commit those changes after verification.

The script performs this work and stops on the first failure:

1. Captures and validates the live appcast before changing local release metadata.
2. Runs the server tests, type check, lint, and macOS behavior tests.
3. Updates `MARKETING_VERSION`, increments `CURRENT_PROJECT_VERSION`, and updates `server-app/package.json`.
4. Builds the bundled server, regenerates the Xcode project, archives the app, and exports it with Developer ID signing.
5. Notarizes and staples the app, then builds, signs, notarizes, staples, and Sparkle-signs `dist/AgentServer-<version>.dmg`.
6. Stages and validates an appcast derived from the live appcast.
7. Confirms the live appcast has not changed, then publishes the immutable DMG, the appcast, and finally `AgentServer-latest.dmg`.
8. Verifies the public R2 objects and the appcast shortlink before updating tracked `dist/appcast.xml`.

Do not edit a published appcast item in place. If a release is faulty, increase the version and build number and ship a correction.

## Verify

The release script checks the public files before it exits. Also verify the user path from a Mac running an older version:

1. Open Check for Updates in Agent Server.
2. Confirm the expected version and release note appear.
3. Install the update and confirm the app relaunches.
4. Confirm the About or Settings version matches the released version.

Useful public checks:

```bash
curl -fsSL https://downloads.strategicnerds.com/apps/agent-server/appcast.xml
curl -fsSI https://downloads.strategicnerds.com/apps/agent-server/AgentServer-latest.dmg
curl -fsSIL https://coolasspuppy.com/agent-server-updates
```

## Troubleshooting

- If notarization authentication fails, recreate the `agent-server` keychain profile.
- If Sparkle signature generation fails, confirm `SPARKLE_SIGN_UPDATE` points to an executable `sign_update` tool with access to the release key.
- If R2 upload fails, confirm the Cloudflare token, account ID, bucket name, and public origin in Doppler.
- If the appcast works but the DMG fails to install, compare its byte length and Ed25519 signature with the enclosure in `dist/appcast.xml`.
- If installed apps do not see the update, confirm the shortlink redirects to `apps/agent-server/appcast.xml` and that the new build number is greater than the installed build.
