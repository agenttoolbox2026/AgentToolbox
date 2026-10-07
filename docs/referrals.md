# First-party referral pilot

Policy `first-party-referrals-2026-10-07.v1` accrues **1% of gross** for paid invocations carrying a registered public referral code. AgentToolbox retains 99%. Exactly four first-party products qualify: `docs-pack`, `quote-proof`, `contract-cases`, `mcp-wirecheck`. Creator tools never qualify, even if their metadata reuses an eligible identifier. Existing creator 90% gross terms are untouched.

This is an accrual pilot. There is no payout, claim, wallet-linking or transfer processor, and no promised payment date. No wallet secret or address is requested. Capability possession proves control of the referral account only; it does not verify an agent, wallet owner, or a distinct buyer. Self-referrals cannot be reliably detected. Do not present attributed purchases as verified new agents.

## Agent flow

1. Generate 32 random bytes, encode canonical base64url, prefix `atbf_`, and retain this capability privately before registration.
2. `POST /v1/referrals` with `X-Referral-Capability` and JSON `{ "terms_version": "first-party-referrals-2026-10-07.v1" }`. Identical-capability retries return the same account, including after a lost response. Store the returned public `ref_…` code; share that code alongside a tool's invocation instructions. The code is not a credential.
3. The buyer adds `"referral_code": "ref_…"` to the original paid invocation body. Preserve the body, payment authorization and idempotency key for retries. Attribution does not change the buyer price. Quotes and free examples create no commission.
4. `GET /v1/referrals/me` with the private capability reads exact accrued atomic units and fractional carry. Never put the capability in a URL, public message, tool input, payment body or logs. There is no recovery grant.

Registration accepts only the stated terms field. Daily admission permits 4 new accounts per private client hash and 40 globally, in addition to the shared write limiter. Existing-account retries remain readable after exhaustion. The account endpoints use HTTP, enforce the existing 16 KiB body bound, keep capability headers out of logs, and return private status with `Cache-Control: no-store`. No public account or receipt list exists.

## Payment integration

`referralCodeSchema` is an optional field in the strict invoke schema. Existing canonical whole-body hashing binds the chosen code to the operation; changing it with the same key conflicts. After the frozen replay check and before new payment admission, call `referralBeneficiary({db, code: body.referral_code, product, handler, creator: beneficiary})`. Absent codes return three null fields without a DB read. Invalid/unregistered codes or ineligible products reject before execution or settlement. Eligibility requires the fixed allowlist, server-owned `provider.id=agenttoolbox` and `provider.type=first_party`, no creator adapter/beneficiary and no creator entitlement.

Insert the returned `referral_code`, `referral_terms_version`, `referral_share_bps` in the same payment INSERT. These fields and the referred monetary/product contract are immutable. An existing payment replay must never re-resolve its code or apply a changed policy. A later product version can use the same referral account; original receipts and request contracts remain frozen.

Migration `0010_referrals.sql` captures allocations from the existing append-only `platform_live_receipts`, guarded by matching frozen payment attribution. Allocation `operation_id` is the primary key. The receipt capture trigger retains its creator invariant and additionally requires a referral receipt/allocation in the same settled-state transition. Allocation failure rolls the transition back; the original operation needs reconciliation, never another settlement request. No historical backfill occurs.

Authority is a trusted live configuration, durable server outcome validation, and matching facilitator-confirmed settlement evidence. Buyer-controlled `sample_kind`, public purchase counters and reported usefulness never create, remove or discount financial obligations. Failed outcomes request no settlement. Unknown settlement may already have charged; it accrues nothing until evidence is reconciled, and retry never requests another charge. Facilitator confirmation is not independent on-chain reconciliation.

Sum each account's gross atomic strings with BigInt: numerator = sum(gross × 100); accrued whole atoms = numerator / 10000; carry = numerator % 10000. Carry is lifetime across the eligible products/versions for the same network, asset and policy. Do not round per purchase or use SQL numeric SUM for monetary totals. `paid_atomic` and `unpaid_atomic` remain null because no transfer ledger exists; accrual is not a payout.

## Release

Apply this additive migration after the creator updates and contract-pin migrations, before deploying referral-dependent worker code. Keep previous workers compatible: new payment fields are nullable, original receipt columns and creator allocation behavior are unchanged. Run the referral SQL/unit suite and payment integration tests for replay, unknown settlement, synthetic-marked real receipts, creator exclusion and allocation failure. Production testing must not manufacture paid purchases or claim real external-agent proof.
