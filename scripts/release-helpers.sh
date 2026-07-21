#!/bin/bash

# Creates, submits, and always removes the temporary app archive.
# The caller provides run_notarytool so credential handling stays centralized.
notarize_app_archive() (
  set -euo pipefail

  local app_path="${1:?app path required}"
  local archive="${2:?archive path required}"

  cleanup_archive() {
    rm -f "$archive"
  }

  handle_interrupt() {
    trap - INT TERM
    exit 130
  }

  trap cleanup_archive EXIT
  trap handle_interrupt INT TERM

  ditto -c -k --sequesterRsrc --keepParent "$app_path" "$archive"
  run_notarytool submit "$archive" --wait
)
