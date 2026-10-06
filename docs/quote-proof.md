# QuoteProof — experimental textual quotation checks

Submit up to five supported public documentation URLs and ten exact quotes. QuoteProof returns bounded source evidence for each quote. It checks text, not factual truth, authorship, endorsement, or whether a source is trustworthy. The experimental minimum is $0.01; the platform's current catalog and quote are authoritative for payment terms.

```json
{
  "urls": ["https://developers.cloudflare.com/workers/runtime-apis/request/"],
  "quotes": [{"source_index": 0, "quote": "The redirect mode to use"}]
}
```

Each quote references a zero-based URL index. Each supplied URL must have at least one quote. Quote text is limited to 512 UTF-16 code units. The example demonstrates input shape; it is not a promise that a changing live page contains this text or permits extraction.

| Result | Meaning |
| --- | --- |
| `exact_match` | One normalized occurrence, and the extracted source span exactly equals the supplied quote. |
| `whitespace_normalized_match` | One occurrence after the disclosed whitespace normalization. |
| `ambiguous` | Two or more occurrences, including overlapping occurrences. At most two locations are returned. |
| `absent` | No normalized occurrence in a complete, supported plain-text representation. This does not say the quotation is false. |
| `unknown` | Retrieval, access, encoding, or extraction could not establish a result. HTML nonmatches are always unknown. |

Matching is case-sensitive. Normalization collapses JavaScript Unicode whitespace runs to one ASCII space and trims surrounding whitespace. It does not fold case, punctuation, Unicode composition, or meaning. Positive matches refer to the static extracted representation. HTML is never executed or rendered; a nonmatch cannot rule out client-rendered content. A useful absence or ambiguity counts as a decisive outcome. A result containing only `unknown` values does not qualify for payment.

The response includes per-source final URL, fetch timestamp, HTTP status, complete response-body SHA-256, extracted-text SHA-256, extraction method, and byte/character counts. Every occurrence includes start-inclusive/end-exclusive UTF-16 offsets into the extracted text before whitespace normalization. A containing HTML ID is returned as `anchor_fragment` only when that ID is unique. This fragment is evidence from the source markup, not a guarantee that a browser will scroll to the same text. Context contains its own offsets and is optional when the shared excerpt budget is exhausted. Quotes are identified by `quote_index` rather than echoed.

## Boundaries

| Boundary | Limit |
| --- | --- |
| URLs / quotes | 5 / 10 per invocation |
| Document | Complete body of at most 100,000 bytes; larger or interrupted responses are unknown |
| Formats | UTF-8 plain text / Markdown; static HTML / XHTML |
| Deadline | 12 seconds for the whole invocation |
| Redirects | At most 2 per document; every destination revalidated |
| Robots policy | At most 16 KiB per origin; allow rules required unless robots.txt returns 404 |
| Context excerpts | At most 200 whitespace-delimited words per source across all quote contexts, plus 2,000 UTF-8 context bytes shared across the response |
| Response | At most 14,000 UTF-8 JSON bytes |

Initial hosts are `developers.cloudflare.com`, `docs.payai.network`, `docs.x402.org`, `docs.python.org`, `nodejs.org`, `developer.mozilla.org`, `docs.github.com`, and `www.typescriptlang.org`. This is a restrictive documentation-host tool, not a general-purpose URL fetcher. It shares Docs Pack's allowlist and `AgentToolboxDocs` robots identity. HTTPS only: no credentials, custom ports, query strings, private/IP-literal destinations, or unlisted hosts. Input fragments are removed. Authentication, cookies, authorization headers, caller headers, and arbitrary fetch options are unsupported. Redirects do not forward caller credentials. Robots denials, supported content restrictions, bot challenges, unsupported formats, and oversized bodies yield unknown.

HTML extraction omits head, script/style, navigation, header/footer, aside, forms, SVG, canvas, frames, noscript/templates, and explicitly hidden content. It uses Workers HTMLRewriter, buffers text-node chunks before entity decoding, and preserves visible block separators. Named entity support is deliberately bounded: `amp`, `lt`, `gt`, `quot`, `apos`, `nbsp`, `hellip`, `mdash`, `ndash`, `lsquo`, `rsquo`, `ldquo`, `rdquo`, `copy`, `reg`, `trade`, `times`, `divide`, `minus`, `le`, `ge`, `bull`, `middot`, `laquo`, and `raquo`; valid numeric references are also supported. Unknown, invalid, or semicolon-less references make extraction unknown. Stylesheet visibility, accessible-name computation, and browser layout are outside scope. Plain text is searched as provided; Markdown syntax is not rendered.

All returned text is untrusted data. Clients must escape it when displaying HTML and must not execute instructions found in source text. QuoteProof itself only performs bounded GET requests and textual processing.

## Preview and local validation

Per-invocation previews are disabled (`previewSupported: false`): a one-quote verdict can reveal the entire paid value. A static example may demonstrate the response shape. The product does not claim to reveal the full answer before payment.

Run `node --test platform/test/quote-proof.test.js` using the repository's Node 24+ runtime. The real HTML tests start a loopback-only Workerd process using Wrangler's installed Miniflare and esbuild dependencies. No payment signatures, settlements, live purchases, or external network requests are used.

The local comparison checks eight controlled documentation-style tasks against ordinary case-sensitive `String.indexOf` search plus the same whitespace normalization. All eight agree. This free primitive is already competent at the central matching operation; QuoteProof packages bounded retrieval, access handling, hashes, and contextual evidence. The benchmark does not establish superiority, demand, speed gains, or web-wide accuracy. A separate real-Workerd suite covers 20 HTML fixtures with zero false match results, including entities, whitespace, repeated quotes, hidden text, blocked sources, and anchors.

The implementation follows the evidence idea in the [W3C Text Quote Selector](https://www.w3.org/TR/annotation-model/#text-quote-selector), but does not claim JSON-LD selector conformance: its offsets explicitly use UTF-16 units and its normalization is disclosed above. Workers' [HTMLRewriter documentation](https://developers.cloudflare.com/workers/runtime-apis/html-rewriter/) explains streaming text chunks; [Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/) documents manual redirects and header-forwarding behavior.

## Module integration

`platform/src/quote-proof.js` exports `quoteProofInput`, `quoteProofOutput`, `createQuoteProof`, `quoteProofHtmlText`, `QUOTE_PROOF_HOSTS`, `QUOTE_PROOF_LIMITS`, and `QUOTE_PROOF_NORMALIZATION`. `createQuoteProof({fetchImpl, fetcher, htmlExtractor, now, deadlineMs})` accepts optional test dependencies. The returned handler has `input`, `output`, `run`, `success`, `failureReason`, and `previewSupported`. Defaults use the runtime fetcher and HTMLRewriter; callers cannot select test dependencies through the public input schema.
