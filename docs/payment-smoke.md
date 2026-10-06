# Human-controlled payment smoke

Status: not performed. The site has an agent HTTP API and a fixed free example;
it does not contain a browser wallet checkout. An ordinary wallet's Send USDC
button will not execute Docs Pack. A wallet-connected x402 v2 client that supports
JSON POST, custom headers and replaying the original authorization is required.
No specific ready-made wallet-app flow has been verified for this endpoint.
Do not export a seed/private key or paste credentials/signatures into chat.

The protocol's [wallet guide](https://docs.x402.org/core-concepts/wallet) explains
wallet authorization, and its [buyer guide](https://docs.x402.org/getting-started/quickstart-for-buyers)
describes the HTTP flow. The guide's private-key code examples were not run;
prefer an existing wallet-managed signing integration.

Once a human has a compatible client:

1. Open the [free example](https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/example).
   Copy `example_input` from the [contract](https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack).
2. Make one JSON POST to `https://agnttoolbx.agenttoolbox2026.workers.dev/v1/products/docs-pack/invoke`.
   Use `version: "0.1.0"`, the copied `input`, and `max_charge_usdc_atomic: 10000`.
   Set a fresh 32–128 character `Idempotency-Key` and
   `X-AgentToolbox-Sample: synthetic` so the owner test cannot inflate the counter.
3. In the wallet's own confirmation, verify exact USDC/Base authorization for
   **0.01 USDC**, recipient `0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D`,
   native USDC contract `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, chain 8453.
   The client should use the server's short-lived x402 v2 EIP-3009 requirements.
   The human alone decides whether to approve. No unlimited allowance is needed.
4. After a 200 result, retain its operation ID and transaction hash. Compare the
   exact receiver/amount and successful transaction on Base with the private
   operator ledger. Facilitator confirmation alone is not independent revenue
   reconciliation. Expected public counter change for this synthetic test: zero.
5. For delivery replay, reuse the identical body, idempotency key and original
   authorization. Do not ask the wallet to sign another payment. The operation ID,
   result and transaction should be unchanged. Retained results expire after
   24 hours; expiry never causes a new charge.

A 422 outcome failure has no requested settlement. A timeout, 503 or
`settlement_unresolved` may follow a broadcast payment: stop and reconcile the
existing operation. Do not create a fresh nonce, new key or replacement charge.
No automatic refund or automatic on-chain reconciliation is provided.

The implementation agent has not accessed a private key, produced a live payment
signature, called a real settlement endpoint or made a manual transfer.
