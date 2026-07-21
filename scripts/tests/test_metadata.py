import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from scripts.release_tools.cli import main
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
from scripts.release_tools.publisher import PublicationError, atomic_write_many


PROJECT = '''
settings:
  base:
    MARKETING_VERSION: "3.2.0"
    CURRENT_PROJECT_VERSION: "32"
    POSTHOG_API_KEY: "$(POSTHOG_API_KEY)"
'''.lstrip()

LIVE_APPCAST = '''<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Agent Server</title>
    <language>en</language>
    <item>
      <title>Version 3.2.0</title>
      <pubDate>Mon, 20 Jul 2026 21:05:22 +0000</pubDate>
      <sparkle:version>32</sparkle:version>
      <sparkle:shortVersionString>3.2.0</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <description><![CDATA[<ul><li>Existing</li></ul>]]></description>
      <enclosure url="https://downloads.example/AgentServer-3.2.0.dmg"
        sparkle:edSignature="YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYQ=="
        length="123" type="application/x-apple-diskimage" />
    </item>
  </channel>
</rss>
'''


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
    def test_atomic_metadata_staging_cleans_up_when_fsync_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "project.yml"
            path.write_bytes(b"original")

            with patch("scripts.release_tools.publisher.os.fsync", side_effect=OSError("disk")):
                with self.assertRaisesRegex(OSError, "disk"):
                    atomic_write_many(((path, b"updated"),))

            self.assertEqual(path.read_bytes(), b"original")
            self.assertEqual(list(path.parent.glob(".project.yml.*")), [])

    def test_atomic_metadata_rollback_cleans_up_when_restore_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project.yml"
            package = root / "package.json"
            project.write_bytes(b"original project")
            package.write_bytes(b"original package")
            real_replace = os.replace

            def fail_commit_and_restore(source: object, destination: object) -> None:
                source_path = Path(source)
                destination_path = Path(destination)
                if destination_path == package or source_path.read_bytes() == b"original project":
                    raise OSError("simulated replace failure")
                real_replace(source, destination)

            with patch(
                "scripts.release_tools.publisher.os.replace",
                side_effect=fail_commit_and_restore,
            ):
                with self.assertRaisesRegex(PublicationError, "rollback was incomplete"):
                    atomic_write_many(
                        ((project, b"updated project"), (package, b"updated package"))
                    )

            leftovers = [
                *root.glob(".project.yml.*"),
                *root.glob(".package.json.*"),
            ]
            self.assertEqual(leftovers, [])

    def test_prepare_rolls_back_both_metadata_files_when_second_replace_fails(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            project = root / "project.yml"
            package = root / "package.json"
            live = root / "appcast.xml"
            project.write_text(PROJECT)
            original_package = '{"name":"agent-server","version":"3.2.0"}\n'
            package.write_text(original_package)
            live.write_text(LIVE_APPCAST)
            real_replace = os.replace

            def fail_package_replace(source: object, destination: object) -> None:
                if Path(destination) == package:
                    raise OSError("simulated package replace failure")
                real_replace(source, destination)

            with patch("scripts.release_tools.publisher.os.replace", side_effect=fail_package_replace):
                with self.assertRaisesRegex(OSError, "simulated package replace failure"):
                    main([
                        "prepare", "--version", "3.3.0", "--project", str(project),
                        "--package", str(package), "--live", str(live),
                    ])

            self.assertEqual(project.read_text(), PROJECT)
            self.assertEqual(package.read_text(), original_package)

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

    def test_metadata_writers_require_parsed_version_values(self) -> None:
        with self.assertRaises(VersionError):
            update_project_metadata(PROJECT, "3.3.0", 33)
        with self.assertRaises(VersionError):
            update_server_package_version('{"version":"3.2.0"}', "3.3.0")

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
