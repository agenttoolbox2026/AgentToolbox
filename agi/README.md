# AgentToolbox on AGI

`https://agi.agenttoolbox2026.workers.dev` serves the agent document, Humans page,
buyer/seller workflows, OpenAPI, MCP and public APIs. The Worker executes the
existing platform runtime in process. It never proxies visitor credentials.

HTML and Markdown use the same compact instructions. `src/model.js` builds its
snapshot from the operational registry, success canonicalizer and creator/referral
terms. Rebuild when contracts change. Current criteria and payment requirements
must still be independently checked before authorization.

The agent document has a white branded header and dark syntax-colored Markdown.
`/humans` shares that exact header and system monospace description font. It has
a black background, audience navigation and a **Tools Sold** count
read from the existing public purchase total. Repeats count; unique agents/tools
are not claimed. Missing data displays Unavailable. Agent documents and Humans
need no JavaScript. Existing operational forms keep their scripts and CSP.
`build.js` copies their exact assets, renaming the stylesheet to avoid a collision.
The Worker strips visitor headers/query/body before calling the asset binding.

## Ledger and migration boundary

Use the existing physical D1 database `6b3da390-f6c4-4013-a0c6-cbf7b0170cca`.
Do not copy or reset it. Keep payment recipient/network/asset byte identities,
rate-limit namespaces 1003/1004/1005, product IDs, migrations, tombstones, receipts,
capabilities, creator rights and histories. Tracking is disabled; operational
and financial provenance remains. There are no public admin or board routes.

For an old-origin operation, change only the HTTP retry destination. Preserve
the original body, idempotency key, capability and full PAYMENT-SIGNATURE,
including the old resource URL embedded inside it. Do not requote or create a
replacement authorization after uncertainty. Unknown settlement requires
reconciliation. The old origin is retired separately only after review of deployed
AGI bindings, local compatibility tests and live read-only discovery.

The final configuration assigns `17 5 * * *` to AGI only. Staging used empty
crons; deployment of this final configuration requires verified old cron removal
and the full 15-minute Cloudflare propagation window. The old default deployment
is now a cron-free, asset-free retirement Worker. Cleanup removes expired
output, not financial tombstones. Both source and Worker version histories must
remain recoverable. No database migrations or destructive data changes are needed.

## Verification

Use pinned dependencies and Node 24:

```sh
npm run agi:build
npm run agi:test
npm test
npm run check
npm run agi:check
npm run agi:dev
```

Local dev uses an in-memory migrated database, local-origin links and a payment
adapter that cannot authorize or settle. It never connects to production D1.
Browser QA uses Codex computer-use tools against that local preview. Verify
390px/1440px layouts, audience navigation, forms and saved retry envelopes.
The integration suite tests cross-origin frozen replay, nonce concurrency,
capabilities, CORS, MCP, workflow assets and scheduled retention with local SQLite.

Only the AGI owner deploys `agi/wrangler.jsonc`, using normal encrypted Wrangler
login. The old public Worker and private operational review API have separate
owners. No new account, grants, credentials, payment transfers or database purge.

```sh
wrangler deploy --config agi/wrangler.jsonc
node agi/scripts/readback.js https://agi.agenttoolbox2026.workers.dev
```

Readback performs GET/HEAD/OPTIONS discovery and read-only MCP tools/list. It
recomputes all four success/payment pins and verifies operational assets and
current terms. No positive live proposal/update/referral/preview, signed purchase,
refund or payout occurs. Tests do not establish external paid demand or prove a
live settlement. Seller approval remains metadata-only; reviewed activation and
payout processing are separate unfinished stages. Private owner review remains
Access-protected after dashboard retirement.
