# Verification — 2026-10-05, America/Toronto

## Completed checks

- 12 Node test groups pass. Coverage includes supported/unsupported decision
  tables, unsafe writes, count/wait/value caps, Retry-After date/clock skew,
  strict schemas, body limits, host/Origin/CORS handling and rate-limit failure.
- Parallel identical recovery, acceptance and result calls create one record per
  transition. Conflicting inputs fail. Expiry, decline, missing evidence, wrong
  evidence type and task failure never qualify as success. All amounts remain zero.
- SQLite trigger tests reject ledger UPDATE/DELETE and non-dev events. A forced
  ledger error rolls back acceptance, proving atomic state/event insertion.
- Retention purges learning records and preserves separate payment events. Tests
  check that raw labels, upstream keys, agent pseudonyms and free text do not occur
  in stored records.
- Official MCP SDK 1.32.1 client negotiates with the stateless endpoint, discovers
  all five tools and completes the no-charge flow over a real localhost HTTP server.
- Wrangler 4.147.0 successfully bundles the Worker in `deploy --dry-run`; no upload.
  Local D1 migration succeeds. The same plain-HTTP smoke client against local
  workerd/D1 verifies concurrent quote/result idempotency, accept, feedback and
  receipt. MCP SDK discovers tools and verifies an unsafe-write stop there too.
  Direct local D1 read confirms exactly three events for the completed recovery
  and total settled amount zero.
- BUILD.md blob remains `99f3562316c111d698158be6429b245518a6702a`, unchanged.
- Public x402 `/supported` GET returns 200 and advertises v2 exact/Base Sepolia.
  This is capability discovery, not a payment test.

## Observed learning

The measured local fixture trial is in `trial-results.json` (UTC timestamps; run
occurred October 5 Toronto time). Four matched tasks per method: a rate-limited
read, temporary 503, unsafe write timeout, and a repeat rate-limited read. Both
the informed baseline and gate made the correct decision in all four. Three gate
retries completed and one unsafe retry was stopped; no funds moved.

Gate recommendation round trips for supported tasks measured 5.95–10.77 ms on
this machine. Total helper elapsed time exceeded the informed baseline by roughly
15–28 ms for safe tasks. These few controlled samples are not performance promises.
There was no observed incremental task success, savings or business validation.

The participating caller was scripted and guided by the building Codex agent.
This was not a fresh independent agent discovering the service from MCP description
alone. That acceptance criterion remains unverified. Repeated pseudonymous calls
verify tracking only; no customer return behavior or organic discovery is claimed.

## Unverified and blocked

Cloudflare remote access, current inventory, workers.dev subdomain, entitlements,
bot controls and MFA; public reachability; real serving cost and founder/support
effort; receiver control and network compatibility; facilitator credentials;
authorization/expiry/settlement and crash reconciliation; any testnet or mainnet
transaction; independent outcome evidence; willingness to pay and repeat paid use.

Next account action is to restore the existing Cloudflare API connection or run
`wrangler login`. Recheck the setup before creating the one Worker/one D1 proposal.
Payment work also needs founder confirmation of the self-report trust boundary,
network/receiver and an explicit permitted amount. Do not infer those approvals.
Public and payment gaps are intentionally left visible; no deployment, paid
resource, wallet creation, fund transfer or invitations occurred.
