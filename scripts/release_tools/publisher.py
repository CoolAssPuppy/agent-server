from __future__ import annotations

import hashlib
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .models import AppcastRelease


class PublicationError(RuntimeError):
    """Raised when publication cannot safely continue."""


class FeedTools(Protocol):
    def validate_staged(self, path: Path, expected: AppcastRelease) -> None: ...
    def digest(self, content: bytes) -> str: ...
    def validate_transition(self, live: bytes, staged: bytes, expected: AppcastRelease) -> None: ...
    def validate_published(self, content: bytes, expected: AppcastRelease) -> None: ...


class PublicationRemote(Protocol):
    def read(self, url: str) -> bytes: ...
    def exists(self, url: str) -> bool: ...
    def upload(self, source: Path, key: str, content_type: str) -> None: ...
    def require_length(self, url: str, expected: int) -> None: ...
    def require_sha256(self, url: str, expected: str) -> None: ...


@dataclass(frozen=True)
class PublicationPlan:
    dmg: Path
    staged_appcast: Path
    tracked_appcast: Path
    expected: AppcastRelease
    baseline_digest: str
    versioned_key: str
    appcast_key: str
    latest_key: str
    versioned_url: str
    direct_appcast_url: str
    dub_appcast_url: str
    latest_url: str


class Publisher:
    def __init__(self, remote: PublicationRemote, feeds: FeedTools) -> None:
        self._remote = remote
        self._feeds = feeds

    def publish(self, plan: PublicationPlan) -> None:
        self._validate_local_artifacts(plan)
        self._feeds.validate_staged(plan.staged_appcast, plan.expected)
        live = self._remote.read(plan.direct_appcast_url)
        staged = plan.staged_appcast.read_bytes()
        is_feed_published = live == staged
        if is_feed_published:
            self._feeds.validate_published(live, plan.expected)
        else:
            if self._feeds.digest(live) != plan.baseline_digest:
                raise PublicationError("live appcast changed after release staging")
            self._feeds.validate_transition(live, staged, plan.expected)

        if self._remote.exists(plan.versioned_url):
            self._remote.require_sha256(plan.versioned_url, sha256_file(plan.dmg))
        else:
            self._remote.upload(plan.dmg, plan.versioned_key, "application/x-apple-diskimage")
        self._remote.require_length(plan.versioned_url, plan.expected.length)

        if not is_feed_published:
            self._remote.upload(
                plan.staged_appcast,
                plan.appcast_key,
                "application/xml; charset=utf-8",
            )
        self._feeds.validate_published(self._remote.read(plan.direct_appcast_url), plan.expected)
        self._feeds.validate_published(self._remote.read(plan.dub_appcast_url), plan.expected)

        self._replace_tracked_feed(plan.staged_appcast, plan.tracked_appcast)
        self._remote.upload(plan.dmg, plan.latest_key, "application/x-apple-diskimage")
        self._remote.require_length(plan.latest_url, plan.expected.length)

    @staticmethod
    def _validate_local_artifacts(plan: PublicationPlan) -> None:
        if plan.expected.enclosure_url != plan.versioned_url:
            raise PublicationError("release enclosure URL does not match the versioned artifact URL")
        if not plan.dmg.is_file():
            raise PublicationError(f"DMG is missing: {plan.dmg}")
        if not plan.staged_appcast.is_file():
            raise PublicationError(f"staged appcast is missing: {plan.staged_appcast}")
        actual_length = plan.dmg.stat().st_size
        if actual_length != plan.expected.length:
            raise PublicationError(
                f"DMG length changed after signing: expected {plan.expected.length}, got {actual_length}"
            )

    @staticmethod
    def _replace_tracked_feed(staged: Path, tracked: Path) -> None:
        atomic_write(tracked, staged.read_bytes())


def atomic_write(path: Path, content: bytes) -> None:
    """Replace one local file only after its complete contents reach disk."""
    atomic_write_many(((path, content),))


def atomic_write_many(updates: tuple[tuple[Path, bytes], ...]) -> None:
    """Replace related local files together, restoring all originals on failure."""
    originals = {path: path.read_bytes() if path.exists() else None for path, _ in updates}
    staged: list[tuple[Path, str]] = []
    committed: list[Path] = []
    try:
        for path, content in updates:
            staged.append((path, _stage_file(path, content)))
        for path, temporary in staged:
            os.replace(temporary, path)
            committed.append(path)
    except BaseException as error:
        try:
            for path in reversed(committed):
                original = originals[path]
                if original is None:
                    path.unlink(missing_ok=True)
                else:
                    restoration = _stage_file(path, original)
                    try:
                        os.replace(restoration, path)
                    finally:
                        Path(restoration).unlink(missing_ok=True)
        except BaseException as rollback_error:
            raise PublicationError(
                f"metadata update failed and rollback was incomplete: {rollback_error}"
            ) from error
        raise
    finally:
        for _, temporary in staged:
            Path(temporary).unlink(missing_ok=True)


def _stage_file(path: Path, content: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    try:
        with os.fdopen(descriptor, "wb") as destination:
            destination.write(content)
            destination.flush()
            os.fsync(destination.fileno())
        return temporary_name
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def sha256_file(path: Path) -> str:
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()
