"""Sparkle appcast parsing, construction, and exact verification."""

from __future__ import annotations

import base64
import binascii
from email.utils import parsedate_to_datetime
import re
from urllib.parse import urlsplit
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape, quoteattr

from .models import (
    AppcastError,
    AppcastRelease,
    BuildNumberError,
    DuplicateVersionError,
    SparkleSignature,
    SparkleSignatureError,
    StaleVersionError,
    Version,
)


_SIGNATURE_FIELD = re.compile(r'(?P<name>sparkle:edSignature|length)="(?P<value>[^"]*)"')
_LANGUAGE_MARKER = re.compile(r"<language>\s*en\s*</language>")
_NOTES_WRAPPER = re.compile(r"\s*<ul>\s*(?P<notes>.*?)\s*</ul>\s*", re.DOTALL)
_DISK_IMAGE_CONTENT_TYPE = "application/x-apple-diskimage"


def parse_sparkle_signature(output: str) -> SparkleSignature:
    """Parse the one signature and length emitted by Sparkle sign_update."""
    values: dict[str, str] = {}
    for match in _SIGNATURE_FIELD.finditer(output):
        name = match.group("name")
        if name in values:
            raise SparkleSignatureError(f"Duplicate Sparkle field: {name}")
        values[name] = match.group("value")
    if set(values) != {"sparkle:edSignature", "length"}:
        raise SparkleSignatureError("Sparkle output must contain one signature and one length.")
    signature = values["sparkle:edSignature"]
    _validate_signature(signature)
    length_text = values["length"]
    if re.fullmatch(r"[1-9][0-9]*", length_text) is None:
        raise SparkleSignatureError("Sparkle length must be a positive integer.")
    return SparkleSignature(signature=signature, length=int(length_text))


