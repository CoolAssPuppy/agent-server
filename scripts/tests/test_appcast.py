import unittest

from scripts.release_tools.appcast import (
    parse_appcast,
    parse_sparkle_signature,
    prepend_release,
    verify_release,
)
from scripts.release_tools.models import (
    AppcastError,
    AppcastRelease,
    BuildNumberError,
    DuplicateVersionError,
    SparkleSignatureError,
    StaleVersionError,
    Version,
    VersionError,
)


def item(version: str, build: int, signature: str = "YWFh") -> str:
    return f'''    <item>
      <title>Version {version}</title>
      <pubDate>Mon, 20 Jul 2026 21:05:22 +0000</pubDate>
      <sparkle:version>{build}</sparkle:version>
      <sparkle:shortVersionString>{version}</sparkle:shortVersionString>
      <sparkle:minimumSystemVersion>14.0</sparkle:minimumSystemVersion>
      <description><![CDATA[
        <ul>
          <li>Notes for {version}</li>
        </ul>
      ]]></description>
      <enclosure url="https://downloads.example/AgentServer-{version}.dmg"
        sparkle:edSignature="{signature}" length="123" type="application/x-apple-diskimage" />
    </item>'''


def feed(*items: str) -> str:
    body = "\n\n".join(items)
    return f'''<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Agent Server</title>
    <language>en</language>
{body}
  </channel>
</rss>
'''


class SparkleSignatureTests(unittest.TestCase):
    def test_parses_signature_and_positive_length(self) -> None:
        parsed = parse_sparkle_signature('sparkle:edSignature="YWFh" length="191714452"')
        self.assertEqual(parsed.signature, "YWFh")
        self.assertEqual(parsed.length, 191714452)

    def test_rejects_missing_duplicate_or_malformed_signature_fields(self) -> None:
        samples = (
            'length="123"',
            'sparkle:edSignature="%%%" length="123"',
            'sparkle:edSignature="YWFh" length="0"',
            'sparkle:edSignature="YWFh" sparkle:edSignature="YWFh" length="123"',
        )
        for sample in samples:
            with self.subTest(sample=sample), self.assertRaises(SparkleSignatureError):
                parse_sparkle_signature(sample)


