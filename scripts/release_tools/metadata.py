"""Safe readers, writers, and validators for local release metadata."""

from __future__ import annotations

import json
import re
from typing import Any, Iterable

from .models import (
    BuildNumberError,
    DuplicateVersionError,
    MetadataError,
    StaleVersionError,
    Version,
    VersionError,
)


_PROJECT_VERSION = re.compile(
    r'^(?P<prefix>\s*MARKETING_VERSION\s*:\s*)"(?P<value>[^"]*)"(?P<suffix>\s*(?:#.*)?)$',
    re.MULTILINE,
)
_PROJECT_BUILD = re.compile(
    r'^(?P<prefix>\s*CURRENT_PROJECT_VERSION\s*:\s*)"(?P<value>[^"]*)"(?P<suffix>\s*(?:#.*)?)$',
    re.MULTILINE,
)


def read_project_metadata(project_text: str) -> tuple[Version, int]:
    """Read the single marketing version and positive build from project YAML."""
    version_value = _single_project_value(_PROJECT_VERSION, project_text, "MARKETING_VERSION")
    build_value = _single_project_value(_PROJECT_BUILD, project_text, "CURRENT_PROJECT_VERSION")
    version = Version.parse(version_value)
    build = _positive_build(build_value)
    return version, build


def update_project_metadata(project_text: str, version: Version, build: int) -> str:
    """Update exact YAML scalar matches without evaluating or interpolating source text."""
    read_project_metadata(project_text)
    _require_positive_build(build)
    updated = _PROJECT_VERSION.sub(
        lambda match: f'{match.group("prefix")}"{version}"{match.group("suffix")}',
        project_text,
        count=1,
    )
    return _PROJECT_BUILD.sub(
        lambda match: f'{match.group("prefix")}"{build}"{match.group("suffix")}',
        updated,
        count=1,
    )


def read_server_package_version(package_text: str) -> Version:
    package = _read_package(package_text)
    value = package.get("version")
    if not isinstance(value, str):
        raise MetadataError("server-app/package.json must contain one string version.")
    try:
        return Version.parse(value)
    except VersionError:
        raise


def update_server_package_version(package_text: str, version: Version) -> str:
    package = _read_package(package_text)
    if not isinstance(package.get("version"), str):
        raise MetadataError("server-app/package.json must contain one string version.")
    package["version"] = str(version)
    return json.dumps(package, indent=2, ensure_ascii=False) + "\n"


def compute_next_build(local_build: int, live_builds: Iterable[int]) -> int:
    """Return one above the highest valid local or live build number."""
    _require_positive_build(local_build)
    builds = list(live_builds)
    for build in builds:
        _require_positive_build(build)
    return max([local_build, *builds]) + 1


def validate_release_candidate(
    version: Version,
    build: int,
    local_version: Version,
    local_build: int,
    live_versions: Iterable[Version],
    live_builds: Iterable[int],
) -> None:
    """Require both version and build to advance all local and live metadata."""
    _require_positive_build(build)
    _require_positive_build(local_build)
    versions = list(live_versions)
    builds = list(live_builds)
    for live_build in builds:
        _require_positive_build(live_build)
    if len(set(versions)) != len(versions):
        raise DuplicateVersionError("The live feed contains duplicate versions.")
    if version == local_version or version in versions:
        raise DuplicateVersionError(f"Version {version} already exists.")
    newest_version = max([local_version, *versions])
    if version <= newest_version:
        raise StaleVersionError(f"Version {version} must be newer than {newest_version}.")
    highest_build = max([local_build, *builds])
    if build <= highest_build:
        raise BuildNumberError(f"Build {build} must be greater than {highest_build}.")


def verify_release_metadata(
    project_text: str,
    package_text: str,
    expected_version: Version,
    expected_build: int,
) -> None:
    """Verify every local version/build field exactly matches the release."""
    project_version, project_build = read_project_metadata(project_text)
    package_version = read_server_package_version(package_text)
    actual = (project_version, project_build, package_version)
    expected = (expected_version, expected_build, expected_version)
    if actual != expected:
        raise MetadataError(f"Release metadata mismatch: expected {expected}, found {actual}.")


def _single_project_value(pattern: re.Pattern[str], text: str, field: str) -> str:
    matches = list(pattern.finditer(text))
    if len(matches) != 1:
        raise MetadataError(f"Expected exactly one {field}, found {len(matches)}.")
    return matches[0].group("value")


def _positive_build(value: str) -> int:
    if re.fullmatch(r"[1-9][0-9]*", value) is None:
        raise BuildNumberError(f"Invalid build number: {value!r}")
    return int(value)


def _require_positive_build(build: int) -> None:
    if isinstance(build, bool) or not isinstance(build, int) or build <= 0:
        raise BuildNumberError("Build number must be a positive integer.")


def _read_package(package_text: str) -> dict[str, Any]:
    def reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
        result: dict[str, Any] = {}
        for key, value in pairs:
            if key in result:
                raise MetadataError(f"Duplicate JSON key: {key}")
            result[key] = value
        return result

    try:
        package = json.loads(package_text, object_pairs_hook=reject_duplicate_keys)
    except MetadataError:
        raise
    except (json.JSONDecodeError, TypeError) as error:
        raise MetadataError(f"Invalid server package metadata: {error}") from error
    if not isinstance(package, dict):
        raise MetadataError("server-app/package.json must contain an object.")
    return package
