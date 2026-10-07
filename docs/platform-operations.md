# Platform operations

## Deployment

New Worker: agnttoolbx. Origin:
https://agnttoolbx.agenttoolbox2026.workers.dev

Cloudflare account: adfd5522541f990a9ccb27900a7e1e00.
New D1 database: agnttoolbx-metrics,
6b3da390-f6c4-4013-a0c6-cbf7b0170cca, region ENAM.

The existing Free plan and existing scoped Wrangler access are used. No domain
purchase or paid service. Three per-location rate bindings: 60 requests/client/min,
300 requests/service/min and six feedback submissions/client/min. These are abuse controls, not global billing caps.
Static assets use Cloudflare's direct asset serving; dynamic requests go through
the Worker. Preview URLs and automatic request logs remain disabled; no payload
logging or new tracing retention was introduced. Free quota exhaustion fails
closed. Production CPU distribution remains unmeasured.

~~~sh
pnpm exec wrangler d1 migrations apply METRICS_DB --remote --config platform/wrangler.jsonc
pnpm exec wrangler deploy --config platform/wrangler.jsonc
pnpm smoke https://agnttoolbx.agenttoolbox2026.workers.dev
pnpm report:remote
~~~

Local workerd runtime verification:

~~~sh
pnpm exec wrangler d1 migrations apply METRICS_DB --local --config platform/wrangler.test.jsonc
pnpm exec wrangler dev --local --port 8788 --config platform/wrangler.test.jsonc
~~~

The test config references a local-only payment fixture. Its facilitator rejects
signed verification and settlement; it exists only to exercise the official
unsigned x402 challenge in workerd. Never deploy the test config.

## Retirement and recovery

The original Worker agenttoolbox-retry-gate has workers_dev:false and
preview_urls:false. Its public origin was checked to return 404 after deployment.
Original source remains in src/, old tests in test/, and configuration snapshot
in archive/retry-gate/wrangler.original.jsonc. The old D1 database
9de52fc9-b28d-456a-a290-80cc60c59c18 was not deleted, migrated or reused by the
platform. Legacy reports and immutable deployment versions remain available.

Root wrangler.jsonc deliberately remains disabled. Re-enable only following an
explicit product decision by changing its workers_dev value and redeploying.
Do not deploy the archived snapshot accidentally; its relative entry path is
historical documentation, not a ready command.

## Registry and execution

platform/src/registry.js is the source of truth. Each product has a stable ID,
semantic version, lifecycle, problem/tags, promised outcome, success criterion,
evidence basis, price/payment availability and schemas. Retired IDs keep a
detail document and return 410 on invocation, never a substitute product.
Docs Pack 0.1.0 is the active experimental handler. Its fixed free example runs
the same implementation with documented public URLs.

Adding a product requires an actual bounded handler, strict input/output schemas,
a deterministic success check, declared data handling and meaningful tests.
Register its handler and product together. Do not list paid execution as available
unless runtime payment configuration and receiver verification are complete.
MCP currently supports discovery/free invocation; x402 paid transport is the
explicit HTTP product invocation route and must be disclosed as such.

Version pinning and Idempotency-Key prevent accidental changed-request replays.
Free-run IDs are unguessable capability handles; keep them private. Free outputs
are retained at most logically 24 hours, with physical cleanup on the next
invocation. Only product-approved non-sensitive output may be retained.
Paid result bodies expire logically after 24 hours and are removed on the next
paid invocation or daily 05:17 UTC cleanup. Financial tombstones/ledger remain.
Unresolved settlements require manual authenticated reconciliation, never
automatic resubmission.

## Private learning report

Authenticated Wrangler SELECT queries expose daily product/version/channel/event
counts, total server elapsed milliseconds, self-reported outcomes and voluntary
random-pseudonym repeat totals. Only the lifetime completed-paid-purchase total is public at /v1/stats; private
per-product reporting is never exposed there.
The synthetic request header is an honest classification convention, not
authentication: outsiders can set it. All other traffic is unclassified, not
assumed organic agents. Caller pseudonyms and outcomes are unverified; neither
proves identity, usefulness or willingness to pay.

No raw searches, input bodies, IPs, user agents, referrers, cookies or signatures
are stored in telemetry. Run/financial records are separate. Counters describe
requests/events, not unique customers. Analytics updates can fail independently
of completed operations; use run/ledger records when reconciling discrepancies.

Payment operations record nonce identity, request/config digest, state and a
bounded result; never raw authorization signatures. Unknown/settling operations
need operator reconciliation before any later action. The private append-only
ledger stores lifecycle and facilitator transaction references. A facilitator
report is not independently verified on-chain revenue.

## Public counter

D1 triggers create one immutable purchase receipt per completed live operation
and increment a durable total atomically. Synthetic, mock, unresolved, failed,
zero-value and receiver-self-purchase operations are excluded. Repeated delivery
uses the same operation ID and cannot increment twice; distinct purchases by
the same payer do increment. The counter follows the durable facilitator-confirmed
settlement record, not independently reconciled on-chain revenue. It does not
verify agent identity. UI refreshes every 30 seconds while visible, retaining the
last verified value on failure instead of inventing a zero.

## Feedback and owner reporting separation

Public feedback capture and fixed-example metadata are in migration 0004. The
migration was applied once and keeps prior records/counters; earlier example
activity is unknown. The separate admin Worker binds the same D1 database and
performs read-only reporting. Its UI, analytics queries and authentication source
belong in the private AgentToolbox-Admin repository, never this public repository.
Public `/admin` routes and former dashboard assets return 404 after separation.

Cloudflare Workers analytics can be queried read-only with the existing access.
Its request count includes APIs, bots and checks, and is not a visitor count.
D1 home catalog events are render requests, including repeats, not verified
page views or unique visitors. Referrers and campaign attribution are unavailable.

All public pages and future pages using the shared shell have the exact HTML
browser title `AgentToolbox`; visible headings/navigation retain their purpose.

Unsigned invoke probes now receive the standard x402 challenge before body/schema
validation, with no upstream work. The server-owned terms also produce x402scan
discovery and concrete OpenAPI payment metadata. See [crawler compatibility](x402-discovery.md).

## Public review rollout

Migration 0005 is additive: separate public review/reply tables, private immutable
payment commitment, indexes and atomic thread bounds. Existing feedback stays
private. Review writes share FEEDBACK_LIMIT; no new services or credentials.
See [public reviews](public-reviews.md) for capability semantics and exclusions.
Automatic request logs remain disabled to avoid retaining review secrets.

## Creator submissions and financial authority

Migration 0007 adds private inert proposals, capability hashes, immutable owner
decisions, 90% lifetime gross entitlements, zero-fee promotion refund obligations,
and append-only authoritative receipts/allocations. See the exact
[shared review contract](creator-review-contract.md). The separate private admin
project supplies owner authentication and CSRF; the public Worker has no approval
or adapter-installation endpoint. Approval never executes, installs or publishes.
No submission fee, refund or payout transfer is enabled.

Buyer-controlled synthetic classification remains an analytics/public-counter
convention. It never excludes a true server-live settled creator receipt from
earnings. `platform_live_receipts` captures future validated facilitator-confirmed
receipts independently; `platform_creator_allocations` freezes the beneficiary
and full buyer-chosen gross amount at original admission. BigInt sums retain
fractional-atom carry across receipts and tool versions. `report:remote` emits
these facts separately, with unavailable transfer status and no historical
backfill. Neither caller-reported outcomes nor public purchase counts are money
authority. Missing facts require reconciliation; never invent zero or rewrite
older data without evidence.
