import json
import unittest

from scripts.release_tools.metadata import (
    compute_next_build,
    read_project_metadata,
    read_server_package_version,
    update_project_metadata,
    update_server_package_version,
    validate_release_candidate,
    verify_release_metadata,
)
from scripts.release_tools.models import (
    BuildNumberError,
    DuplicateVersionError,
    MetadataError,
    StaleVersionError,
    Version,
    VersionError,
)


PROJECT = '''
settings:
  base:
    MARKETING_VERSION: "3.2.0"
    CURRENT_PROJECT_VERSION: "32"
    POSTHOG_API_KEY: "$(POSTHOG_API_KEY)"
'''.lstrip()


class VersionTests(unittest.TestCase):
    def test_new_versions_require_three_numeric_components(self) -> None:
        self.assertEqual(str(Version.parse("4.1.2")), "4.1.2")
        for value in ("4.1", "4", "v4.1.2", "4.1.2-beta", "04.1.2", "4.01.2", "4.1.02"):
            with self.subTest(value=value), self.assertRaises(VersionError):
                Version.parse(value)

    def test_legacy_reader_normalizes_two_component_versions(self) -> None:
        self.assertEqual(Version.parse_legacy("3.1"), Version(3, 1, 0))
        self.assertEqual(Version.parse_legacy("3.1.4"), Version(3, 1, 4))
        with self.assertRaises(VersionError):
            Version.parse_legacy("3")

    def test_version_components_must_be_plain_nonnegative_integers(self) -> None:
        for components in ((True, 1, 2), (1, "2", 3), (-1, 2, 3)):
            with self.subTest(components=components), self.assertRaises(VersionError):
                Version(*components)


class MetadataTests(unittest.TestCase):
    def test_reads_and_updates_project_and_package_metadata(self) -> None:
        version, build = read_project_metadata(PROJECT)
        self.assertEqual(version, Version(3, 2, 0))
        self.assertEqual(build, 32)

        updated_project = update_project_metadata(PROJECT, Version(3, 3, 0), 34)
        self.assertIn('MARKETING_VERSION: "3.3.0"', updated_project)
        self.assertIn('CURRENT_PROJECT_VERSION: "34"', updated_project)
        self.assertIn('POSTHOG_API_KEY: "$(POSTHOG_API_KEY)"', updated_project)

        package_text = json.dumps({"name": "agent-server", "version": "3.2.0", "private": True})
        self.assertEqual(read_server_package_version(package_text), Version(3, 2, 0))
        updated_package = update_server_package_version(package_text, Version(3, 3, 0))
        self.assertEqual(json.loads(updated_package)["version"], "3.3.0")
        self.assertTrue(updated_package.endswith("\n"))

    def test_rejects_missing_duplicate_and_malformed_project_fields(self) -> None:
        with self.assertRaises(MetadataError):
            read_project_metadata('CURRENT_PROJECT_VERSION: "32"\n')
        with self.assertRaises(MetadataError):
            read_project_metadata(PROJECT + 'MARKETING_VERSION: "3.2.0"\n')
        with self.assertRaises(VersionError):
            read_project_metadata(PROJECT.replace("3.2.0", "3.2"))
        with self.assertRaises(BuildNumberError):
            read_project_metadata(PROJECT.replace('"32"', '"0"'))

    def test_rejects_malformed_package_metadata(self) -> None:
        for text in ('{"name":"agent-server"}', '{"version": 3}', '{not json}'):
            with self.subTest(text=text), self.assertRaises(MetadataError):
                read_server_package_version(text)

    def test_computes_build_above_both_local_and_live_maxima(self) -> None:
        self.assertEqual(compute_next_build(local_build=32, live_builds=[29, 35, 31]), 36)
        self.assertEqual(compute_next_build(local_build=40, live_builds=[]), 41)
        with self.assertRaises(BuildNumberError):
            compute_next_build(local_build=0, live_builds=[1])

    def test_rejects_duplicate_stale_versions_and_nonmonotonic_builds(self) -> None:
        live_versions = [Version.parse_legacy("3.2.0"), Version.parse_legacy("3.1")]
        with self.assertRaises(DuplicateVersionError):
            validate_release_candidate(Version(3, 2, 0), 33, Version(3, 2, 0), 32, live_versions, [32, 31])
        with self.assertRaises(StaleVersionError):
            validate_release_candidate(Version(3, 1, 9), 33, Version(3, 2, 0), 32, live_versions, [32, 31])
        with self.assertRaises(BuildNumberError):
            validate_release_candidate(Version(3, 3, 0), 32, Version(3, 2, 0), 32, live_versions, [32, 31])

    def test_exact_verification_checks_every_local_release_field(self) -> None:
        package = '{"name":"agent-server","version":"3.3.0"}\n'
        project = update_project_metadata(PROJECT, Version(3, 3, 0), 33)
        verify_release_metadata(project, package, Version(3, 3, 0), 33)
        with self.assertRaises(MetadataError):
            verify_release_metadata(project, package, Version(3, 3, 0), 34)
        with self.assertRaises(MetadataError):
            verify_release_metadata(project, package.replace("3.3.0", "3.3.1"), Version(3, 3, 0), 33)


if __name__ == "__main__":
    unittest.main()
