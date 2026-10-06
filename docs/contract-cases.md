# ContractCases 0.1.0 — experimental

ContractCases turns one bounded JSON Schema and a caller-supplied valid example
into reproducible positive witnesses and isolated negative mutations. Every
returned value is checked against the entire submitted schema. This is a case
generator for a documented subset, not a schema certification, implementation
test, exhaustive test suite, or evidence that an API behaves as advertised.

## Input and supported subset

```json
{
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "name": { "type": "string", "minLength": 2, "maxLength": 12 },
      "retries": { "type": "integer", "minimum": 0, "maximum": 5 }
    },
    "required": ["name", "retries"],
    "additionalProperties": false
  },
  "valid_example": { "name": "demo", "retries": 3 },
  "max_cases": 12
}
```

The root must declare the exact Draft 2020-12 URI above. Every schema node must
declare one `type`: object, array, string, number, integer, boolean, or null.
The following keywords are supported:

| Type | Keywords |
| --- | --- |
| All | `type`, `enum` (1–8 distinct JSON values), `const` |
| Object | `properties`, `required`, boolean `additionalProperties` |
| Array | One schema in `items` (required), `minItems`, `maxItems` |
| String | `minLength`, `maxLength` |
| Number / integer | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` |
| Annotations | `title`, `description`; root `$schema` |

Required names must appear in `properties`. Annotations do not affect verdicts.
Type-specific keywords must match their schema node's declared type. Unknown or
unsupported keywords are rejected, including `$ref`, `$defs`, remote references,
composition, type unions, boolean schemas, regex `pattern`, `format`,
`multipleOf`, `uniqueItems`, `default`, and unevaluated/conditional keywords.
No schema resource is fetched; no caller-supplied code or regex is executed.

Limits: schema 8,192 UTF-8 JSON bytes; example 2,048 bytes; at most 64 schema
nodes, three schema-child edges below the root, and 25 declared properties across
the whole schema. Array length limits are at most 16; string length limits at most 128
Unicode code points. Instance traversal is bounded to 128 nodes, depth 8,
17 array elements, 32 object members, and 1,024 UTF-16 units per string. Property
names are at most 128 UTF-16 units. Unpaired surrogates and non-JSON values are
rejected. At most 160 candidates are checked; `max_cases` is 2–24, default 12.
The product output is at most 14,000 UTF-8 bytes.

Numeric inputs and bounds use parsed JavaScript binary64 values, finite and
within ±1,000,000,000. This is not arbitrary-precision JSON-number validation.
Integer boundaries use integer rounding. Number boundaries use the adjacent
representable binary64 value, never a guessed epsilon. String lengths count
code points, so one astral character is one character; combining marks remain
separate code points. Enum/const equality ignores object member insertion order
and does not coerce strings, numbers, or booleans.

## Output and paid success

Output includes a canonical structural schema SHA-256, selected cases, an
explicit coverage statement, and coverage gaps. Each case includes the complete
JSON value, a JSON Pointer to its target instance location and schema keyword,
the expected verdict, number of checked assertions, and all validation failures.
Root instance pointers are `""`; slashes and tildes use JSON Pointer escaping.
For `required`, the instance pointer identifies the missing member; for
`additionalProperties`, it identifies the unexpected member.

Positive cases witness supported bounds, enum/const values, or representative
type/structural limits when there is no explicit numeric or length bound. A
positive witness can equal the supplied example. A negative is returned only
when exactly one assertion fails at the intended keyword **and** instance
location. Multiple failing assertions are never relabeled as an isolated failure.
Overlapping bounds, enum/const combinations, absent optional properties, and
case/byte/candidate budgets can leave uncovered constraints. The output reports
the total gap count and up to 12 gap details; any omitted gap details are counted.

Generation visits present object properties and the first two elements of an
array. It does not synthesize missing optional structures or solve arbitrary
constraint systems. The supplied example must already validate. Results are
deterministic for the same input and have no externally fetched dependencies.

A successful paid result needs at least one validated positive witness and one
validated isolated negative, a valid output envelope, and compliance with the
byte/case bounds. Invalid inputs, unsupported schemas, or inability to produce
both verdicts fail before the platform's settlement step. Useful rejections in
the returned negative cases are successful work; an error-only run is not.
Experimental minimum pricing is configured centrally by the platform, starting
at $0.01 USDC with the buyer able to deliberately choose a larger exact amount.
This module does not quote, authorize, settle, or change a payment amount.

The optional prepared-result preview uses a fixed allowlist: aggregate counts
and one isolated negative with its value and trace. It never returns the cases
array, schema hash, arbitrary output fields, or the other case values. Preview
is disabled for results with fewer than four cases. Platform preparation must
retain one stable preview and enforce its expiry and admission budgets.
All schema annotations, names, and values remain untrusted data, never
instructions. This handler has no network, persistence, or logging operations.

## Verification and comparison

On 2026-10-06, the focused suite passed 18 tests with all optional evidence runs
enabled. Every generated case for three realistic schemas was independently
checked by Ajv 8.20.0 and Python jsonschema 4.26.0's Draft202012Validator. The
tests also cover malformed/unsupported inputs, Unicode, numeric rounding,
overlapping constraints, JSON Pointer escaping, `__proto__` data, object equality,
determinism, output caps, coverage gaps, and the preview allowlist. A fixed
272-value/schema cross-product agrees with Ajv.

The official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite/tree/5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8)
was pinned to commit `5b0ee1613e45fcc2bddac00e07c19cd49b00d8a8`.
Fifteen selected keyword files contained 54 unmodified vectors accepted by this
strict subset; all passed. The other 82 schema groups were unsupported and
rejected, not counted as passing conformance. The 54 supported type vectors are
also embedded in the test file and run offline against both this validator and
Ajv; the Python evidence run checks them too. These vectors are a limited
conformance check, not full JSON Schema support. See the primary
[validation specification](https://json-schema.org/draft/2020-12/json-schema-validation)
and [core specification](https://json-schema.org/draft/2020-12/json-schema-core)
for the broader standard.

A local Node 24.21.0 comparison used 20 warmups and 100 measured iterations per
schema. Ajv was precompiled and given the selected cases; it validates those
values but does not generate them in this comparison. Timings are medians:

| Representative task | Returned cases | Output bytes | Generate + validate | Free Ajv validation only |
| --- | ---: | ---: | ---: | ---: |
| API job input | 19 | 6,854 | 0.241 ms | 0.002 ms |
| Batch integer IDs | 15 | 4,606 | 0.132 ms | 0.001 ms |
| Nested result | 18 | 7,212 | 0.213 ms | 0.002 ms |

This comparison establishes agreement and the low cost of competent free
validation primitives. It does not measure an end-to-end generation advantage,
human effort, agent tokens, network overhead, or production CPU headroom.
[Schemathesis](https://github.com/schemathesis/schemathesis/blob/master/docs/explanations/data-generation.md)
already provides positive and negative data generation in a broader API-testing
workflow. ContractCases offers a small ready-to-call bounded contract and
single-failure traces; novelty, superiority, demand, and willingness to pay are
unproven. The owner's request authorizes this experimental launch, independently
of the earlier failed schema-witness study's usefulness gate.

A separate local Workerd check (Miniflare 5.20261001.0-alpha, compatibility date
2026-10-06) executed a 25-property schema with 50-character example values,
string bounds of 1–128, and a request for 24 cases. Twenty requests all met the
contract; the result contained six cases in 12,064 bytes, stopped at 160 checked
candidates, and honestly reported 99 uncovered targets. After five warmups,
the 15 local request wall times had a 2.794 ms median and 3.864 ms maximum.
Those times include local IPC and do not measure Worker CPU. Neither this
runtime check nor the Node comparison verifies production Free-plan CPU
headroom, full paid-path overhead, or performance under concurrent load.

Reproduction from `platform/`:

```sh
node --test test/contract-cases.test.js
CONTRACT_CASES_PYTHON=/path/to/python-with-jsonschema \
CONTRACT_CASES_OFFICIAL=/path/to/pinned-official-keyword-files.json \
CONTRACT_CASES_BENCHMARK=1 node --test test/contract-cases.test.js
```

`CONTRACT_CASES_OFFICIAL` is a JSON object mapping the names `type`, `minimum`,
`maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `minLength`, `maxLength`,
`minItems`, `maxItems`, `required`, `additionalProperties`, `properties`, `enum`,
`const`, and `items` to their unchanged `tests/draft2020-12/<name>.json` arrays
from the pinned suite. No dependency was added to the Worker; Ajv is a test-only
transitive dependency already installed with the MCP SDK. The Python and
downloaded-corpus checks explicitly skip when their environment variables are
absent. No actual payments or authorizations are used by these tests.
