"""Shared value objects and typed failures for release tooling."""

from __future__ import annotations

from dataclasses import dataclass
import re


class ReleaseToolError(ValueError):
    """Base class for release input and verification failures."""


class VersionError(ReleaseToolError):
    """A version is missing or does not use an accepted format."""


class DuplicateVersionError(ReleaseToolError):
    """A release version already exists in the feed."""


class StaleVersionError(ReleaseToolError):
    """A release version does not advance the newest known version."""


class BuildNumberError(ReleaseToolError):
    """A build number is invalid or does not advance known builds."""


class MetadataError(ReleaseToolError):
    """Local release metadata is missing, ambiguous, or inconsistent."""


class AppcastError(ReleaseToolError):
    """An appcast is malformed or does not match the expected release."""


class SparkleSignatureError(AppcastError):
    """Sparkle signing output is missing or malformed."""


_COMPONENT = r"(?:0|[1-9][0-9]*)"
_STRICT_VERSION = re.compile(rf"^({_COMPONENT})\.({_COMPONENT})\.({_COMPONENT})$")
_LEGACY_VERSION = re.compile(rf"^({_COMPONENT})\.({_COMPONENT})(?:\.({_COMPONENT}))?$")


@dataclass(frozen=True, order=True)
class Version:
    """A normalized semantic release version without prerelease metadata."""

    major: int
    minor: int
    patch: int

    def __post_init__(self) -> None:
        if any(
            isinstance(value, bool) or not isinstance(value, int) or value < 0
            for value in (self.major, self.minor, self.patch)
        ):
            raise VersionError("Version components must be non-negative integers.")

    @classmethod
    def parse(cls, value: str) -> Version:
        """Parse the required MAJOR.MINOR.PATCH format for a new release."""
        return cls._from_match(value, _STRICT_VERSION)

    @classmethod
    def parse_legacy(cls, value: str) -> Version:
        """Read historical MAJOR.MINOR or MAJOR.MINOR.PATCH versions."""
        return cls._from_match(value, _LEGACY_VERSION)

    @classmethod
    def _from_match(cls, value: str, pattern: re.Pattern[str]) -> Version:
        if not isinstance(value, str):
            raise VersionError("Version must be a string.")
        match = pattern.fullmatch(value)
        if match is None:
            raise VersionError(f"Invalid release version: {value!r}")
        major, minor, patch = match.groups()
        return cls(int(major), int(minor), int(patch or 0))

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"


@dataclass(frozen=True)
class SparkleSignature:
    signature: str
    length: int

    def __post_init__(self) -> None:
        if not isinstance(self.signature, str) or not self.signature:
            raise SparkleSignatureError("Sparkle signature is empty.")
        if (
            isinstance(self.length, bool)
            or not isinstance(self.length, int)
            or self.length <= 0
        ):
            raise SparkleSignatureError("Sparkle length must be a positive integer.")


@dataclass(frozen=True)
class AppcastRelease:
    """Every field required to construct and verify one Sparkle item."""

    version: Version
    build: int
    pub_date: str
    minimum_system_version: str
    notes_html: str
    enclosure_url: str
    signature: str
    length: int
    content_type: str

    def __post_init__(self) -> None:
        if not isinstance(self.version, Version):
            raise VersionError("Release version must be a Version value.")
        if (
            isinstance(self.build, bool)
            or not isinstance(self.build, int)
            or self.build <= 0
        ):
            raise BuildNumberError("Build number must be a positive integer.")
        if (
            isinstance(self.length, bool)
            or not isinstance(self.length, int)
            or self.length <= 0
        ):
            raise AppcastError("Enclosure length must be a positive integer.")
        required = {
            "publication date": self.pub_date,
            "minimum system version": self.minimum_system_version,
            "enclosure URL": self.enclosure_url,
            "signature": self.signature,
            "content type": self.content_type,
        }
        missing = [
            name
            for name, value in required.items()
            if not isinstance(value, str) or not value
        ]
        if missing:
            raise AppcastError(f"Missing release fields: {', '.join(missing)}")
        if not isinstance(self.notes_html, str):
            raise AppcastError("Release notes must be text.")

    @property
    def title(self) -> str:
        return f"Version {self.version}"
