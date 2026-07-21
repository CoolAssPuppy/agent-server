from __future__ import annotations

import argparse
import hashlib
import sys
from pathlib import Path
from typing import Sequence

from .appcast import parse_appcast, parse_sparkle_signature, prepend_release, verify_release
from .metadata import (
    compute_next_build,
    read_project_metadata,
    update_project_metadata,
    update_server_package_version,
    validate_release_candidate,
    verify_release_metadata,
)
from .models import AppcastRelease, ReleaseToolError, Version
from .processes import CommandRunner, CurlWranglerRemote
from .publisher import (
    FeedTools,
    PublicationError,
    PublicationPlan,
    Publisher,
    atomic_write,
    atomic_write_many,
)


class AppcastFeedTools(FeedTools):
    def validate_staged(self, path: Path, expected: AppcastRelease) -> None:
        verify_release(path.read_text(), expected)

    def digest(self, content: bytes) -> str:
        return hashlib.sha256(content).hexdigest()

    def validate_transition(self, live: bytes, staged: bytes, expected: AppcastRelease) -> None:
        live_releases = parse_appcast(live.decode())
        staged_releases = parse_appcast(staged.decode())
        if staged_releases != [expected, *live_releases]:
            raise PublicationError("staged appcast does not preserve the verified live history")

    def validate_published(self, content: bytes, expected: AppcastRelease) -> None:
        verify_release(content.decode(), expected)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    snapshot = commands.add_parser("snapshot")
    snapshot.add_argument("--url", required=True)
    snapshot.add_argument("--output", type=Path, required=True)

    prepare = commands.add_parser("prepare")
    prepare.add_argument("--version", required=True)
    prepare.add_argument("--project", type=Path, required=True)
    prepare.add_argument("--package", type=Path, required=True)
    prepare.add_argument("--live", type=Path, required=True)

    stage = commands.add_parser("stage")
    _release_arguments(stage)
    stage.add_argument("--live", type=Path, required=True)
    stage.add_argument("--signature-file", type=Path, required=True)
    stage.add_argument("--dmg", type=Path, required=True)
    stage.add_argument("--output", type=Path, required=True)

    publish = commands.add_parser("publish")
    _release_arguments(publish)
    publish.add_argument("--dmg", type=Path, required=True)
    publish.add_argument("--signature-file", type=Path, required=True)
    publish.add_argument("--staged-appcast", type=Path, required=True)
    publish.add_argument("--tracked-appcast", type=Path, required=True)
    publish.add_argument("--baseline-digest", required=True)
    publish.add_argument("--bucket", required=True)
    publish.add_argument("--public-base", required=True)
    publish.add_argument("--dub-url", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.command == "snapshot":
        content = CurlWranglerRemote(CommandRunner(), _wrangler(), "unused").read(args.url)
        parse_appcast(content.decode())
        atomic_write(args.output, content)
        print(hashlib.sha256(content).hexdigest())
        return 0
    if args.command == "prepare":
        version = Version.parse(args.version)
        project_text = args.project.read_text()
        package_text = args.package.read_text()
        local_version, local_build = read_project_metadata(project_text)
        releases = parse_appcast(args.live.read_text())
        build = compute_next_build(local_build, (item.build for item in releases))
        validate_release_candidate(
            version, build, local_version, local_build,
            (item.version for item in releases), (item.build for item in releases),
        )
        updated_project = update_project_metadata(project_text, version, build)
        updated_package = update_server_package_version(package_text, version)
        verify_release_metadata(updated_project, updated_package, version, build)
        atomic_write_many((
            (args.project, updated_project.encode()),
            (args.package, updated_package.encode()),
        ))
        print(build)
        return 0
    signature = parse_sparkle_signature(args.signature_file.read_text())
    release = _expected_release(args, signature.signature, signature.length)
    if args.command == "stage":
        if signature.length != args.dmg.stat().st_size:
            raise PublicationError("Sparkle length does not match the staged DMG")
        staged = prepend_release(args.live.read_text(), release)
        verify_release(staged, release)
        atomic_write(args.output, staged.encode())
        return 0
    if args.command == "publish":
        base = args.public_base.rstrip("/")
        prefix = "apps/agent-server"
        dmg_name = f"AgentServer-{args.version}.dmg"
        remote = CurlWranglerRemote(CommandRunner(), _wrangler(), args.bucket)
        Publisher(remote, AppcastFeedTools()).publish(PublicationPlan(
            dmg=args.dmg,
            staged_appcast=args.staged_appcast,
            tracked_appcast=args.tracked_appcast,
            expected=release,
            baseline_digest=args.baseline_digest,
            versioned_key=f"{prefix}/{dmg_name}",
            appcast_key=f"{prefix}/appcast.xml",
            latest_key=f"{prefix}/AgentServer-latest.dmg",
            versioned_url=f"{base}/{prefix}/{dmg_name}",
            direct_appcast_url=f"{base}/{prefix}/appcast.xml",
            dub_appcast_url=args.dub_url,
            latest_url=f"{base}/{prefix}/AgentServer-latest.dmg",
        ))
        return 0
    raise AssertionError(args.command)


def _release_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--version", required=True)
    parser.add_argument("--build", type=int, required=True)
    parser.add_argument("--url", required=True)
    parser.add_argument("--pub-date", required=True)
    parser.add_argument("--notes", required=True)


def _expected_release(args: argparse.Namespace, signature: str, length: int) -> AppcastRelease:
    return AppcastRelease(
        version=Version.parse(args.version), build=args.build, pub_date=args.pub_date,
        minimum_system_version="14.0", notes_html=args.notes,
        enclosure_url=args.url, signature=signature, length=length,
        content_type="application/x-apple-diskimage",
    )


def _wrangler() -> list[str]:
    return ["pnpm", "exec", "wrangler"]


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (OSError, UnicodeError, PublicationError, ReleaseToolError) as error:
        print(f"Error: {error}", file=sys.stderr)
        raise SystemExit(1) from None
