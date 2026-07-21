import tempfile
import unittest
import subprocess
from unittest.mock import patch
from pathlib import Path

from scripts.release_tools.publisher import PublicationPlan, Publisher, PublicationError
from scripts.release_tools.processes import CURL_READ_FLAGS, CommandRunner, CurlWranglerRemote
from scripts.release_tools.cli import build_parser


class RecordingFeedTools:
    def __init__(self, events: list[str], digest: str = "baseline") -> None:
        self.events = events
        self.digest_value = digest

    def validate_staged(self, path: Path, expected: object) -> None:
        self.events.append("validate-staged")

    def digest(self, content: bytes) -> str:
        self.events.append("digest-live")
        return self.digest_value

    def validate_transition(self, live: bytes, staged: bytes, expected: object) -> None:
        self.events.append("validate-transition")

    def validate_published(self, content: bytes, expected: object) -> None:
        self.events.append(f"verify-feed:{content.decode()}")


class RecordingRemote:
    def __init__(self, events: list[str], fail_at: str | None = None) -> None:
        self.events = events
        self.fail_at = fail_at

    def _record(self, event: str) -> None:
        self.events.append(event)
        if event == self.fail_at:
            raise PublicationError(event)

    def read(self, url: str) -> bytes:
        event = f"read:{url}"
        self._record(event)
        return url.rsplit("/", 1)[-1].encode()

    def require_absent(self, url: str) -> None:
        self._record("require-absent")

    def upload(self, source: Path, key: str, content_type: str) -> None:
        self._record(f"upload:{key}")

    def require_length(self, url: str, expected: int) -> None:
        self._record(f"length:{url}:{expected}")


