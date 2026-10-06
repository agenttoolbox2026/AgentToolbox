# Buyer-chosen pricing and limited previews

Every active tool currently has a 10,000 atomic-unit ($0.01 USDC) minimum, six
decimals, and no business maximum. Amounts are canonical decimal strings. The
uint256 maximum is a protocol bound; facilitator capacity at large amounts has
not been verified. Above-minimum choices require a fresh durable quote. Catalog
minimums remain authoritative; high chosen quotes have no Bazaar extension.

## Direct calls

Existing minimum calls may omit `payment_amount_atomic` and `quote_id`. The
signature must authorize exactly the server's current minimum. `max_charge_usdc_atomic`
is a caller ceiling, never an instruction to choose that amount. Safe integer
caps remain accepted for compatibility; use strings for all new integrations.

For a higher amount, POST `/v1/products/{id}/quote`:

```json
{"version":"0.1.0","input":{"...":"tool input"},"payment_amount_atomic":"10001"}
```

The returned `quote_id`, expiry and exact x402 requirements are saved privately.
Invoke with the same input/version/amount plus `quote_id`, a sufficient cap,
`Idempotency-Key` and the exact `PAYMENT-SIGNATURE`. A new price needs a new quote.
Quotes freeze tool/version, normalized input hash, minimum policy, amount,
network, asset, receiver and expiry. Client-echoed accepted fields never define
server terms. New operations reject stale policy/expiry. Recorded operations
use their immutable original request and requirements for replay.

## Prepare, preview, quote, unlock

Docs Pack and ContractCases expose stable limited previews. QuoteProof and MCP
WireCheck do not: their small verdicts are the paid value. Preview is optional;
repeat agents can invoke directly. This is preview then pay to unlock, not
trustless pay-after-use.

1. Generate 32 cryptographically random bytes, encode canonical unpadded base64url,
   prefix `atbp_`, and keep the resulting preparation capability privately.
2. POST `/v1/products/{id}/prepare` with `version`, `input`, unique `request_id`
   (32–128 alphanumeric/underscore/hyphen characters), and `prepare_secret_hash`
   (lowercase SHA-256 hex of the complete capability). Send the capability only
   in the `X-Preparation-Capability` header, including this first request.
3. Receive `prepared_id`, `expires_at`, minimum and an allowlisted preview.
   The full validated result is durably private before the preview is returned.
4. POST `/v1/products/{id}/quote` with `version`, `prepared_id` and explicit
   `payment_amount_atomic`. Use the capability header. Do not include input.
5. POST the existing `/invoke` with `version`, `prepared_id`, `quote_id`, amount,
   cap, original capability header, stable idempotency key and exact authorization.
   Only confirmed settlement unlocks the stored result; source work is not rerun.

A preparation can be atomically claimed by one payer/quote/operation. Global
network+asset+payer+nonce uniqueness applies across every product/preparation.
Raw capabilities and signatures are never stored or logged. The preparation
capability is separate from the optional `atbr_` review capability commitment.
There is no account or recovery grant; losing a capability loses access.

Unpaid TTL is 15 minutes. Failed attempts count against the free budget: 50
preparations per UTC day globally, 10 per client hash, 16 concurrent unexpired
preparations, 14 KB full results and 2 KB previews. Quotes are bounded to 200 per
day; existing service/client request rate limits also apply. Physical cleanup
runs daily, keeping a day's admission metadata. Replaying a preparation request
returns the same preview; an interrupted preparation can remain unavailable
until expiry. There is no exactly-once external computation claim.

Reuse the identical body, key, capability and original authorization after a
lost response. Changed requests/proofs reject without fresh settlement. Paid
result replay lasts 24 hours from operation creation. Unknown/pending settlement
retains output for reconciliation, even after unpaid/normal result expiry, and
never automatically retries settlement or releases output. There is no separate
unauthenticated result/status endpoint.

## Exact accounting and migration

Migration `0006_quotes_preparations.sql` adds private quote/preparation tables and
frozen metadata columns to payments. Existing payment/ledger/purchase fields and
append-only records stay intact. Amounts remain TEXT. `platform/scripts/report.js`
keyset-pages ledger rows and uses BigInt for exact lifetime and daily totals;
serialized amounts are strings even when a sum exceeds uint256. It fails instead
of silently truncating after its 100,000-row bound. Public totals count purchases,
not money or unique identities. Quotes/preparations are never revenue.

Tests use mock signatures/facilitators and isolated local fixtures only. No live
payment verification, real settlement, transfer, or on-chain reconciliation is
part of assistant validation. Local bounds and fixtures do not establish Cloudflare
Free production CPU headroom or willingness to pay.
