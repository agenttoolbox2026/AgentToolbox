# Success-only settlement feasibility

Checked official documentation on 2026-10-05 (America/Toronto). **Technically
achievable with a custom EVM authorization flow; not verified end to end or enabled.**
Dev mode is the only implementation. No wallet signature, transaction or funds
were requested. No x402 payment SDK or auto-settling middleware is installed.

## Findings and design consequences

- [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md):
  authorization flow separates read-only verification from settlement. Upfront
  and escrow flows have different ordering and do not meet this brief. Use explicit
  `/verify` at accept and `/settle` only after an eligible result, never HTTP 200
  from the recommendation/accept handler as evidence of downstream success.
- [EVM exact scheme](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md):
  EIP-3009 authorization binds recipient, value, nonce and validity window.
  Verification checks current state; it does not reserve balance. Expiry or a
  balance change can prevent later settlement. Exact is sufficient for a fixed
  disclosed success fee; `upto` and escrow add no necessary value here.
- [Facilitator behavior](https://docs.x402.org/core-concepts/facilitator):
  the public facilitator is intended for testnet/development. A settlement timeout
  may mean pending, not failed. Preserve the authorization identity and transaction
  hash, reconcile before retrying, and never generate a replacement charge after
  ambiguous settlement. Provider restart/deduplication guarantees need testing.
- [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator):
  documents Base (`eip155:8453`) and Base Sepolia (`eip155:84532`), API-key
  authentication, and `/supported` as the runtime source of truth. No authenticated
  provider capability call was possible here. Availability in docs is not account
  access. Credentials, fees and limits must be checked before use.
- [Circle contracts](https://developers.circle.com/stablecoins/usdc-contract-addresses):
  native Base USDC is `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
  Mainnet and testnet tokens differ. Pin chain, asset and six-decimal atomic units
  in a later payment configuration; never infer a network from an EVM address.
- [Receiving address guidance](https://docs.cdp.coinbase.com/x402/seller/quickstart):
  an EVM-shaped address alone does not establish control or deposit support.
  The brief's address belongs in `PAY_TO_ADDRESS` configuration. Ownership,
  selected-chain USDC compatibility and restrictions remain founder confirmations;
  no claim that this particular address can safely receive funds has been verified.
- [Bazaar](https://docs.x402.org/extensions/bazaar): discovery metadata describes
  callable paid resources. Local discovery is `/llms.txt`, OpenAPI and MCP for now;
  no Bazaar listing or organic discovery is claimed.
- [Cloudflare x402](https://developers.cloudflare.com/agents/tools/payments/x402/):
  Workers can integrate the protocol. Standard content/tool payment wrappers do
  not represent an externally executed retry's delayed outcome, so they are not
  installed as a shortcut.

## Proposed success condition and authorization lifetime

The quote fixes `agent_reported_success_v1`: caller reports completion, exactly
one retry, a 2xx HTTP result (or MCP `isError: false`), and a SHA-256 evidence
digest. The digest is an opaque reference, not proof of truthful completion.
No receipt describes this as independent or cryptographic verification.

Local quotes last five minutes, with at most 30 seconds of recommended waiting.
For a future payment flow, compute authorization expiry from quote expiry plus a
measured settlement margin; require the signed `validBefore` to cover it, reject
inadequate validity at accept, and check expiry again before settlement. The SDK
default lifetime is not assumed adequate. No guaranteed settlement margin or
facilitator timeout has been measured yet.

The server can enforce charging only after a *valid self-report*. EIP-3009 itself
does not enforce truthful downstream success or prevent a dishonest merchant with
the authorization from attempting early settlement. Independent success proof
is not achievable from the current inputs. This is a product trust boundary.

## Blockers and smallest next decisions

Keep no-charge dev mode. To proceed to testnet, confirm that the above self-report
success rule is acceptable, select Base Sepolia and a receiving address the founder
controls, and provide a supported facilitator connection. Then test expiry,
insufficient funds, duplicate submissions, pending settlement and crash recovery.
Before mainnet, additionally confirm Base/native USDC and an explicit maximum
transaction amount, verify MFA and receiving compatibility, and independently
match one controlled settlement with its ledger entry. Never request a private key.

If self-report is unacceptable, the smallest alternatives are remaining free for
learning or narrowing the experiment to an outcome with independent verifiable
evidence. Upfront/per-quote charging is a pricing change requiring founder choice.
