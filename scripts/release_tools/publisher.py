from __future__ import annotations

import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


class PublicationError(RuntimeError):
    """Raised when publication cannot safely continue."""


class FeedTools(Protocol):
    def validate_staged(self, path: Path, expected: object) -> None: ...
    def digest(self, content: bytes) -> str: ...
    def validate_transition(self, live: bytes, staged: bytes, expected: object) -> None: ...
    def validate_published(self, content: bytes, expected: object) -> None: ...


class PublicationRemote(Protocol):
    def read(self, url: str) -> bytes: ...
    def require_absent(self, url: str) -> None: ...
    def upload(self, source: Path, key: str, content_type: str) -> None: ...
    def require_length(self, url: str, expected: int) -> None: ...


@dataclass(frozen=True)
class PublicationPlan:
    dmg: Path
    staged_appcast: Path
    tracked_appcast: Path
    expected: object
    baseline_digest: str
    versioned_key: str
    appcast_key: str
    latest_key: str
    versioned_url: str
    direct_appcast_url: str
    dub_appcast_url: str
    latest_url: str
    dmg_length: int


class Publisher:
    def __init__(self, remote: PublicationRemote, feeds: FeedTools) -> None:
        self._remote = remote
        self._feeds = feeds

    def publish(self, plan: PublicationPlan) -> None:
        self._feeds.validate_staged(plan.staged_appcast, plan.expected)
        live = self._remote.read(plan.direct_appcast_url)
        if self._feeds.digest(live) != plan.baseline_digest:
            raise PublicationError("live appcast changed after release staging")
        staged = plan.staged_appcast.read_bytes()
        self._feeds.validate_transition(live, staged, plan.expected)

        self._remote.require_absent(plan.versioned_url)
        self._remote.upload(plan.dmg, plan.versioned_key, "application/x-apple-diskimage")
        self._remote.require_length(plan.versioned_url, plan.dmg_length)

        self._remote.upload(plan.staged_appcast, plan.appcast_key, "application/xml; charset=utf-8")
        self._feeds.validate_published(self._remote.read(plan.direct_appcast_url), plan.expected)
        self._feeds.validate_published(self._remote.read(plan.dub_appcast_url), plan.expected)

        self._replace_tracked_feed(plan.staged_appcast, plan.tracked_appcast)
        self._remote.upload(plan.dmg, plan.latest_key, "application/x-apple-diskimage")
        self._remote.require_length(plan.latest_url, plan.dmg_length)

    @staticmethod
    def _replace_tracked_feed(staged: Path, tracked: Path) -> None:
        tracked.parent.mkdir(parents=True, exist_ok=True)
        descriptor, temporary_name = tempfile.mkstemp(dir=tracked.parent, prefix=f".{tracked.name}.")
        try:
            with os.fdopen(descriptor, "wb") as destination:
                destination.write(staged.read_bytes())
                destination.flush()
                os.fsync(destination.fileno())
            os.replace(temporary_name, tracked)
        except BaseException:
            Path(temporary_name).unlink(missing_ok=True)
            raise
