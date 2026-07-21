from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]


class ReleaseShellContractTests(unittest.TestCase):
    def test_notary_credentials_use_keychain_indirection_only(self) -> None:
        release = (ROOT / "scripts/release.sh").read_text()
        dmg = (ROOT / "scripts/build-dmg.sh").read_text()

        self.assertNotIn("AGENT_SERVER_NOTARY_PASSWORD", release)
        self.assertNotIn("AGENT_SERVER_NOTARY_PASSWORD", dmg)
        self.assertNotIn('notarytool "$@" --password', release)
        self.assertNotIn('notarytool "$@" --password', dmg)
        self.assertIn('--keychain-profile "$NOTARY_PROFILE"', release)
        self.assertIn('--keychain-profile "$NOTARY_PROFILE"', dmg)

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
