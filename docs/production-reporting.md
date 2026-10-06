# Reporting the dev MVP

`pnpm stats` reports the local SQLite database only. It never queries Cloudflare.
Remote reports must use the deployed D1 database, with existing authenticated
access and a verified database ID in Wrangler config:

```sh
pnpm exec wrangler d1 execute agenttoolbox-retry-gate-dev --remote --file scripts/report-d1.sql --json
```

The file contains SELECT statements only. It returns aggregates without recovery
handles, caller hashes or evidence hashes. To validate against local workerd/D1,
replace `--remote` with `--local`. Querying D1 uses plan quotas; verify the account
is on Free before relying on its hard limits to prevent overage spending.

Migration `0002_usage_totals.sql` adds one daily counter row per UTC event date.
Quote, stop, acceptance, decline, result, eligible self-report and feedback counts
are updated in the same database transaction as each new record. Idempotent
replays do not increment them. These non-identifying counters survive deletion
of the underlying 24-hour learning records. `usage_coverage.started_at` records
when coverage began; old records are deliberately not backfilled. The first day
may be partial. Counts are by event day, so a result can be on a later day than
its quote. Reports do not count rejected requests or discovery page views.

The separate append-only dev ledger also survives expiry and reports event counts
and settled atomic amounts. The schema enforces `mode=dev` and zero settlement.
An eligible result is caller self-report; it is neither independently verified
success nor revenue. Verified mainnet revenue must remain zero until a separate
payment implementation and controlled on-chain verification exist.

Recommendation/reason/discovery breakdowns and pseudonymous repeats still cover
only unexpired learning records. Daily counters establish volume trends, not
unique customers or weekly caller retention. No additional caller identifiers
are retained. Reported savings and helpfulness are self-reports. Decision latency
measures validation, hashing and deterministic preparation, excluding database
and receipt work. End-to-end latency needs a timed HTTP measurement. Actual
cost-to-serve remains unmeasured; obtain Worker and D1 usage from account metrics.

Daily counters and dev ledger events remain until an explicit database reset.
There is no public reporting endpoint or dashboard, and no scheduled report yet.
