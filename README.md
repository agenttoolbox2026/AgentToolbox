# AgentToolbox

Agent-first home: **https://agi.agenttoolbox2026.workers.dev**

Four beta tools at a **default $0.01 USDC per successful call on Base**
using x402 v2:

- **Docs Pack:** query-matched excerpts from supported documentation sources.
- **QuoteProof:** quotation matches, ambiguity and source evidence; not claim truth.
- **ContractCases:** independently checked boundary and negative examples for a bounded JSON Schema subset.
- **MCP WireCheck:** discovery and tools/list checks on your public workers.dev endpoint.

No qualifying outcome, no charge. Each tool publishes versioned machine criteria
at `/v1/products/{id}/criteria`; the same predicates run in its handler alongside
the input/output schemas and limits. Buyers can inspect canonical success bytes,
verify their SHA-256, and pin that definition before paying. Settlement follows
validated success. All four current products are built by AgentToolbox.
See [success contract pins](docs/success-contracts.md).

We are in **Phase 1: learning from real agent buyers**. The next milestone is one
verified paid purchase by an external agent. The long-term vision is a public
agent marketplace with approved listings and outcome-based transactions; Phase 2
builds on paid-agent proof. Creator submissions and reviewed updates are part of
the current Phase 1 shipping scope, alongside buyer learning. Read the
[current brief](BUILD.md) and [learning protocol](docs/phase1-learning.md).

Live payment behavior and maximum Free-plan CPU capacity remain unverified.
Demand and usefulness beyond competent free primitives are not established by
our integration checks.

## Try it now

Free example — no wallet, no payment, fixed public inputs:

```sh
curl -s "https://agi.agenttoolbox2026.workers.dev/v1/products/docs-pack/example" | python3 -m json.tool | head -60
```

The default paid path needs no separate quote. This unsigned request returns
HTTP 402 with the exact $0.01 x402 challenge. With authorized funds and an x402
v2-capable client, sign those disclosed requirements and resubmit the identical
body and key with the payment authorization. After a lost response, retain that
same body, key and authorization; an uncertain payment is not permission to pay
again. The server settles only after the whole result validates:

```sh
IDEMPOTENCY_KEY="$(python3 -c 'import uuid; print(uuid.uuid4().hex + uuid.uuid4().hex[:32])')"
curl -s -X POST "https://agi.agenttoolbox2026.workers.dev/v1/products/docs-pack/invoke" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{"version":"0.1.1","input":{"urls":["https://docs.python.org/3/library/asyncio.html"],"query":"event loop","max_excerpt_chars":4000},"max_charge_usdc_atomic":"10000"}'
```

Runnable scripts: [`examples/free-call.sh`](examples/free-call.sh),
[`examples/paid-call.sh`](examples/paid-call.sh). The second script performs only
three synthetic read-only discovery GETs and saves the complete unsigned body,
key and verified contract hashes; it does not invoke, authorize or pay.

For local full-runtime input preflight and a buyer-owned wallet handoff:

```sh
node examples/prepare-first-request.js contract-cases unsigned-request.json
# Optional third argument: path to your input JSON file.
```

This helper refuses a live contract that differs from its installed checkout.
Inspect the saved amount, network, asset and receiver before using an x402 v2
wallet client. Save its complete original authorization before sending; never
overwrite a request after uncertain delivery. An unsigned challenge is not a
completed purchase or verification that a wallet can pay.

Free offline test cases at `/v1/products/{id}/examples` expose inputs, mocked
source responses and expected checks for all four products. These are
independently checkable fixtures, not live customer or usefulness evidence.
See [value and evidence](docs/tool-value-evidence.md).

Optional real-input previews for Docs Pack and ContractCases retain a private
result and require a quote/payment to unlock it. Verdict tools have no dynamic
preview. Docs Pack shows literal term coverage and a short snippet for free.
Higher buyer-chosen amounts remain supported as an advanced option and
require an exact durable quote. Neither flow is required for the default direct
call. See [pricing and preview flow](docs/buyer-chosen-pricing.md).

## Endpoints

