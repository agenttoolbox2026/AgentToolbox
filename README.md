# AgentToolbox — deterministic retry-gate experiment

**Dev only. Maximum charge: 0 USDC. Nothing deployed; no payments received.**
Read [BUILD.md](BUILD.md) for the founder requirements. This is a product hypothesis,
not a validated service. The first controlled comparison found no advantage over
a caller already using correct retry rules; the helper added latency.

## Run locally

Requires Node.js 24+ and pnpm 11.19.0. No account, API key or wallet needed.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm dev
```

Open `http://127.0.0.1:8787/` (use this exact host). The server binds only to loopback.
Its durable SQLite file is `.data/agenttoolbox.sqlite`. In another terminal:

```sh
pnpm smoke
pnpm stats
# Starts separate local fixtures/server, compares an informed baseline and the gate:
pnpm trial
```

The trial writes `docs/trial-results.json` and its own ignored `.data/trial-*.sqlite`.
These fixtures are integration evidence, not customers or independent agent use.

### API example

```sh
curl http://127.0.0.1:8787/v1/recover \
  -H 'Content-Type: application/json' \
  -H 'Idempotency-Key: 60246bc7-8c8e-488a-9dc8-39a1bc7f538b' \
  --data '{"operation":"catalog.read","failure":{"kind":"http","status":429,"headers":{"retry-after":"1"}},"safety":{"read_only":true},"attempts_so_far":1,"limits":{"max_attempts":2,"max_wait_ms":3000,"max_price_usdc_atomic":0}}'
```

Generate a fresh random idempotency key for a new recovery. Reuse it after a lost
response with the same semantic inputs. Changed inputs return 409; replays are
retained for 24 hours. Free text is discarded and excluded from the fingerprint.

If recoverable, POST `{"accept":true,"max_price_usdc_atomic":0}` to
`/v1/recover/{recovery_id}/accept`. Wait the disclosed delay **after acceptance**,
execute the same operation once, then POST a result to `/v1/recover/{recovery_id}/result`:

```json
{"outcome":"success","retry_attempts":1,"completed":true,"evidence":{"type":"http","final_status":200,"digest_sha256":"<64 lowercase hex characters hashing your local evidence>"}}
```

Never fabricate the outcome. Use failure/unverifiable when appropriate. Evidence
is self-report; its digest is a reference, not independent proof. MCP success uses
`type:"mcp",mcp_is_error:false` and a digest instead of final_status. Generic network
failures currently expect HTTP evidence; MCP adapters should use kind `mcp`.
GET `/v1/recover/{recovery_id}` returns the receipt. POST `/v1/feedback` records
helpfulness without free text. Recovery IDs are unguessable capability handles;
keep them private, since possession permits reading/submitting that recovery.

`/llms.txt` and `/openapi.json` document the contracts. `/` works without JavaScript
and supports HTML, Markdown and JSON via Accept. Connect a Streamable HTTP MCP
client to `http://127.0.0.1:8787/mcp`; the five tool descriptions explain the flow.

## Bounds and storage

- Known transient HTTP statuses/codes only; stop on unknown, business, auth,
  missing-resource and browser failures. No model inference or arbitrary fetches.
- State-changing operations require an idempotency key **and** the caller's
  confirmation that upstream deduplicates the same payload. Merely having a key
  is insufficient. The service cannot independently prove caller assertions.
- One recommended retry; at most five total attempts declared by the caller,
  30 seconds wait, five-minute quote, 8192-byte bodies, strict schemas.
  If Retry-After exceeds the budget, stop instead of retrying early. Callers must
  enforce their cumulative budget across new quotes; this service does not execute.
- 60 requests/client/minute and 300/service/minute locally. Cloudflare bindings
  enforce these per location, not as a strict global billing cap. Fail closed if
  bindings are absent. SQL caps retained recoveries at 10,000 and quotes at 100,000
  ledger events; completing existing recoveries can add events beyond that cap.
- Unique request/result keys, conditional inserts and transactional triggers prevent
  duplicate dev events, including races. Conflicting results return 409. Expired,
  declined and completed receipts explicitly return stop.
- Learning records: allowlisted fields, hashes, status/codes represented by rule
  categories, timestamps, pseudonymous repeat usage, feedback and reported savings.
  No raw operation label, upstream key, error message, auth header, cookie, token,
  task history or evidence body is stored. Do not send secrets even in optional text.
- Learning records expire after 24 hours; receipt access ends then. Physical deletion
  occurs on the next quote or `pnpm stats` run, so an idle database may retain expired
  rows longer. Minimal append-only dev payment events remain until explicit database
  reset; they are separate from learning records. UPDATE/DELETE is rejected by SQL
  triggers; corrections must be new events. Database administrators can change the
  schema, so this is application enforcement, not tamper-proof storage.
- Non-identifying UTC daily usage counters survive expiry, starting when migration
  0002 is applied, without historical backfill. They measure event volume, not
  unique customers or caller retention. See [remote reporting](docs/production-reporting.md)
  for read-only D1 aggregate queries; `pnpm stats` remains local only.
- Amounts are integer USDC atomic units. Dev schema/code enforces zero charges and
  prevents live revenue records. Costs remain unmeasured; latency is only a proxy.
  Optional reported savings and operator effort are not independent observations.

## Cloudflare status and local verification

GitHub access and main were verified. Cloudflare's connected API is not exposed in
this session; Wrangler `whoami` was unauthenticated. The brief's Worker/D1 inventory,
subdomain and MFA status could not be reverified. No resources or temporary account
were created. Restore that connection or run `wrangler login` before account checks.

To test the actual Worker/D1 runtime locally (stop `pnpm dev` first):

```sh
pnpm exec wrangler d1 migrations apply agenttoolbox-retry-gate-dev --local
pnpm worker:dev
# Another terminal:
pnpm smoke
pnpm worker:check
```

`worker:check` is a dry run. The checked-in D1 ID is a local placeholder,
workers.dev and previews are disabled, and PUBLIC_ORIGIN is localhost. This
configuration is deliberately not deployment-ready. No remote database commands
or deployment scripts are included. In restricted environments, point
`XDG_CONFIG_HOME` and `WRANGLER_LOG_PATH` at writable local scratch paths.

Proposed later resources: one `agenttoolbox-retry-gate` Worker, one
`agenttoolbox-retry-gate-dev` D1 database and two rate-limit bindings. After access
verification, recheck inventory/subdomain, free-plan entitlements and bot controls,
describe any actual charge exposure, then configure a verified database ID and
public origin. No paid add-ons, R2, Pages, Durable Objects, queues or dashboards.
Do not enable paid resources without founder approval.

## Payments and learning evidence

[x402 findings](docs/x402-findings.md) explain why authorization and settlement can
be separated technically, while independently proving an externally executed retry
remains impossible from self-report alone. No auto-settling middleware is used.
Dev mode is the only payment provider; other modes fail closed. The proposed public
receiving address appears only in configuration and the unchanged build brief.
Never provide a private key. Testnet/mainnet require separate implementation and
verification; a documented protocol is not a working integration.

See the [protocol](docs/experiments.md), [measured trial](docs/trial-results.json),
[setup/plan](docs/implementation-plan.md) and [platform findings](docs/platform-findings.md).
The SDK client discovered all five tools, safe retries completed, and the unsafe
write stopped. The baseline did equally well, so additional value, independent
agent discovery, willingness to pay and repeat paid use remain unproven.
