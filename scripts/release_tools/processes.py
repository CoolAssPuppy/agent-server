from __future__ import annotations

import shlex
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence

from .publisher import PublicationError, sha256_file


CURL_READ_FLAGS = ("--fail", "--location", "--silent", "--show-error")


class CommandRunner:
    def run(self, arguments: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        command = list(arguments)
        try:
            return subprocess.run(command, check=check, capture_output=True, shell=False)
        except subprocess.CalledProcessError as error:
            stderr = (error.stderr or b"").decode(errors="replace").strip()
            detail = f": {stderr}" if stderr else ""
            raise PublicationError(f"command failed: {shlex.join(command)}{detail}") from error


class CurlWranglerRemote:
    def __init__(self, runner: CommandRunner, wrangler: Sequence[str], bucket: str) -> None:
        self._runner = runner
        self._wrangler = tuple(wrangler)
        self._bucket = bucket

    def read(self, url: str) -> bytes:
        return self._runner.run(("curl", *CURL_READ_FLAGS, url)).stdout

    def exists(self, url: str) -> bool:
        result = self._runner.run(
            (
                "curl", *CURL_READ_FLAGS, "--output", "/dev/null",
                "--write-out", "%{http_code}", url,
            ),
            check=False,
        )
        status = result.stdout.decode().strip()
        if result.returncode == 22 and status == "404":
            return False
        if result.returncode == 0 and status == "200":
            return True
        stderr = result.stderr.decode(errors="replace").strip()
        detail = f"; {stderr}" if stderr else ""
        raise PublicationError(
            f"could not determine artifact state ({status or 'no status'}): {url}{detail}"
        )

    def upload(self, source: Path, key: str, content_type: str) -> None:
        self._runner.run(
            (
                *self._wrangler, "r2", "object", "put", f"{self._bucket}/{key}",
                f"--file={source}", f"--content-type={content_type}", "--remote",
            )
        )

    def require_length(self, url: str, expected: int) -> None:
        result = self._runner.run(("curl", *CURL_READ_FLAGS, "--head", url))
        lengths = [
            line.split(":", 1)[1].strip()
            for line in result.stdout.decode().splitlines()
            if line.lower().startswith("content-length:")
        ]
        if not lengths or lengths[-1] != str(expected):
            actual = lengths[-1] if lengths else "missing"
            raise PublicationError(f"content length mismatch for {url}: expected {expected}, got {actual}")

    def require_sha256(self, url: str, expected: str) -> None:
        with tempfile.TemporaryDirectory(prefix="agent-server-release-") as directory:
            downloaded = Path(directory) / "artifact.dmg"
            self._runner.run(("curl", *CURL_READ_FLAGS, "--output", str(downloaded), url))
            actual = sha256_file(downloaded)
        if actual != expected:
            raise PublicationError(
                f"SHA-256 mismatch for immutable artifact {url}: expected {expected}, got {actual}"
            )
