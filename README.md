# AgentToolbox

Agent-first home: **https://agnttoolbx.agenttoolbox2026.workers.dev**

**Docs Pack** is the first experimental product: up to five supported public
documentation URLs and literal query terms return bounded exact excerpts,
source hashes, offsets and matched headings. Price: **$0.01 USDC on Base per
successful whole pack**, using HTTP x402 v2. No source match or failed source
means no settlement. Live payment verification remains user-controlled and has
not been performed by the implementation agent.

## Try it now

Free example — no wallet, no payment, fixed public inputs:

```sh
curl -s "https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/example" | python3 -m json.tool | head -60
```

Paid invoke — returns HTTP 402 with the x402 challenge. Authorize the disclosed
amount with an x402 v2-capable wallet/client, then resubmit the identical body,
key and authorization. The server settles only after the whole result validates:

```sh
IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4().hex + uuid.uuid4().hex[:32])')"
curl -s -X POST "https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/invoke" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"version":"0.1.0","input":{"urls":["https://docs.python.org/3/library/asyncio.html"],"query":"event loop","max_excerpt_chars":4000},"max_charge_usdc_atomic":10000}'
```

Runnable scripts: [`examples/free-call.sh`](examples/free-call.sh),
[`examples/paid-call.sh`](examples/paid-call.sh).

## Endpoints

- Contract: `/v1/products/docs-pack`
- Real, fixed free example: `/v1/products/docs-pack/example`
- Paid invocation: `POST /v1/products/docs-pack/invoke`
- HTTP discovery: `/v1/products`; MCP discovery: `/mcp`
- MCP Registry: `io.github.agenttoolbox2026/docs-pack` (v0.1.0)
- Machine instructions: `/llms.txt`; schemas: `/openapi.json`
- Crawler payment discovery: `/.well-known/x402` (discovery v1, payment v2)
- Human observer page: `/humans`; public paid-purchase total: `/v1/stats`
- Private owner feedback: `POST /v1/feedback` or MCP `leave_feedback`.
- Owner reporting lives in the separate private `AgentToolbox-Admin` project and
  `agnttoolbx-admin` Worker. Missing Access settings deny all admin access.
- All HTML pages use the shared exact browser title `AgentToolbox`.

The human counter counts completed live paid purchases, including repeats.
It excludes synthetic tests, mocks, failed/pending operations, replays and
self-purchases from the receiving wallet. It does not identify unique agents.
Private operations and reports remain authenticated. The original retry gate
is retired; its source, D1 database and history remain preserved.

## Run

Node.js 24+ and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm --dir platform install --frozen-lockfile
pnpm dev
pnpm test
pnpm check
pnpm worker:check
pnpm smoke https://agnttoolbx.agenttoolbox2026.workers.dev
pnpm report:remote
```

Platform code is in `platform/`; root `src/`, `test/` and `scripts/` preserve the
legacy experiment. The original icon is unchanged. No paid Cloudflare resource,
facilitator account, top-up, wallet secret or automatic billing was added.

Read [the brief](BUILD.md), [product and benchmark](docs/docs-pack.md),
[operations](docs/platform-operations.md) and [payment limits](docs/platform-x402.md).
