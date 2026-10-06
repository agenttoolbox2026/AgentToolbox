# Feedback and owner reporting

## Feedback

Agents submit `POST /v1/feedback` with JSON and a stable 32–128 character
`Idempotency-Key`, or call MCP `leave_feedback` with `idempotency_key`:

```json
{"product_id":"docs-pack","version":"0.1.0","helpful":true,"message":"The matching excerpt helped."}
```

Optional fields: rating 1–5, outcome (`success`, `failure`, `unverifiable`), helpful
boolean, task_description (1,000 characters), message (2,000 characters), and
reference `{kind:"example"|"purchase"|"run",id:"private UUID"}`. At least one
feedback field is required. OpenAPI has the strict schema. The home page offers
one collapsed form; HTTP/MCP discovery also describe feedback. No feedback list
is public. Reusing identical body/key returns the original acknowledgment;
conflicting reuse returns 409. Storage, not a client flag, determines linkage.

The fixed free example now returns `example_id`; paid receipts already return
`operation_id`. A matching retained execution record produces
`server_record_linked`; missing/mismatched references remain `unverified`.
Linkage means the record exists and the private ID was supplied, not that the
author's identity, opinion or claimed task outcome is verified. Feedback never
causes work, settlement, reversal or a refund. Synthetic and owner-linked records
inherit their exclusion classification even when callers omit the test header.

Feedback is displayed only as escaped text, never links, HTML or instructions.
JSON requests are bounded at 16 KiB and strict schemas reject payment/secret
fields. Common secret formats are rejected in free text; this is not a universal
sensitive-data detector. Do not submit credentials, signatures, personal data or
sensitive task details. No IP, user agent, referrer or third-party analytics is
stored. Feedback rate limiting is six submissions per client IP per minute per
Cloudflare location, in addition to existing client/service limits. Shared IPs
share limits; these eventually-consistent abuse controls are not accounting.

## Server measurement

Migration `0004_feedback_analytics.sql` only adds tables, indexes and triggers.
It preserves every prior daily/run/payment/ledger/purchase record and counter.
The real migration timestamp is saved in `platform_tracking`. Earlier examples
were untracked: their history is unknown, never a zero-usage or backfill claim.
Recent activity begins with new writes after that timestamp. Old daily aggregates
remain available as recorded and can include unidentified owner/bot activity.

Example insert/result triggers capture attempts and completed/failed outcomes
atomically. HEAD does no execution. Optional idempotency keys ensure repeated
delivery runs and counts once; concurrent replay returns in-progress. Results
expire after 24 hours, while execution metadata remains available for feedback.
The existing cleanup removes expired public-document example output as well as
paid output, preserving payment tombstones. No raw example inputs are added.

Purchase totals and amounts come from durable purchases joined to the payment
state machine, never unsigned client flags. Synthetic operations, mocks and
receiver-self-purchases are excluded. Unresolved/failed states are separate and
are never counted as purchases. Amounts remain **facilitator-confirmed**, with
chain-reconciled amounts explicitly unavailable because no independent chain
reconciliation was performed. Existing payment behavior is unchanged. The
dashboard has no payment, reconciliation-write or other mutation controls.

Funnel columns count events from different requests, not cohort conversion or
unique agents. Paying-wallet pseudonym totals use facilitator-verified receipt
payers, include repeats/shared wallets and never imply unique agent identities.
Raw wallets, signatures and payment digests are not included in dashboard output.
Public lifetime counter versus durable receipt count is checked independently.

## Private dashboard

The dashboard UI, reporting queries and authentication implementation are maintained
in the separate private `AgentToolbox-Admin` project and `agnttoolbx-admin` Worker.
The public Worker returns 404 for `/admin` and its old assets. Both Workers use the
existing D1 database; the admin application only reads and never runs migrations
or payment handlers. Missing owner Access configuration denies every admin page,
data API and static asset. Approved Access setup is Free, exact owner email,
One-time PIN and one-hour sessions, covering the entire separate admin hostname.
The public tools remain open. Owner-positive production verification is pending
that setup; no new Access-management scopes were added.

Earlier deployments served the non-sensitive dashboard JS/CSS assets publicly.
Separating source does not erase those deployed versions; no Git history was
rewritten. Operational data routes always denied access without valid owner JWTs.

## Validation

The public suite has 56 passing tests, including the preserved legacy experiment,
upgrade preservation, real execution identifiers, idempotency, retention, strict
feedback bounds/linkage/rate gates, and shared exact `AgentToolbox` titles.
Five private-project tests cover financial exclusions, acquisition interpretation,
hostile text, JWT verification and route/asset isolation. Earlier combined
local verification is retained as historical evidence; current public production
checks are recorded in `platform/evidence/public-closeout.json`.
No live signature, payment verification, settlement or transfer was performed.
