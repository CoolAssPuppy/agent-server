import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ReleaseShellContractTests(unittest.TestCase):
    def test_release_strips_platform_runtimes_but_keeps_sdk_adapters(self) -> None:
        project = (ROOT / "macos-app/project.yml").read_text()
        pruning = (ROOT / "scripts/prune-bundled-runtimes.sh").read_text()

        self.assertIn("scripts/prune-bundled-runtimes.sh", project)
        self.assertIn("@anthropic-ai/claude-agent-sdk-darwin-*", pruning)
        self.assertIn("@openai/codex-darwin-*", pruning)
        self.assertNotIn('@anthropic-ai/claude-agent-sdk"', pruning)
        self.assertNotIn('@openai/codex-sdk"', pruning)

    def test_notary_credentials_use_keychain_indirection_only(self) -> None:
        release = (ROOT / "scripts/release.sh").read_text()
        dmg = (ROOT / "scripts/build-dmg.sh").read_text()
        guide = (ROOT / "docs/SPARKLE.md").read_text()

        self.assertNotIn("AGENT_SERVER_NOTARY_PASSWORD", release)
        self.assertNotIn("AGENT_SERVER_NOTARY_PASSWORD", dmg)
        self.assertNotIn("--password", release)
        self.assertNotIn("--password", dmg)
        self.assertNotIn("--password", guide)
        self.assertIn('--keychain-profile "$NOTARY_PROFILE"', release)
        self.assertIn('--keychain-profile "$NOTARY_PROFILE"', dmg)
        self.assertIn("secure prompt", guide)
        self.assertIn('. "$SCRIPTS/release-helpers.sh"', release)
        self.assertIn('notarize_app_archive "$APP_PATH" "$APP_ZIP"', release)
        self.assertNotIn("ditto -c -k --sequesterRsrc --keepParent", release)

    def test_sparkle_signing_reads_the_private_key_from_doppler_over_stdin(self) -> None:
        dmg = (ROOT / "scripts/build-dmg.sh").read_text()

        self.assertIn("doppler secrets get SPARKLE_PRIVATE_KEY", dmg)
        self.assertIn('--project "$DOPPLER_PROJECT"', dmg)
        self.assertIn('--config "$DOPPLER_CONFIG"', dmg)
        self.assertIn('"$SIGN_UPDATE" --ed-key-file - "$DMG_OUT"', dmg)
        self.assertNotIn('"$SIGN_UPDATE" --account', dmg)

    def test_archive_explicitly_uses_the_developer_id_identity(self) -> None:
        release = (ROOT / "scripts/release.sh").read_text()

        self.assertIn(
            'SIGN_IDENTITY="${SIGN_IDENTITY:-Developer ID Application: Prashant Sridharan (955GSY56UT)}"',
            release,
        )
        self.assertIn('CODE_SIGN_STYLE=Manual', release)
        self.assertIn('CODE_SIGN_IDENTITY="$SIGN_IDENTITY"', release)

    def test_app_archive_is_cleaned_after_success_failure_and_interruption(self) -> None:
        helper = ROOT / "scripts/release-helpers.sh"
        shell = r'''
source "$1"
ditto() { touch "${@: -1}"; }
run_notarytool() {
  case "$TEST_MODE" in
    success) return 0 ;;
    failure) return 9 ;;
    interrupt) kill -TERM "$BASHPID" ;;
  esac
}
notarize_app_archive "/tmp/Agent Server.app" "$2"
'''
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "AgentServer.app.zip"
            for mode, expected_code in {"success": 0, "failure": 9, "interrupt": 130}.items():
                with self.subTest(mode=mode):
                    result = subprocess.run(
                        ["bash", "-c", shell, "bash", str(helper), str(archive)],
                        env={**os.environ, "TEST_MODE": mode},
                        capture_output=True,
                        check=False,
                    )
                    self.assertEqual(result.returncode, expected_code)
                    self.assertFalse(archive.exists())

    def test_release_uses_only_workspace_pinned_node_tools(self) -> None:
        release = (ROOT / "scripts/release.sh").read_text()
        package = (ROOT / "package.json").read_text()

        self.assertNotIn("pnpm dlx", release)
        self.assertNotIn("pnpm dlx", package)
        self.assertIn('"wrangler"', package)
        self.assertIn('"only-allow"', package)

    def test_documentation_changes_run_ci_contract_checks(self) -> None:
        workflow = (ROOT / ".github/workflows/ci.yml").read_text()

        self.assertIn("- 'README.md'", workflow)
        self.assertIn("- 'docs/**'", workflow)


if __name__ == "__main__":
    unittest.main()