def parse_appcast(xml_text: str) -> list[AppcastRelease]:
    """Parse and validate the live feed while retaining its declared item order."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError as error:
        raise AppcastError(f"Invalid appcast XML: {error}") from error
    if _local_name(root.tag) != "rss":
        raise AppcastError("Appcast root must be rss.")
    channels = [child for child in root if _local_name(child.tag) == "channel"]
    if len(channels) != 1:
        raise AppcastError(f"Expected one appcast channel, found {len(channels)}.")

    releases = [
        _parse_item(element)
        for element in channels[0]
        if _local_name(element.tag) == "item"
    ]
    _validate_feed_order(releases)
    return releases


def prepend_release(live_xml: str, release: AppcastRelease) -> str:
    """Insert a validated release without reserializing historical feed items."""
    _validate_release_fields(release)
    existing = parse_appcast(live_xml)
    versions = [entry.version for entry in existing]
    builds = [entry.build for entry in existing]
    if release.version in versions:
        raise DuplicateVersionError(f"Version {release.version} already exists in the appcast.")
    if versions and release.version <= max(versions):
        raise StaleVersionError(f"Version {release.version} does not advance the live appcast.")
    if builds and release.build <= max(builds):
        raise BuildNumberError(f"Build {release.build} does not advance the live appcast.")

    markers = list(_LANGUAGE_MARKER.finditer(live_xml))
    if len(markers) != 1:
        raise AppcastError(f"Expected one English language insertion point, found {len(markers)}.")
    marker = markers[0]
    newline = "\r\n" if "\r\n" in live_xml else "\n"
    rendered = _render_item(release, newline)
    return live_xml[: marker.end()] + newline + rendered + live_xml[marker.end() :]


def verify_release(appcast_xml: str, expected: AppcastRelease) -> None:
    """Require the first live item to match every expected release field exactly."""
    releases = parse_appcast(appcast_xml)
    if not releases:
        raise AppcastError("Appcast contains no release items.")
    if releases[0] != expected:
        raise AppcastError(f"Newest appcast item mismatch: expected {expected}, found {releases[0]}.")


def _parse_item(element: ET.Element) -> AppcastRelease:
    title = _single_child_text(element, "title")
    raw_version = _single_child_text(element, "shortVersionString")
    version = Version.parse_legacy(raw_version)
    if title != f"Version {raw_version}":
        raise AppcastError(f"Title does not match version {raw_version}.")

    build_text = _single_child_text(element, "version")
    if re.fullmatch(r"[1-9][0-9]*", build_text) is None:
        raise BuildNumberError(f"Invalid appcast build: {build_text!r}")
    pub_date = _single_child_text(element, "pubDate")
    minimum_system_version = _single_child_text(element, "minimumSystemVersion")
    description = _single_child_text(element, "description", strip=False)
    notes_match = _NOTES_WRAPPER.fullmatch(description)
    if notes_match is None:
        raise AppcastError("Release description must contain one ul notes wrapper.")
    notes_html = notes_match.group("notes").strip()

    enclosure = _single_child(element, "enclosure")
    attributes = {_local_name(name): value for name, value in enclosure.attrib.items()}
    required_attributes = {"url", "edSignature", "length", "type"}
    if set(attributes) != required_attributes:
        raise AppcastError(
            f"Enclosure attributes must be exactly {sorted(required_attributes)}, "
            f"found {sorted(attributes)}."
        )
    url = attributes["url"]
    signature = attributes["edSignature"]
    length_text = attributes["length"]
    if re.fullmatch(r"[1-9][0-9]*", length_text) is None:
        raise AppcastError(f"Invalid enclosure length: {length_text!r}")

    release = AppcastRelease(
        version=version,
        build=int(build_text),
        pub_date=pub_date,
        minimum_system_version=minimum_system_version,
        notes_html=notes_html,
        enclosure_url=url,
        signature=signature,
        length=int(length_text),
        content_type=attributes["type"],
    )
    _validate_release_fields(release)
    return release


def _validate_feed_order(releases: list[AppcastRelease]) -> None:
    versions = [release.version for release in releases]
    if len(set(versions)) != len(versions):
        raise DuplicateVersionError("Appcast contains duplicate versions.")
    builds = [release.build for release in releases]
    if len(set(builds)) != len(builds):
        raise BuildNumberError("Appcast contains duplicate build numbers.")
    for newer, older in zip(releases, releases[1:]):
        if newer.version <= older.version:
            raise StaleVersionError("Appcast versions must be ordered newest first.")
        if newer.build <= older.build:
            raise BuildNumberError("Appcast build numbers must decrease with item order.")


def _render_item(release: AppcastRelease, newline: str) -> str:
    notes = release.notes_html.replace("]]>", "]]]]><![CDATA[>")
    lines = [
        "    <item>",
        f"      <title>{escape(release.title)}</title>",
        f"      <pubDate>{escape(release.pub_date)}</pubDate>",
        f"      <sparkle:version>{release.build}</sparkle:version>",
        f"      <sparkle:shortVersionString>{release.version}</sparkle:shortVersionString>",
        f"      <sparkle:minimumSystemVersion>{escape(release.minimum_system_version)}</sparkle:minimumSystemVersion>",
        "      <description><![CDATA[",
        "        <ul>",
        f"          {notes}",
        "        </ul>",
        "      ]]></description>",
        "      <enclosure",
        f"        url={quoteattr(release.enclosure_url)}",
        f"        sparkle:edSignature={quoteattr(release.signature)}",
        f"        length={quoteattr(str(release.length))}",
        f"        type={quoteattr(release.content_type)} />",
        "    </item>",
    ]
    return newline.join(lines) + newline


def _single_child(element: ET.Element, name: str) -> ET.Element:
    matches = [child for child in element if _local_name(child.tag) == name]
    if len(matches) != 1:
        raise AppcastError(f"Expected one {name} in appcast item, found {len(matches)}.")
    return matches[0]


def _single_child_text(element: ET.Element, name: str, *, strip: bool = True) -> str:
    child = _single_child(element, name)
    if list(child):
        raise AppcastError(f"Appcast {name} must contain text only.")
    value = child.text or ""
    return value.strip() if strip else value


def _validate_signature(signature: str) -> None:
    try:
        decoded = base64.b64decode(signature, validate=True)
    except (ValueError, binascii.Error) as error:
        raise SparkleSignatureError("Sparkle signature is not valid base64.") from error
    if not decoded:
        raise SparkleSignatureError("Sparkle signature is empty.")


def _validate_release_fields(release: AppcastRelease) -> None:
    try:
        publication_date = parsedate_to_datetime(release.pub_date)
    except (TypeError, ValueError) as error:
        raise AppcastError(f"Invalid publication date: {release.pub_date!r}") from error
    if publication_date.utcoffset() is None:
        raise AppcastError("Publication date must include a timezone.")

    parsed_url = urlsplit(release.enclosure_url)
    if parsed_url.scheme != "https" or not parsed_url.netloc:
        raise AppcastError(f"Enclosure URL must be HTTPS: {release.enclosure_url!r}")
    _validate_signature(release.signature)
    if release.content_type != _DISK_IMAGE_CONTENT_TYPE:
        raise AppcastError(
            f"Enclosure type must be {_DISK_IMAGE_CONTENT_TYPE!r}, "
            f"found {release.content_type!r}."
        )


def _local_name(name: str) -> str:
    return name.rsplit("}", 1)[-1].split(":", 1)[-1]
