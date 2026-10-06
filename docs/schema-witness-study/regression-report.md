# Pinned tool-schema drift regression

The candidate is confirmed. OpenAI Agents SDK **0.23.1**, when explicitly asked to convert `compare_files` to strict mode, produces a schema that accepts an input rejected by both the original schema and the actual MCP tool. This is an offline integration regression, not evidence of customer demand or superiority of a hosted checker.

## Scope and versions

- Source: [compare-cli commit `8b28632`, tool schemas](https://github.com/DrBaher/compare-cli/blob/8b286320c6f6f8683977a0f2b16293f9fe1b0443/mcp/compare-cli-mcp.mjs#L397-L444), package `compare-cli` 0.4.2 and `compare-cli-mcp` 0.1.4.
- Converter: installed `openai-agents==0.23.1`, using the actual `MCPUtil.to_function_tool(..., convert_schemas_to_strict=True)` path. Installed `strict_schema.py` is byte-for-byte identical to the [official v0.23.1 source](https://github.com/openai/openai-agents-python/blob/v0.23.1/src/agents/strict_schema.py). SHA-256: `dc3e869668c39f344c92d383576fce8f417d7f80b0bf762f637327f639c72e61`.
- Validator: `jsonschema==4.26.0`, checked independently under Draft 7 and Draft 2020-12. The source schema does not declare a dialect; both tested dialects agree on all results.
- Runtime: Python 3.12.15, Node 24.21.0, Node MCP SDK 1.32.1; all Python dependency versions are recorded in `requirements.lock` and `artifacts/results.json`.
- Actual tool catalog and calls came through a local stdio MCP connection to the pinned, unmodified source. No model, provider API, payment, or signing operation was invoked. Tracing was disabled.

## Concrete result

The source requires exactly one of `path`, `content_base64`, or `content_text` on each document side. Strict conversion makes every declared property required and changes the three `oneOf` branches to `anyOf`. The SDK marks the result strict; it does not fall back for this schema.

Both `base` and `candidate` in the witness contain:

```json
{
  "path": "artifacts/fixture.txt",
  "content_base64": "SGVsbG8u",
  "content_text": "Hello.",
  "format": "txt"
}
```

The full witness also supplies all top-level properties required by conversion: `strict: false`, `strict_cosmetic: false`, `only_clauses: []`, `ignore_clauses: []`, and `include_human_report: false`. Full input and validation errors are in `artifacts/witness.json`.

| Check | Observed result |
| --- | --- |
| Original schema, Draft 7 | Invalid |
| Converted schema, Draft 7 | Valid |
| Original schema, Draft 2020-12 | Invalid |
| Converted schema, Draft 2020-12 | Valid |
| Actual stdio `compare_files` call | `isError: true`, `INVALID_ARGS` |

The tool error was: `INVALID_ARGS: base: only one of [path, content_base64, content_text] may be set`.

The completed regression enumerates the eight presence masks, using the same mask for both sides. It is not a Cartesian enumeration of every combination across sides or all possible string values.

| Modes present on both sides | Original valid | Converted valid | Actual MCP success |
| --- | --- | --- | --- |
| None | false | false | false |
| path | true | false | true |
| content_base64 | true | false | true |
| path, content_base64 | false | false | false |
| content_text | true | false | true |
| path, content_text | false | false | false |
| content_base64, content_text | false | false | false |
| All three | false | true | false |

An additional minimal text-only call succeeds at the actual MCP server and validates the original schema, while failing the converted schema. All assertions passed. The final recorded run contains nine tool calls.

For these schemas, the mismatch is stronger than the single witness: every instance accepted by the converted schema must supply all three string modes, so all three original `oneOf` branches match and the original rejects it. The schema languages are therefore disjoint. This conclusion is derived from the required-property constraints; the test does not claim exhaustive enumeration of all JSON values.

## What this does and does not establish

The default configuration is unaffected: [Agents SDK defaults `convert_schemas_to_strict` to false](https://github.com/openai/openai-agents-python/blob/v0.23.1/src/agents/agent.py), and the regression verifies that `MCPUtil.to_function_tool(..., False)` preserves the original schema. The failure requires opting into strict conversion.

Provider acceptance of the converted schema is **unverified**. There were no provider calls, so this study cannot establish whether an API would reject the schema before generation, whether a model would emit the witness, or how often a real agent encounters this integration. Output-schema compatibility and PDF/DOCX handling were outside scope.

The witness makes the defect concrete and can be checked repeatedly as a regression. A competent baseline with the converter and a standard JSON Schema validator can produce the same validation evidence locally. No blinded baseline comparison, debugging-time measurement, token comparison, repeated-use trial, or willingness-to-pay test was performed. **A hosted witness utility has no demonstrated incremental advantage from this study.** Treat the result as a useful bug reproduction, not a validated product. This study did not implement or launch a utility.

## Artifacts

- `regression.py`: actual SDK conversion, dual-dialect validation, and stdio MCP checks.
- `artifacts/original-tool.json`: catalog entry extracted from the unmodified source; the SDK sees the same schema through stdio.
- `artifacts/original-schema.json`, `artifacts/converted-schema.json`: exact before/after schemas.
- `artifacts/witness.json`, `artifacts/results.json`: concrete inputs, validation errors, and actual MCP responses.
- `artifacts/source-hashes.json`: hashes of preserved source files.
- `README.md`, `requirements.lock`: reproduction instructions and pinned Python environment.

All work stayed within the study directory. The Node MCP dependency was reused read-only from the existing local project via a symlink; no platform files were modified. A workspace-local Python installer briefly created an external convenience symlink, which was specifically removed. No outstanding authorization blocker remains.