class PublisherTests(unittest.TestCase):
    def test_cli_parser_constructs_without_option_conflicts(self) -> None:
        parser = build_parser()
        self.assertIn("snapshot", parser.format_help())

    def test_publishes_in_safe_order_and_updates_tracked_feed_after_both_verifications(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staged = root / "staged.xml"
            staged.write_bytes(b"staged")
            tracked = root / "appcast.xml"
            tracked.write_bytes(b"old")
            dmg = root / "release.dmg"
            dmg.write_bytes(b"dmg")
            events: list[str] = []

            Publisher(RecordingRemote(events), RecordingFeedTools(events)).publish(
                make_plan(dmg=dmg, staged=staged, tracked=tracked)
            )

            self.assertEqual(
                events,
                [
                    "validate-staged",
                    "read:https://direct/appcast.xml",
                    "digest-live",
                    "validate-transition",
                    "require-absent",
                    "upload:versioned",
                    "length:https://direct/versioned.dmg:3",
                    "upload:appcast",
                    "read:https://direct/appcast.xml",
                    "verify-feed:appcast.xml",
                    "read:https://dub/appcast.xml",
                    "verify-feed:appcast.xml",
                    "upload:latest",
                    "length:https://direct/latest.dmg:3",
                ],
            )
            self.assertEqual(tracked.read_bytes(), b"staged")

    def test_baseline_digest_mismatch_stops_before_any_remote_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staged, tracked, dmg = create_files(root)
            events: list[str] = []

            with self.assertRaisesRegex(PublicationError, "live appcast changed"):
                Publisher(RecordingRemote(events), RecordingFeedTools(events, digest="changed")).publish(
                    make_plan(dmg=dmg, staged=staged, tracked=tracked)
                )

            self.assertNotIn("require-absent", events)
            self.assertEqual(tracked.read_bytes(), b"old")

    def test_feed_verification_failure_keeps_tracked_feed_and_latest_unchanged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            staged, tracked, dmg = create_files(root)
            events: list[str] = []
            remote = RecordingRemote(events, fail_at="read:https://dub/appcast.xml")

            with self.assertRaises(PublicationError):
                Publisher(remote, RecordingFeedTools(events)).publish(
                    make_plan(dmg=dmg, staged=staged, tracked=tracked)
                )

            self.assertEqual(tracked.read_bytes(), b"old")
            self.assertNotIn("upload:latest", events)


class RecordingRunner:
    def __init__(self, results: list[subprocess.CompletedProcess[bytes]]) -> None:
        self.results = results
        self.calls: list[tuple[list[str], bool]] = []

    def run(self, arguments: object, *, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        self.calls.append((list(arguments), check))
        return self.results.pop(0)


class RemoteProcessTests(unittest.TestCase):
    def test_command_runner_uses_argument_arrays_and_disables_shell(self) -> None:
        completed = subprocess.CompletedProcess([], 0, stdout=b"", stderr=b"")
        with patch("scripts.release_tools.processes.subprocess.run", return_value=completed) as run:
            CommandRunner().run(["tool", "argument"])

        run.assert_called_once_with(
            ["tool", "argument"], check=True, capture_output=True, shell=False
        )

    def test_every_http_read_uses_required_curl_flags(self) -> None:
        runner = RecordingRunner([
            subprocess.CompletedProcess([], 0, stdout=b"feed", stderr=b""),
            subprocess.CompletedProcess([], 0, stdout=b"content-length: 3\r\n", stderr=b""),
        ])
        remote = CurlWranglerRemote(runner, ["wrangler"], "bucket")

        self.assertEqual(remote.read("https://feed"), b"feed")
        remote.require_length("https://dmg", 3)

        for arguments, _ in runner.calls:
            self.assertEqual(arguments[:5], ["curl", *CURL_READ_FLAGS])

    def test_immutable_absence_accepts_only_curl_fail_404(self) -> None:
        accepted = RecordingRunner([
            subprocess.CompletedProcess([], 22, stdout=b"404", stderr=b"not found")
        ])
        CurlWranglerRemote(accepted, ["wrangler"], "bucket").require_absent("https://dmg")

        for result in (
            subprocess.CompletedProcess([], 0, stdout=b"200", stderr=b""),
            subprocess.CompletedProcess([], 22, stdout=b"403", stderr=b"forbidden"),
            subprocess.CompletedProcess([], 6, stdout=b"000", stderr=b"dns"),
        ):
            with self.subTest(returncode=result.returncode, status=result.stdout):
                runner = RecordingRunner([result])
                with self.assertRaises(PublicationError):
                    CurlWranglerRemote(runner, ["wrangler"], "bucket").require_absent("https://dmg")

    def test_upload_uses_argument_array_without_shell(self) -> None:
        runner = RecordingRunner([subprocess.CompletedProcess([], 0, stdout=b"", stderr=b"")])
        remote = CurlWranglerRemote(runner, ["pnpm", "dlx", "wrangler"], "bucket")

        remote.upload(Path("release.dmg"), "key", "application/x-apple-diskimage")

        self.assertEqual(
            runner.calls,
            [(["pnpm", "dlx", "wrangler", "r2", "object", "put", "bucket/key",
               "--file=release.dmg", "--content-type=application/x-apple-diskimage", "--remote"], True)],
        )


def create_files(root: Path) -> tuple[Path, Path, Path]:
    staged = root / "staged.xml"
    staged.write_bytes(b"staged")
    tracked = root / "appcast.xml"
    tracked.write_bytes(b"old")
    dmg = root / "release.dmg"
    dmg.write_bytes(b"dmg")
    return staged, tracked, dmg


def make_plan(dmg: Path, staged: Path, tracked: Path) -> PublicationPlan:
    return PublicationPlan(
        dmg=dmg,
        staged_appcast=staged,
        tracked_appcast=tracked,
        expected=object(),
        baseline_digest="baseline",
        versioned_key="versioned",
        appcast_key="appcast",
        latest_key="latest",
        versioned_url="https://direct/versioned.dmg",
        direct_appcast_url="https://direct/appcast.xml",
        dub_appcast_url="https://dub/appcast.xml",
        latest_url="https://direct/latest.dmg",
        dmg_length=3,
    )


if __name__ == "__main__":
    unittest.main()
