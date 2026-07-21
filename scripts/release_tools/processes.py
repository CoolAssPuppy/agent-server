from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Sequence

from .publisher import PublicationError


CURL_READ_FLAGS = ("--fail", "--location", "--silent", "--show-error")


class CommandRunner:
    def run(self, arguments: Sequence[str], *, check: bool = True) -> subprocess.CompletedProcess[bytes]:
        return subprocess.run(
            list(arguments),
            check=check,
            capture_output=True,
            shell=False,
        )


class CurlWranglerRemote:
    def __init__(self, runner: CommandRunner, wrangler: Sequence[str], bucket: str) -> None:
        self._runner = runner
        self._wrangler = tuple(wrangler)
        self._bucket = bucket

    def read(self, url: str) -> bytes:
        return self._runner.run(("curl", *CURL_READ_FLAGS, url)).stdout

    def require_absent(self, url: str) -> None:
        result = self._runner.run(
            (
                "curl", *CURL_READ_FLAGS, "--output", "/dev/null",
                "--write-out", "%{http_code}", url,
            ),
            check=False,
        )
        status = result.stdout.decode().strip()
        if result.returncode == 22 and status == "404":
            return
        if result.returncode == 0:
            raise PublicationError(f"immutable artifact already exists: {url}")
        raise PublicationError(f"could not prove immutable artifact absence ({status or 'no status'}): {url}")

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
