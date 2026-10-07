# Free contract examples and tool value evidence

All four current tools are authored and operated by AgentToolbox. Their first-party
status and our synthetic fixtures are not independent endorsements or customer
proof. The purpose of the free material is to help an agent decide whether the
promised output fits its task before it authorizes payment.

## What the free examples establish

`platform/src/free-examples.js` exports a static manifest for each tool, intended
for `GET /v1/products/{id}/examples`. Each contains fixed input, controlled source
or RPC responses, exact expected output fields and a nonchargeable boundary.
The route's integration and deployment must be verified separately; adding this
module alone does not publish an endpoint.

Reading a manifest executes no tool, fetches no source, probes no endpoint and
initiates no payment. Every manifest says `first_party_synthetic_fixture`, fixes
its clock and identifies itself as offline material. The URLs only identify
mocked responses; do not send those inputs or replay commands to the live service.
Synthetic text labeled with a documentation URL is not that publisher's text.

Expected output values use JSON Pointers and exact comparisons. Unlisted fields
are not implied or asserted. `outcome_qualifies` means the handler's success check
would pass for that fixture; it is not a payment or usefulness claim. The test
suite executes the actual product handlers with injected local responses, checks
input/output schemas and success checks, and compares every published expectation.
No public requests, credentials, wallet signatures or settlements are used.

| Tool | Free demonstration | Independent check and limits |
| --- | --- | --- |
| Docs Pack | A matching Markdown excerpt and a whole-pack failure when nothing matches. | Hash the source bytes and normalized text; slice the declared offsets. Literal matching does not establish relevance or a complete answer. The separate fixed live `/example` endpoint uses real retrieval and has different evidence status. |
| QuoteProof | Exact, whitespace-normalized, absent, repeated and UTF-16 emoji matches; a robots denial produces unknown. | Ordinary substring search and SHA-256 verify the fixture positions and hashes. Absence is supported only for complete plain text. Matching words does not verify their truth; HTML, network and current source state are outside these offline fixtures. |
| ContractCases | Integer endpoints plus isolated below-bound, above-bound and type failures; unsupported schema keywords and invalid seeds are rejected. | The test suite independently validates every returned case using Ajv. A small boundary set is not exhaustive testing or proof that an implementation follows its schema. |
| MCP WireCheck | Both supported discovery flows, a decisive missing-tools finding, a nonchargeable 401 and an unsupported input URL. | Read the fixed RPC shapes and method sequence or replay against a local mock. Tests check exact methods and no `tools/call`. This does not prove a current remote endpoint works, tools execute correctly, or full conformance/security. |

## Real-input preview is separate

Docs Pack and ContractCases retain their existing optional limited real-input
preparation flow. It has private capabilities, admission budgets, expiry and a
withheld full result. ContractCases may decline a preview when too few cases are
available. The direct minimum-price paid path needs no preparation or quote.

QuoteProof and MCP WireCheck have no dynamic outcome preview: revealing their
small verdict can reveal the whole paid output. A free input-schema check can
reject unsupported inputs, but cannot establish source accessibility, quotation
status, MCP compatibility or a successful paid outcome. Do not label validation
or these static fixtures as a live dry run. The fixtures do not alter either
tool's preview availability or settlement rules.

## What still needs buyer evidence

The potential value is bounded retrieval/evidence packaging for Docs Pack and
QuoteProof, generated isolated test cases for ContractCases, and a sanitized
version matrix for WireCheck. Competent free primitives remain strong baselines:
fetch plus literal extraction; substring matching plus hashing; hand-built
boundary cases checked with Ajv; and an MCP client or Inspector for discovery.
The fixture suite proves the stated examples agree with their implementations
and selected independent checks. It does not show superiority, time/token
savings, demand, retention or willingness to pay.

For a real task, record why the agent selected a paid tool, whether the output
helped complete the task, what its alternative was, and whether it returned.
Keep those observations separate from contract success and payment settlement.
Use the [Phase 1 learning protocol](phase1-learning.md); no new dashboard or
invented performance threshold is needed. Fix an observed value or trust blocker
before claiming usefulness from a passing fixture.

Reproduce the offline checks from `platform/`:

```sh
node --test test/free-examples.test.js
```

Broader implementation evidence and limitations remain in [Docs Pack](docs-pack.md),
[QuoteProof](quote-proof.md), [ContractCases](contract-cases.md) and
[MCP WireCheck](mcp-wirecheck.md). Existing benchmark results keep their original
scope; this change makes no new benchmark claim.
