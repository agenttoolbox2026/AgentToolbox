# AgentToolbox — vision and current build brief

Updated October 7, 2026 from Douglas's vision briefing and subsequent instruction
to ship creator submissions and reviewed updates during Phase 1. This is the
active brief; older launch instructions and retired retry-gate plans are historical
context. Explicit later user instructions take precedence.

## Vision

AgentToolbox helps agents find solutions to common problems and have a better
experience in the digital world. The destination is a public marketplace where
any agent can offer a tool, any agent can buy one, and every transaction is
pay-per-outcome: no qualifying outcome, no charge. Agents sharing tools and
resources should make useful exchanges possible that could not happen before.

## Phase 1: learn from real agent buyers

Four experimental tools are live with a default direct-call price of $0.01 USDC
on Base using x402 v2: Docs Pack, QuoteProof, ContractCases and MCP WireCheck.
Their published outcome checks determine whether settlement may begin. Passing
those checks does not independently prove usefulness, truth or customer demand.
Above-minimum quotes remain optional compatibility; a direct minimum-price call
does not need a quote. Limited previews are optional where supported.

The immediate milestone is **one verified paid purchase by an external agent**.
Phase 1 is evidence gathering, not a revenue target. Learn what agents value,
how they discover tools, what makes them trust a paid API, where payment friction
occurs, and why they return and pay again. Use the practical
[Phase 1 learning protocol](docs/phase1-learning.md).

Alongside the authorized creator supply experiment below, prioritize documented
buyer blockers over speculative tools, integrations or social features. Keep the
agent home concise: promised
outcome, success criterion, price, free example or optional preview, and the
shortest invocation path. Preserve one human observer page and the original icon.
Assist discovery research and prepare useful materials; sending messages or
publishing outreach still requires the user's authorization. Acquisition is not
an excuse to leave observed onboarding problems unresolved.
Douglas has authorized coordination with the active Codex agents on this work;
share implementation contracts and avoid conflicting edits.

Do not invent demand, revenue, unique-agent counts, benchmarks, savings or live
payment readiness. Synthetic tests, free examples and unsigned 402 responses
establish technical behavior, not willingness to pay. Preserve retired tools'
identifiers and history without promoting them as active products.

## Verify the first paid-buyer milestone

Keep a small private evidence record for the first qualifying purchase:

- A retained operation and receipt identify the product/version, validated
  outcome and completed live payment. Independently confirm the corresponding
  Base USDC transaction and received amount; distinguish that check from a
  facilitator's report.
- Evidence establishes an external agent made the purchase for an actual task.
  Record how that was established and any founder assistance. A different payer
  wallet or a public counter increase alone does not establish this.
- Exclude founder/self-purchases, controlled tests, mocks, free calls, replays,
  failed and unresolved payments. Keep uncertainty explicit when evidence is
  missing; do not infer external demand from unclassified traffic.

Record discovery, authorization friction and value feedback when available, with
unknowns intact. These observations guide the next experiment; they are not
invented prerequisites or claimed findings. One qualifying purchase satisfies
the first milestone. It does not establish retention, pricing or marketplace
readiness, and it must not automatically launch Phase 2.

## Phase 1: ship creator submissions and reviewed updates

Douglas explicitly requests shipping submissions now as a parallel supply
experiment: agents building tools may attract buyers and reduce the need for
AgentToolbox to build every tool. Do not defer creator intake until the first
paid-buyer milestone. Measure submission interest and approved supply separately
from buyer demand, useful purchases and revenue.

Current frozen terms advertise a $0.50 USDC list submission fee with a 100%
promotion: the actual charge is $0. Approved creators earn 90% of their tool's
lifetime gross revenue, without operating-cost or referral deductions. Rejection
refunds the actual fee paid; under this promotion no fee is paid and no refund is
due. No nonzero fee, refund or payout transfers are enabled. Preserve accepted
terms, entitlements, decisions and ledger history; future pricing cannot rewrite
those commitments.

Approved external creators must be able to propose updates to their existing
tool using the same private creator capability and stable tool identity. Updates
require review; retain the last approved version until an update is accepted.
Keep submission and update status private to the capability holder. Approval
of metadata does not automatically publish or execute arbitrary code or URLs;
publication and execution require the reviewed implementation path. Build and
verify this update flow, and report deployment status without assuming it is
already live. Keep existing status access and financial history intact.

## Phase 2: marketplace after paid-agent proof

The currently authorized referral experiment applies only to AgentToolbox's own
four products. Its initial rate is 1% of gross receipts, frozen on each original
referred paid request. Accrual is exact and receipt-backed; it is not a transfer
or proof of distinct-agent acquisition. No payout processor exists yet. Never
deduct it from creator entitlements or apply it to external submissions.
See [the referral contract](docs/referrals.md).

The intended model is agent buyers and agent-created tools, with AgentToolbox
approving listings. The approval gate is the proposed moat; today's versioned
outcome verification is its prototype. Verification of the agreed outcome is the
planned dispute-resolution mechanism. Define and test it before making broader
guarantees about arbitrary tools.

The proposed business model is a small flat submission fee plus a percentage of
each sale. Future marketplace terms, including approximately 10%, remain subject
to Phase 1 evidence. The current frozen creator promotion and approved 90%
lifetime gross entitlements above remain binding to their accepted records;
tentative future economics do not replace them. Payouts via x402 splits are
future work and are not implemented transfers. Existing internal accrual records
do not prove a creator was paid. Disclose current terms accurately without
claiming enabled nonzero charging or payout availability.

## Financial and operational safeguards

For each paid tool: disclose a fixed success criterion and cap; verify payment
authorization; execute and validate the terminal result; durably store the result
and settlement intent; settle only then; release the result only after confirmed
settlement and durable ledger recording. Failed outcomes must not trigger
settlement. An ambiguous timeout blocks fresh charges until reconciliation.
Never promise refunds without implementing them.

Repository maintenance does not authorize wallet signing, cryptocurrency sends,
private-key handling or live settlement tests. A buyer or user controls live-money
authorization; prepare and inspect supporting evidence without handling secrets.
The owner-confirmed Base native USDC receiver is
`0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D`; it is public configuration.

Use the existing Cloudflare Free resources and available free facilitator
allowance; stop at exhaustion. No domain purchase, paid add-on, top-up, new
account, API token, OAuth grant or spending is implied. Keep the public Worker
`agnttoolbx` and private `agnttoolbx-admin` reporting boundary. Missing owner
Access configuration must deny admin access. Existing approved authentication is
Cloudflare Zero Trust Free, exact-email One-time PIN for
`agenttoolbox@gmail.com`; new payment details or agreements remain user-controlled.

Preserve append-only financial records separately from expiring outputs. Keep
reporting private and distinguish facilitator-confirmed purchases from
independently reconciled revenue. Raw traffic, paying wallets, repeat pseudonyms
and purchase counts do not identify unique agents. Do not backfill unknown usage
or expose private feedback, proposals, capabilities or operational records.

## Validation and handoff

Run checks appropriate to the change, including relevant tests, syntax checks,
Worker builds and runtime checks. Changes to discovery or payment must preserve
plain HTTP/MCP compatibility, deterministic charge criteria, idempotent replay
and unresolved-payment handling. Check changed public flows on desktop/mobile
and without JavaScript as applicable. Report what changed, evidence, remaining
uncertainty and deployment status. Preserve concurrent work and historical
experiment results; move toward the next observed buyer problem.
