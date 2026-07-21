#!/bin/sh

set -eu

NODE_MODULES_DIR=${1:-}
if [ -z "$NODE_MODULES_DIR" ] || [ "$(basename "$NODE_MODULES_DIR")" != "node_modules" ] || [ ! -d "$NODE_MODULES_DIR" ]; then
  echo "error: expected an existing node_modules directory" >&2
  exit 1
fi

for package in \
  "$NODE_MODULES_DIR"/@anthropic-ai/claude-agent-sdk-darwin-* \
  "$NODE_MODULES_DIR"/@anthropic-ai/claude-agent-sdk-linux-* \
  "$NODE_MODULES_DIR"/@anthropic-ai/claude-agent-sdk-win32-* \
  "$NODE_MODULES_DIR"/@openai/codex-darwin-* \
  "$NODE_MODULES_DIR"/@openai/codex-linux-* \
  "$NODE_MODULES_DIR"/@openai/codex-win32-*
do
  [ -e "$package" ] || continue
  rm -rf -- "$package"
done
