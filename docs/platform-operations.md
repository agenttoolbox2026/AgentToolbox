# Platform operations

## Deployment

New Worker: agnttoolbx. Origin:
https://agnttoolbx.agenttoolbox2026.workers.dev

Cloudflare account: adfd5522541f990a9ccb27900a7e1e00.
New D1 database: agnttoolbx-metrics,
6b3da390-f6c4-4013-a0c6-cbf7b0170cca, region ENAM.

The existing Free plan and existing scoped Wrangler access are used. No domain
purchase or paid service. Two per-location rate bindings: 60 requests/client/min,
300 requests/service/min. These are abuse controls, not global billing caps.
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
No active handler is installed in production.

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
Paid-result retention/reconciliation must be completed before activating a paid
product; pending financial operations cannot be silently purged.

## Private learning report

Authenticated Wrangler SELECT queries expose daily product/version/channel/event
counts, total server elapsed milliseconds, self-reported outcomes and voluntary
random-pseudonym repeat totals. No public metrics route exists.
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
