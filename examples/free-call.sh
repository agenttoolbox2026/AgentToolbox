#!/bin/sh
# Free Docs Pack example — no wallet, no payment, fixed public inputs.
# Runs the real handler so you can inspect output quality before spending anything.
set -e
curl -s "https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/example" | python3 -m json.tool | head -60