class AppcastTests(unittest.TestCase):
    def test_release_numeric_fields_must_be_plain_positive_integers(self) -> None:
        expected = release(Version(3, 3, 0), 33)
        cases = (
            ({"build": True}, BuildNumberError),
            ({"build": "33"}, BuildNumberError),
            ({"length": "456"}, AppcastError),
        )
        for changes, error_type in cases:
            with self.subTest(changes=changes), self.assertRaises(error_type):
                AppcastRelease(**{**expected.__dict__, **changes})

    def test_reads_legacy_versions_and_preserves_feed_order(self) -> None:
        entries = parse_appcast(feed(item("3.2.0", 32), item("3.1", 31)))
        self.assertEqual([entry.version for entry in entries], [Version(3, 2, 0), Version(3, 1, 0)])
        self.assertEqual([entry.build for entry in entries], [32, 31])

    def test_rejects_malformed_duplicate_and_nonmonotonic_feed_entries(self) -> None:
        with self.assertRaises(VersionError):
            parse_appcast(feed(item("v3.2.0", 32)))
        with self.assertRaises(DuplicateVersionError):
            parse_appcast(feed(item("3.2.0", 32), item("3.2.0", 31)))
        with self.assertRaises(BuildNumberError):
            parse_appcast(feed(item("3.2.0", 31), item("3.1.0", 32)))
        with self.assertRaises(StaleVersionError):
            parse_appcast(feed(item("3.1.0", 32), item("3.2.0", 31)))
        with self.assertRaises(BuildNumberError):
            parse_appcast(feed(item("3.2.0", 32), item("3.1.0", 32)))
        with self.assertRaises(AppcastError):
            parse_appcast("<rss><channel></rss>")

    def test_rejects_foreign_namespaces_that_impersonate_sparkle_fields(self) -> None:
        live = feed(item("3.2.0", 32)).replace(
            'xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle"',
            'xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" '
            'xmlns:foreign="https://example.invalid/not-sparkle"',
        )
        spoofed_tag = live.replace("<sparkle:version>", "<foreign:version>").replace(
            "</sparkle:version>", "</foreign:version>"
        )
        spoofed_attribute = live.replace(" url=", " foreign:url=")

        for xml_text in (spoofed_tag, spoofed_attribute):
            with self.subTest(xml_text=xml_text), self.assertRaises(AppcastError):
                parse_appcast(xml_text)

    def test_rejects_document_type_declarations(self) -> None:
        live = feed(item("3.2.0", 32))
        with_doctype = live.replace(
            '<rss version="2.0"',
            '<!DOCTYPE rss [<!ENTITY release "3.2.0">]>\n<rss version="2.0"',
        )

        with self.assertRaises(AppcastError):
            parse_appcast(with_doctype)

    def test_allows_document_type_text_inside_release_notes(self) -> None:
        live = feed(item("3.2.0", 32)).replace(
            "Notes for 3.2.0", "Notes mention <!DOCTYPE rss> as text"
        )

        releases = parse_appcast(live)

        self.assertIn("<!DOCTYPE rss>", releases[0].notes_html)

    def test_requires_one_real_english_channel_language(self) -> None:
        live = feed(item("3.2.0", 32))
        missing_language = live.replace("    <language>en</language>\n", "")
        comment_only = missing_language.replace(
            "    <title>Agent Server</title>",
            "    <title>Agent Server</title>\n    <!-- <language>en</language> -->",
        )

        for xml_text in (missing_language, comment_only):
            with self.subTest(xml_text=xml_text), self.assertRaises(AppcastError):
                parse_appcast(xml_text)

    def test_rejects_duplicate_or_stale_new_release(self) -> None:
        live = feed(item("3.2.0", 32), item("3.1", 31))
        duplicate = release(Version(3, 2, 0), 33)
        stale = release(Version(3, 1, 9), 33)
        low_build = release(Version(3, 3, 0), 32)
        with self.assertRaises(DuplicateVersionError):
            prepend_release(live, duplicate)
        with self.assertRaises(StaleVersionError):
            prepend_release(live, stale)
        with self.assertRaises(BuildNumberError):
            prepend_release(live, low_build)

    def test_prepends_safe_notes_without_reserializing_old_items(self) -> None:
        old_first = item("3.2.0", 32)
        old_second = item("3.1", 31)
        live = feed(old_first, old_second)
        new_release = release(Version(3, 3, 0), 33, notes="<li>A ]]> marker & details</li>")

        updated = prepend_release(live, new_release)

        self.assertIn("]]]]><![CDATA[>", updated)
        self.assertLess(updated.index("Version 3.3.0"), updated.index("Version 3.2.0"))
        self.assertLess(updated.index("Version 3.2.0"), updated.index("Version 3.1"))
        self.assertIn(old_first, updated)
        self.assertIn(old_second, updated)
        parsed = parse_appcast(updated)
        self.assertEqual(parsed[0].notes_html, "<li>A ]]> marker & details</li>")

    def test_rejects_invalid_new_release_fields_before_rendering(self) -> None:
        live = feed(item("3.2.0", 32))
        expected = release(Version(3, 3, 0), 33)
        invalid_fields = (
            {"signature": "%%%"},
            {"enclosure_url": "http://downloads.example/release.dmg"},
            {"pub_date": "not a date"},
            {"content_type": "text/plain"},
        )
        for changes in invalid_fields:
            candidate = AppcastRelease(**{**expected.__dict__, **changes})
            with self.subTest(changes=changes), self.assertRaises(AppcastError):
                prepend_release(live, candidate)

    def test_exact_verification_checks_all_new_release_fields(self) -> None:
        live = feed(item("3.2.0", 32))
        expected = release(Version(3, 3, 0), 33)
        updated = prepend_release(live, expected)
        verify_release(updated, expected)

        wrong_length = AppcastRelease(**{**expected.__dict__, "length": expected.length + 1})
        with self.assertRaises(AppcastError):
            verify_release(updated, wrong_length)


def release(version: Version, build: int, notes: str = "<li>New release</li>") -> AppcastRelease:
    return AppcastRelease(
        version=version,
        build=build,
        pub_date="Tue, 21 Jul 2026 10:00:00 +0000",
        minimum_system_version="14.0",
        notes_html=notes,
        enclosure_url=f"https://downloads.example/AgentServer-{version}.dmg",
        signature="YWFh",
        length=456,
        content_type="application/x-apple-diskimage",
    )


if __name__ == "__main__":
    unittest.main()
