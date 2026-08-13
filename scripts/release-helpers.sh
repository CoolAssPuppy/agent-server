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

# Copies the files a release bump rewrites into a backup directory.
snapshot_release_versions() {
  local backup_dir="${1:?backup dir required}"
  shift

  mkdir -p "$backup_dir"
  local index=0
  for file in "$@"; do
    cp "$file" "$backup_dir/$index"
    index=$((index + 1))
  done
}

# Puts a snapshot back. Files missing from the snapshot are left alone.
restore_release_versions() {
  local backup_dir="${1:?backup dir required}"
  shift

  [ -d "$backup_dir" ] || return 0
  local index=0
  for file in "$@"; do
    if [ -f "$backup_dir/$index" ]; then
      cp "$backup_dir/$index" "$file"
    fi
    index=$((index + 1))
  done
}

# Exit handler for a release: the version bump is only correct once the
# release is live, so a run that dies before the publish step gets its bump
# rolled back. Left in place, that bump makes the next attempt fail the
# duplicate-version guard, which hides whatever actually broke.
finish_release_versions() {
  local status=$?
  local backup_dir="${1:?backup dir required}"
  local did_publish="${2:?publish flag required}"
  shift 2

  if [ "$did_publish" != "1" ]; then
    echo "==> Release did not publish. Restoring the pre-bump version files."
    restore_release_versions "$backup_dir" "$@"
  fi
  rm -rf "$backup_dir"
  return "$status"
}
