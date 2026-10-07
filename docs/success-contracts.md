# Pinned success contracts and payment requirements

Buyers can inspect the exact success contract before authorizing payment, save its
canonical bytes, and require that contract on an invocation. This pins the
published rules and schemas; it does not independently attest deployed code,
guarantee usefulness, or add the success hash to the USDC EIP-3009 signature.
Enforcement is part of AgentToolbox's server request and settlement boundary.

## Discovery and buyer flow

1. Read `GET /v1/products/{id}/criteria`. It retains the existing criteria and
   limits and adds `canonicalization`, `canonical_json`, and lowercase `sha256`.
   Parse the document inside `canonical_json` and inspect its rules and bounds.
2. Independently calculate SHA-256 of the UTF-8 bytes of the **decoded
   `canonical_json` string**, without a newline, BOM, JSON wrapper, or quotation
   marks around that string. Require equality with `sha256`. Save both the bytes
   and digest; do not merely trust a fetched digest without inspecting its content.
3. `GET /v1/products/{id}/invoke` returns an unsigned 402 discovery challenge. It
   does no execution, authorization verification, or settlement. The JSON body
   includes `contract_pins` and `payment_requirements_pin`. The latter provides
   the same canonicalization metadata, canonical JSON and SHA-256 for the exact
   `accepts[0]` PaymentRequirements object. `HEAD` returns the challenge header
   without a response body. Use GET to inspect its pin metadata.
4. Include `success_contract_sha256` and `payment_requirements_sha256` in the
   invocation JSON alongside the normal input, version and charge cap. Both are
   optional for compatibility, but a buyer requiring a pinned direct call must
   include them. Keep the full body, idempotency key and original authorization
   unchanged when replaying. A pin mismatch returns 409 before new product work,
   facilitator verification or settlement.

Example pinned direct call body (replace the digest placeholders with the
verified 64-character lowercase hex values):

```json
{
  "version": "0.1.0",
  "input": {"urls": ["https://docs.python.org/3/library/asyncio.html"], "query": "event loop", "max_excerpt_chars": 4000},
  "max_charge_usdc_atomic": "10000",
  "success_contract_sha256": "<verified success digest>",
  "payment_requirements_sha256": "<verified payment requirements digest>"
}
```

`agent_id` is a separate optional random UUID pseudonym, such as
`crypto.randomUUID()`. It is not authenticated identity. Omit it if unavailable;
an arbitrary name is rejected with `invalid_agent_id` before payment processing.

For higher prices or prepared results, obtain a quote first. The quote response
includes the exact price's `contract_pins` and `payment_requirements_pin`; the
minimum-price discovery hash does not match a higher-price quote. Optional pins
on the quote request must match before a quote is saved. Every new quote stores
the current success hash even when the buyer supplies no pin. Invocation with
that `quote_id` inherits the saved success contract; omitting the explicit hash
does not remove this protection. The saved `requirements_json` already binds the
exact quoted payment object. A changed success contract requires a new quote and
a fresh decision by the buyer before authorization.

Preparations capture the success hash before running, recheck it after producing
the preview, and return it in `contract_pins`. An optional
`success_contract_sha256` in the prepare request rejects a mismatch before any
preparation work. A prepared result can only be quoted and purchased against that
same success contract. The paid flow also rechecks contract pins after
authorization verification, after validating output, and immediately before its
sole settlement call. A known contract change at these boundaries cannot settle.

The strict pin serializer is separate from the historical request fingerprint
serializer. Existing request and authorization fingerprints retain their original
byte rules, including previously accepted escaped lone surrogates in inputs; the
new strict profile must not make an old completed purchase unreplayable.

Completed paid responses contain their frozen `contract_pins` in durable output.
Exact replay returns the original output, pins and receipt before checking the
current contract, schema, version, price or availability. Changed request pins
conflict with the original request hash; they cannot turn a replay into a new
charge. Normal 24-hour output retention and unresolved-settlement rules apply.

## Canonicalization profile: agenttoolbox-json-v1

This is a named local profile. No RFC 8785 compliance is claimed.

- Recursively sort object keys by unsigned UTF-16 code units, using ECMAScript's
  default string sort. Numeric-looking keys are sorted as strings too.
- Preserve array order. No holes or additional array properties are allowed.
- Serialize null and booleans as JSON tokens. Serialize finite binary64 numbers
  using ECMAScript `JSON.stringify`; negative zero becomes `0`. USDC atomic
  amounts are decimal strings and are never converted to binary64.
- Use ECMAScript JSON string escaping. Reject lone UTF-16 surrogates in both keys
  and values. Do not perform Unicode normalization or change string/address case.
- Reject undefined, functions, symbols, bigint, nonfinite numbers, accessors,
  cycles, non-plain objects and non-enumerable object properties. The success
  document specifically removes Zod's non-enumerable top-level `~standard`
  runtime decoration from schemas, because it is absent from their published
  JSON representation. Other invalid values are not silently removed.
- Emit no insignificant whitespace. Encode as UTF-8 with no BOM or trailing
  newline. SHA-256 covers precisely those bytes and is rendered as lowercase hex.

The scalar and sorting primitives are specified by
[ECMAScript JSON.stringify](https://tc39.es/ecma262/multipage/structured-data.html#sec-json.stringify)
and [CompareArrayElements](https://tc39.es/ecma262/multipage/indexed-collections.html#sec-comparearrayelements).
The stricter rejection rules above are AgentToolbox's own profile. A parser used
to reconstruct documents should reject duplicate object names before constructing
its JSON value; this serializer receives parsed values and cannot recover names
discarded by a parser. Buyers can avoid cross-language number formatting issues
by verifying the supplied canonical bytes and inspecting the decoded document.

The success document has exactly these fields:

| Field | Bound content |
| --- | --- |
| `format` | `agenttoolbox-success-contract-v1` |
| `product_id`, `product_version` | Product identity and version |
| `criteria` | Published predicate language, rule version, rules and failure behavior |
| `success_criterion` | Published success statement |
| `limits` | Published product limits |
| `input_schema`, `output_schema` | Published JSON schemas |

Missing fields in older/test contracts are explicit JSON nulls. Cosmetic product
names, discovery URLs and payment readiness are outside this success document.
Payment terms are separately pinned: hash the **complete** PaymentRequirements
object in `accepts`, including `extra`, its exact address case and any additional
fields. Do not hash the whole x402 challenge, the encoded HTTP header, or a
signature. Reordering object keys does not change either hash; changing an array
order, rule, schema, bound or exact payment value does. Version this profile
instead of changing its byte rules in place.

## Migration and historical records

Apply `0009_contract_pins.sql` before deploying the dependent Worker. It adds
nullable immutable success-hash columns to quotes and preparations. It does not
rewrite existing rows, receipts, ledger events, creator terms, or financial history.

Existing quote rows with a NULL digest cannot establish their historical success
contract and require a new quote before any new purchase (`quote_unpinned`), even
if the buyer supplies a current hash. Existing unpaid preparations
with NULL digests cannot prove which contract generated their result and must be
regenerated before sale (`preparation_unpinned`). Completed paid replay remains
available under its original retention and authorization rules.

Local tests cover all four real product contracts, UTF-16 key order and Unicode,
independent SHA-256 reproduction, invalid JSON values, exact payment strings,
pre-work pin errors, quote inheritance, prepared result drift, late settlement
checks, immutable migration preservation and completed replay after contract
changes. They use synthetic local adapters; they are not live paid-buyer evidence.
