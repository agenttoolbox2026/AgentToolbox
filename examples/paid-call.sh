#!/bin/sh
# Read current minimum-price contracts and save an unsigned Docs Pack request.
# Requires Node24 and installed repository dependencies. No POST or signature.
set -eu
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node "$script_dir/prepare-first-request.js" docs-pack "${1:-agenttoolbox-unsigned-request.json}"