- HTTP catalog: `/v1/products`; MCP discovery: `/mcp`
- Product contract and charge criteria: `/v1/products/{id}` and `/v1/products/{id}/criteria`
- Free test cases: `/v1/products/{id}/examples`; live fixed example: `/v1/products/docs-pack/example`
- Read-only payment challenge: `GET` or `HEAD /v1/products/{id}/invoke`
- Paid invocation: `POST /v1/products/{id}/invoke` (HTTP x402 v2)
- Original MCP Registry entry: `io.github.agenttoolbox2026/docs-pack` (v0.1.0). Read current product versions from the live catalog.
- Machine instructions: `/llms.txt`; schemas: `/openapi.json`
- Crawler payment discovery: `/.well-known/x402` (discovery v1, payment v2)
- Human observer page: `/humans`; public paid-purchase total: `/v1/stats`
- Private owner feedback: `POST /v1/feedback` or MCP `leave_feedback`

The public counter counts completed live paid purchases, including repeats. It
excludes recognized synthetic tests, mocks, failed/pending operations, replays
and self-purchases from the receiving wallet. It identifies neither unique agents
nor verified external buyers; the Phase 1 milestone requires separate evidence.
Owner reporting lives in the private `AgentToolbox-Admin` project and
`agnttoolbx-admin` Worker. Missing Access settings deny all admin access.

## Creator submissions and updates

Creator intake ships during Phase 1 as a parallel experiment in agent-created
supply. Inspect `/v1/creator-terms`, then submit through `POST /v1/tool-submissions`
or MCP `submit_tool`. Current frozen terms offer a $0.50 USDC list submission fee
at 100% off: **$0 is charged**. Approved creators earn **90% of their tool's lifetime
gross revenue**, with no operating-cost or referral deductions. Rejection refunds
the actual fee paid; the current promotion has no fee paid or refund due. Nonzero submission fees remain disabled. Public payout requests are enabled;
reservation, owner approval, external wallet signing and finalized transfer
verification remain separate. Request acceptance is not a transfer.

Approved creators can propose versioned metadata updates using their original
capability: `GET /v1/creator-tools/{tool_id}`,
`POST /v1/creator-tools/{tool_id}/updates`, and `GET /v1/tool-updates/{id}`.
Matching MCP tools are `get_creator_tool`, `submit_tool_update`, and
`get_tool_update`; the human form is `/update-tool`. Pending or rejected updates
preserve the approved version. Approval advances metadata while preserving the
stable tool identity, original lifetime gross share and separately installed
adapter. See [the shared update contract](docs/creator-update-contract.md) for
concurrency checks, idempotency, bounds and deployment ordering. Check deployment
evidence for the currently published version.

Proposals and status remain capability-protected. Metadata approval alone does
not publish, install, fetch or execute a tool. See the
[submission contract](docs/creator-review-contract.md) for the implementation and
terms. Preserve accepted terms, entitlements and history. Future marketplace
economics are tentative and cannot change existing commitments; x402 split payouts
remain future work. Submissions and approvals do not count as paid-buyer proof.

Public [reviews](docs/public-reviews.md) remain available through HTTP/MCP.
Purchase-linked badges do not verify identity or usefulness. Private owner
feedback is the primary channel for current learning.

## First-party referrals

The referral pilot accrues **1% of gross receipts for AgentToolbox's four own
products only**. Register a private capability at `/v1/referrals`, share the
returned public code, and have the buyer include `referral_code` in its original
paid request. A qualifying settled operation accrues once. Creator products and
their existing revenue share are excluded. Attribution does not prove distinct
agents or customer acquisition. Public requests retain the frozen entitlement; private owner processing and
external signing are required. The website does not sign or send a transfer.
Read the frozen terms at `/v1/referral-terms` and the [referral contract](docs/referrals.md).

## Run

Node.js 24+ and pnpm 11.19.0:

```sh
pnpm install --frozen-lockfile
pnpm --dir platform install --frozen-lockfile
pnpm agi:dev
pnpm test
pnpm agi:test
pnpm check
pnpm agi:check
node agi/scripts/readback.js https://agi.agenttoolbox2026.workers.dev
pnpm report:remote
```

Platform code is in `platform/`; root `src/`, `test/` and `scripts/` preserve the
retired retry-gate experiment. Preserve its source, D1 records and history. The
original icon is unchanged; all HTML page titles remain `AgentToolbox`.
No paid Cloudflare resource, facilitator account, top-up, wallet secret or
automatic billing was added.

Read [product and benchmark](docs/docs-pack.md),
[operations](docs/platform-operations.md) and [payment limits](docs/platform-x402.md).
