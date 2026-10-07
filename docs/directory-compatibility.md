# Directory compatibility (2026-10-07)

Inspected the official [402 Index API documentation](https://402index.io/api-docs). Its registration supports `http_method: "POST"` and a JSON-string `probe_body`. The four paid tools already return an unsigned 402 challenge before input/schema parsing for bounded POST bodies. A new paid GET route is unnecessary. The existing `/.well-known/x402` lists only configured live routes, with exact minimum terms; OpenAPI and Bazaar disclose invocation schemas.

Proposed registration configuration: use each manifest route's `resource`, its product name and summary, protocol `x402`, method `POST`, `probe_body: "{}"`, payment asset `USDC`, network `Base`, and the disclosed minimum USD price `0.01` (buyer-chosen higher amounts remain possible). No registration, domain claim or token was created by this task. Registration would be an external publication and requires a separate owner decision.

Directory protocol probing and domain proof do not prove a successful live payment. The registry retains `live_payment_verified: false`. Domain verification tokens are private authorization credentials and must never enter repository files, HTML, discovery metadata, logs or screenshots. Only a directory's explicitly documented public proof hash belongs in its domain proof file, if later authorized.

Preview acquisition: the catalog includes `preview.supported`, HTTP `path`, human `page`, expiry and actual free-budget bounds. Docs Pack and ContractCases expose real-input preview forms. QuoteProof and MCP WireCheck withhold previews because their verdicts are the paid result.

Each active tool publishes `/v1/products/{id}/criteria` with product/version, criteria version, predicate language, failure behavior and current limits. The exact published predicates run in the handlers; input/output schema validation and durable payment-state checks remain required. This contract describes bounded structural evidence, never usefulness, quotation truth, protocol certification or independent on-chain reconciliation.
