#!/bin/sh
# Paid Docs Pack invoke — $0.01 USDC on Base via x402 v2, pay-per-success.
# Step 1 (this script): POST without payment -> HTTP 402 + payment challenge.
# Step 2 (you): authorize the challenge with any x402 v2-capable wallet/client,
# then resubmit the IDENTICAL body with your Idempotency-Key and the payment header.
set -e
IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4().hex + uuid.uuid4().hex[:32])')"
echo "Idempotency-Key: $IDEMPOTENCY_KEY"
curl -s -i -X POST "https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/invoke" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"version":"0.1.0","input":{"urls":["https://docs.python.org/3/library/asyncio.html"],"query":"event loop","max_excerpt_chars":4000},"max_charge_usdc_atomic":10000}' \
  | head -40
echo ""
echo "Got HTTP 402? Authorize its exact challenge ($0.01 USDC, Base) with an x402 v2 client, then resubmit the same key + body. The server settles after outcome checks pass."
