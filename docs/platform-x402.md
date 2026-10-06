# x402 platform implementation and limits

Official @x402/core and @x402/evm are both pinned to 2.28.0 in the isolated platform
package/lockfile. The implementation uses HTTPFacilitatorClient and
x402ResourceServer from @x402/core/server, ExactEvmScheme from
@x402/evm/exact/server, and official HTTP header codecs. No auto-settling
middleware or wallet signer is installed.

## Implemented boundary

For a deliberately configured callable paid product:

1. Require exact POST path, version, strict input, idempotency key and caller cap.
2. Build an x402 v2 exact EIP-3009 requirement for a configured fixed amount.
3. Return unsigned 402 + PAYMENT-REQUIRED when no authorization is provided.
4. Match chain, native token, recipient, value, validity and transfer mechanism;
   have the facilitator verify the authorization.
5. Atomically bind network/token/payer/nonce and product/version/idempotency key to
   a canonical request/config fingerprint. The client-chosen key alone is not
   payment authentication.
6. Execute and validate the concrete success criterion. Persist bounded output
   and settlement intent before calling settle. Failed outcomes never settle.
7. Persist the facilitator receipt in an append-only ledger before the operation
   can become settled and release its result with PAYMENT-RESPONSE.
8. Replay an identical settled request from durable storage. Changed requests
   conflict. Pending/unknown states withhold output and never create a new charge.

States: executing, outcome_ready, settling, settled, failed, unknown. Storage
failure before settlement means no settlement call. Storage failure after the
facilitator responds leaves a recoverable unresolved operation. Timeout or
free-tier exhaustion never triggers an automatic retry, fresh nonce, provider
switch or paid top-up. Manual authenticated reconciliation remains necessary;
there is no claim of automatic on-chain reconciliation or guaranteed refund.

Mock tests exercise all these boundaries and make no external verification or
settlement calls. The unsigned challenge also passed in the actual local
Cloudflare workerd runtime. Live paid transactions have not been tested.

## Provider evidence

Read-only GET https://facilitator.payai.network/supported on October 6, 2026
advertised x402 v2 exact on Base eip155:8453. The installed official EVM scheme
produces Base native-USDC requirements for
0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, six decimals, USD Coin version 2.
The saved capability snapshot is platform/payment-capabilities.json.
An advertisement is not proof that this receiver or a transaction works.

PayAI's current [pricing documentation](https://docs.payai.network/x402/facilitators/pricing)
describes 1,000 lifetime free credits per receiving wallet, with a shared host/IP
pool that can exhaust sooner. This is not 1,000 free settlements. The captured
Base EIP-3009 rate was 2.11 credits per settlement; rates change. No API key or
funded credit balance is configured, and no credit purchase is authorized.
The default x402.org facilitator is testnet-only and is not used as a mainnet
revenue claim.

Current protocol/source references:
- [Canonical x402 repository](https://github.com/x402-foundation/x402)
- [Payment identifiers](https://docs.x402.org/extensions/payment-identifier)
- [PayAI Base merchant guide](https://docs.payai.network/x402/base-mainnet-express)

## Experimental launch and remaining verification

Docs Pack 0.1.0 is active at $0.01 USDC per successful whole pack. The owner-confirmed
receiver is 0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D on Base native USDC.
Results have 24-hour logical retention, with daily/opportunistic physical cleanup;
financial receipts and replay tombstones persist. Paid usefulness reports are
idempotent self-reports and cannot trigger or reverse payments.

The adapter uses the official facilitator client's single settle call directly.
The high-level resource server's settlement_pending automatic retry is not used.
A regression test verifies one call and unresolved state even for that response.

Actual payment behavior still requires a user-controlled live test and independent
transaction/receiver/ledger reconciliation. No private keys, wallet signatures,
real POST /settle calls, payments, refunds or on-chain transfers were made by the
implementation agent. No paid customer, repeat paid call or revenue is claimed.
