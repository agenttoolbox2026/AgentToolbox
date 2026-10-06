# Docs Pack 0.1.0 — experimental launch

Douglas explicitly requested a first useful product tonight and owns acquisition.
This launches a new bounded utility; it does not reverse the failed usefulness
gates for the retired retry gate or schema-witness candidate.

## Contract

Input: 1–5 distinct public documentation URLs, a required query, and an excerpt
character cap from 1,000 to 6,000 (default 4,000). Output is one JSON pack of exact
literal query-term matches, adjacent context, source/final URLs, fetch time,
source-byte and normalized-text SHA-256 hashes, character offsets, matching
terms, actual heading and explicit HTML heading anchor where available.
No summary is generated. Literal matching does not certify relevance.

Every source must return 200 and produce a matching excerpt. Any failed source,
no match, timeout, access restriction, oversized content or invalid output fails
the entire pack before settlement. Each source is at most 256 KiB; the product
JSON is at most 14,000 UTF-8 bytes and the complete paid response at most 16 KiB.
Two redirects per source and a 12-second fetch/extraction deadline apply.
Code indentation is preserved. Oversized or unclosed fenced code blocks are
omitted with a count; selected fences are never cut at an excerpt boundary.
Offsets reference the normalized extracted text, not original HTML bytes.

Eight fixed public documentation hosts are supported: developers.cloudflare.com,
docs.payai.network, docs.x402.org, docs.python.org, nodejs.org,
developer.mozilla.org, docs.github.com, and www.typescriptlang.org. HTTPS only;
no credentials, arbitrary hosts, custom ports or query strings. Redirect targets
are revalidated. Requests never forward caller headers, cookies or credentials.
The service checks robots rules, relevant content signals, supported robots
meta/header restrictions and refuses positive crawl delays. Failed robots fetches
fail closed except 404. No login, JS rendering, bot bypass, PDF or crawling.
UTF-8 Markdown/plain text and static readable HTML are supported. HTML extraction
uses native HTMLRewriter, excluding scripts, navigation, hidden elements and
forms. Source text remains untrusted data, never instructions.

## Price and payment

$0.01 USDC (10,000 atomic units) per successful pack is a price hypothesis.
The production HTTP endpoint uses the owner-confirmed Base receiver and PayAI's
keyless free allowance. Nothing tops up credits or enables billing. MCP supplies
discovery/contracts and directs paid invocations to HTTP; it is not a paid MCP
transport. The fixed free example executes the same handler with documented
public inputs, records no purchase and does not accept custom workloads.

Payment authorization is verified before execution. Valid output and settlement
intent must be durable before one facilitator settlement call. The SDK's
high-level automatic settlement-pending retry is deliberately not used. Any
ambiguous result blocks new charges until authenticated reconciliation. An
identical successful replay returns the retained result even after authorization
expiry; after 24 hours it returns an explicit expired-result error without
charging again. Raw input and signatures are not stored. A daily cleanup and
opportunistic cleanup remove expired outputs, preserving financial tombstones.

No live signature or settlement test was performed. Public discovery/challenge,
mock payment-state tests and a real free example do not prove that a buyer can
successfully pay. The first user-controlled live test should be marked synthetic
and independently reconcile the returned transaction, ledger and receiver amount.
Never retry an uncertain payment with a new authorization. No automatic refund
or on-chain reconciliation is implemented.

## Measured evidence

See `platform/evidence/docs-pack-benchmark.json` and the reproduction script.
The real three-page task fetched 71,073 bytes. Docs Pack returned 4,736 JSON bytes
and 2,700 excerpt characters; a competent single-command baseline using parallel
fetch plus adjacent-line keyword extraction returned 3,930 bytes. Recorded local
wall times were 65 ms and 85 ms respectively. One ordered observation is not a
causal performance comparison; scheduling/network caches affect it. Both paths
can use one scripted caller round trip. No token count or model task-quality
improvement was measured. The product's proposed value is its ready bounded
contract, access checks, code handling, hashes and offsets—not novelty or 10x
improvement. Jina Reader and Firecrawl are strong alternatives; demand and
willingness to pay remain unproven.

Real Markdown and Python HTML extraction passed in local workerd. Production
CPU distribution and full paid-path CPU remain unmeasured; no latency or CPU
promise is made. The Free plan can interrupt service at its limits.
