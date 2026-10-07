# Creator submissions: shared contract v1

Proposed additive migration: `0007_creator_submissions.sql`. This is the public/private coordination contract; production application requires the owner's deployment review. Private review stays in AgentToolbox-Admin with its existing owner authentication, same-origin JSON, session-bound CSRF, no-store responses and no public reviewer endpoint.

All proposal text and schemas are untrusted private data. Submission URLs are never fetched. Approval accepts metadata only: it does not publish a product, install an adapter, execute a URL or authorize a transfer.

## Frozen terms

`terms_version = creator-promo-2026-10-07.v1`, `list_fee_atomic = "500000"`, `discount_bps = 10000`, `charged_fee_atomic = "0"`, `paid_fee_atomic = "0"` (known because this version cannot charge), `share_bps = 9000`, `revenue_basis = gross`, asset Base USDC with six decimals. No operating costs or referral commissions reduce the creator's 90%. Rejection refunds the actual paid fee; this promotion has no fee charged and no refund due. Nonzero charges, refunds and payouts are disabled.

## Tables and owner decision write

- `platform_creators`: `creator_id TEXT PK`, `capability_hash TEXT UNIQUE`, `created_at TEXT`. Client-generated 32-byte `atbc_` capability, hash-only storage. Capability control is not wallet or real identity verification; no recovery grant.
- `platform_tool_submissions`: `submission_id TEXT PK`, `creator_id TEXT FK`, `tool_id TEXT UNIQUE` (stable across eventual installed versions), `request_key_hash TEXT`, `request_hash TEXT`, `proposal_json TEXT`, `terms_json TEXT`, all frozen terms above, `state TEXT pending|approved|rejected`, `revision INTEGER` initially 0, `refund_due_atomic TEXT NULL` until rejected, `created_at TEXT`, `client_hash TEXT` (private abuse budget only). Unique `(creator_id, request_key_hash)`. Proposal, identity and terms cannot change.
- `platform_submission_decisions`: `decision_id TEXT PK`, `submission_id TEXT UNIQUE FK`, `reviewer_subject TEXT`, `request_key_hash TEXT`, `request_hash TEXT`, `expected_revision INTEGER`, `resulting_revision INTEGER`, `decision TEXT approved|rejected`, `reason TEXT`, `created_at TEXT`. Unique `(reviewer_subject, request_key_hash)`. Append-only. An INSERT trigger enforces pending + expected revision, atomically updates state/revision, creates the entitlement for approval or the refund obligation for rejection. Private API checks prior reviewer/key + matching request hash for idempotent replay, then inserts exactly these fields. Failed CAS rolls back the entire insert.
- `platform_creator_entitlements`: `tool_id TEXT PK`, `creator_id TEXT FK`, `submission_id TEXT UNIQUE FK`, `share_bps INTEGER 9000`, `revenue_basis TEXT gross`, `approved_at TEXT`, `installed_adapter TEXT NULL`. Identity/share/basis immutable. NULL adapter means not executable/published. Adapter installation needs separate code review; this task exposes no installation write.
- `platform_submission_refund_obligations`: `submission_id TEXT PK FK`, `paid_fee_atomic TEXT`, `refund_due_atomic TEXT`, `status TEXT no_fee_paid|transfer_required`, `created_at TEXT`. Append-only; no transfer processor. Rejection during the current promotion creates the exact known zero obligation and `no_fee_paid`.

Owner write: INSERT the decision row with `resulting_revision = expected_revision + 1`; trigger handles all dependent facts. Both hashes are 64-character SHA-256 hex; reviewer subject is 1–256 characters and reason at most 1000 characters. Do not independently update submissions or insert entitlements/refunds. A rejected submission cannot be approved later through this v1 contract. Reasons are returned to the capability holder; keep internal owner details out of reasons.

## Authoritative financial facts

New payment fields `creator_tool_id TEXT NULL`, `creator_id TEXT NULL`, `creator_share_bps INTEGER NULL` freeze a server-derived beneficiary at original payment admission. All must be NULL or match an approved entitlement with a separately installed adapter matching the server handler. Client fields, IDs and wallet strings cannot select the beneficiary.

`platform_live_receipts`: `operation_id TEXT PK FK`, `product_id`, `version`, `network`, `asset`, `gross_atomic TEXT`, `transaction_hash`, `settled_at`, frozen nullable creator fields. An append-only trigger captures future payments only after `state=settled`, `is_live=1`, a durable server `outcome_validated` ledger event and a matching durable settlement ledger receipt. The payment `outcome` field is caller-reported and is NOT accounting authority. `is_live` comes from trusted server configuration. Buyer-controlled `sample_kind` is deliberately ignored; the public `platform_paid_purchases` counter is not financial authority. These remain facilitator-confirmed receipts, not independent on-chain reconciliation. No historical backfill without evidence.

`platform_creator_allocations`: `operation_id TEXT PK FK`, `tool_id`, `creator_id`, `share_bps INTEGER 9000`, `gross_atomic TEXT`, `created_at`. Append-only receipt-trigger allocation; unique operation prevents replay accrual. Include the entire buyer-chosen amount. Compute per stable entitlement with BigInt: numerator = sum(gross_atomic) * 9; payable atoms = numerator / 10; fractional numerator = numerator % 10, denominator 10. Two 10001-atom receipts yield 18001 payable atoms and 8/10 atom retained carry. Allocation is an accrued entitlement, never a paid transfer. No customer-refund clawbacks or cost deductions exist in this version.

Receipt/allocation insertion guards validate the underlying durable facts. A creator-bound live payment cannot finish its settled-state transition without its receipt/allocation; a persistence problem keeps it unresolved for reconciliation and never causes another settlement attempt. Changes to an installed adapter after payment admission do not change the frozen beneficiary.

Money fields are canonical decimal strings. Never use SQLite SUM/CAST or JS Number for money. Missing/unreconciled money facts are unavailable (NULL), not inferred zero. Zero is valid only for the frozen free promotion or a known empty complete allocation result.

## Public API boundary

`GET /v1/creator-terms` returns frozen public terms and limits. `POST /v1/tool-submissions` and MCP `submit_tool` accept a private proposal, `request_id`, `creator_secret_hash`, and exact `terms_version`, with `X-Creator-Capability` for HTTP or a separate MCP capability argument. The raw capability is consumed transiently and never stored/logged. `GET /v1/tool-submissions/{id}` and MCP `get_tool_submission` require the matching capability and return the private status/decision; wrong secret and unknown ID have the same 403. No public list, approval endpoint, payout endpoint, or wallet verification claim.

Limits: 16 KiB request body; at most 4 proposals/client/day and 40/day globally; shared write rate limit; 120-character name, 1000-character summary, bounded HTTPS URL and 4000-byte input/output schema each. No outbound request in this workflow. Public analytics/reviews never include proposals, capabilities or creator receipts.
