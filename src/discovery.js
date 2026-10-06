import { recoverSchema, acceptSchema, resultSchema, feedbackSchema, jsonSchema, example } from './contracts.js';

export const instructions = `# AgentToolbox retry gate — experiment v0.1.0

Payments: dev. Price and maximum possible charge: 0 USDC atomic units. No wallet or account needed.
Advice only: you execute the retry. The correct answer is often stop.
Supported: HTTP 429/500/502/503/504; network ETIMEDOUT/ECONNRESET;
MCP TIMEOUT/CONNECTION_RESET/RATE_LIMITED/UNAVAILABLE from a trusted adapter.
Generic MCP isError/internal errors are not enough evidence. Authentication, missing
resources, business errors, browser state and unknown cases stop.

1. POST /v1/recover with the example below. Optional Idempotency-Key must be a
   random 32–128 character token; reuse it with the same inputs after transport failure.
2. If action=stop, do not retry. Otherwise POST /v1/recover/{recovery_id}/accept
   with {"accept":true,"max_price_usdc_atomic":0} before executing anything.
3. Wait retry_after_ms AFTER acceptance, then retry the same operation once.
   Writes require an upstream-supported idempotency key and identical payload.
4. POST /v1/recover/{recovery_id}/result with outcome, retry_attempts:1,
   completed and evidence. Success needs final HTTP 2xx or MCP isError=false,
   plus digest_sha256 of your local evidence. Never send raw tool output.
5. GET /v1/recover/{recovery_id} for the receipt. POST /v1/feedback with
   recovery_id, helpful and reason. Stop on another upstream failure.

Quotes expire in five minutes. At most five total attempts, one recommended retry,
30 seconds wait and 8192 request bytes. Limits can be lower, including zero price.
The caller must maintain its total attempt budget across quotes.
Success is agent self-report, not independent verification. A hash is only a reference.
Keep recovery IDs private: they grant access to that dev receipt and its result.
No credentials, URLs, cookies, authorization payloads or task history. Free-text
messages are discarded. Optional agent_id is a random pseudonym for repeat-use counting.
Learning records expire after 24 hours; deletion is opportunistic on the next quote
or local stats run. Minimal dev payment events and non-identifying daily usage counters are retained
separately until an explicit database reset. No live revenue. No measured product-market fit.
Rate limits can return 429; storage capacity can return 503. Do not automatically
retry AgentToolbox itself in an unbounded loop.

Schema: /openapi.json
MCP: /mcp (stateless Streamable HTTP; no account/API key)
Health: /health

Example recovery request:
${JSON.stringify(example, null, 2)}
`;

export function openapi() {
  const schemas = { RecoveryRequest: jsonSchema(recoverSchema), AcceptRequest: jsonSchema(acceptSchema), ResultRequest: jsonSchema(resultSchema), FeedbackRequest: jsonSchema(feedbackSchema),
    Error: { type: 'object', required: ['error'], properties: { error: { type: 'string' } }, additionalProperties: false },
    Receipt: { type: 'object', required: ['recovery_id', 'state', 'recoverable', 'reason', 'action', 'mode', 'price_usdc_atomic', 'max_charge_usdc_atomic', 'amount_settled_usdc_atomic', 'payment_status', 'evidence'], properties: {
      recovery_id: { type: 'string', format: 'uuid' }, product: { const: 'retry-gate' }, version: { const: '0.1.0' },
      state: { enum: ['quoted', 'accepted', 'declined', 'stopped', 'expired', 'completed'] },
      recoverable: { type: 'boolean' }, reason: { type: 'string' }, action: { enum: ['stop', 'retry', 'wait_then_retry'] },
      retry_after_ms: { type: 'integer', minimum: 0, maximum: 30000 }, max_attempts: { type: 'integer', minimum: 0, maximum: 1 }, instructions: { type: 'string' },
      mode: { const: 'dev' }, asset: { const: 'USDC' }, network: { type: 'null' },
      price_usdc_atomic: { const: 0 }, max_charge_usdc_atomic: { const: 0 }, amount_settled_usdc_atomic: { const: 0 },
      payment_status: { const: 'dev_no_charge' }, settlement_reference: { type: 'null' },
      created_at: { type: 'string', format: 'date-time' }, expires_at: { type: 'string', format: 'date-time' }, accepted_at: { type: ['string', 'null'], format: 'date-time' },
      outcome: { enum: ['success', 'failure', 'unverifiable', null] }, eligible_success: { type: 'boolean' }, time_to_recovery_ms: { type: ['integer', 'null'] },
      success_condition: { type: 'object', properties: { rule: { const: 'agent_reported_success_v1' }, evidence_type: { enum: ['http', 'mcp'] }, description: { type: 'string' } } },
      evidence: { type: 'object', properties: { source: { enum: ['agent_self_report', 'none'] }, independently_verified: { const: false }, digest_sha256: { type: ['string', 'null'] } } },
    } },
    FeedbackResponse: { type: 'object', required: ['recorded', 'recovery_id'], properties: { recorded: { const: true }, recovery_id: { type: 'string', format: 'uuid' } } },
  };
  const content = name => ({ 'application/json': { schema: { $ref: `#/components/schemas/${name}` } } });
  const errors = Object.fromEntries([400, 403, 404, 405, 409, 410, 413, 415, 429, 500, 503].map(code => [code, { description: 'Machine-readable error; no input echoed. 409 conflicts are terminal for this input; 410 means expired.', content: content('Error') }]));
  const route = (operationId, input, output = 'Receipt') => ({ operationId, ...(input ? { requestBody: { required: true, content: content(input) } } : {}), responses: { 200: { description: 'No-charge dev response', content: content(output) }, ...errors } });
  const rid = { name: 'recovery_id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
  return { openapi: '3.1.0', info: { title: 'AgentToolbox retry gate (dev only)', version: '0.1.0', description: 'No charge. Five-minute quotes; self-reported outcomes. 8192-byte bodies. Keep recovery IDs private.' }, servers: [{ url: '/' }],
    paths: {
      '/v1/recover': { post: { ...route('recover', 'RecoveryRequest'), parameters: [{ name: 'Idempotency-Key', in: 'header', schema: { type: 'string', minLength: 32, maxLength: 128, pattern: '^[a-zA-Z0-9_-]+$' }, description: 'Optional random key, same semantic input returns same quote for 24h; changed input conflicts. Free text is ignored.' }] } },
      '/v1/recover/{recovery_id}': { parameters: [rid], get: route('receipt') },
      '/v1/recover/{recovery_id}/accept': { parameters: [rid], post: route('accept', 'AcceptRequest') },
      '/v1/recover/{recovery_id}/result': { parameters: [rid], post: route('result', 'ResultRequest') },
      '/v1/feedback': { post: route('feedback', 'FeedbackRequest', 'FeedbackResponse') },
      '/health': { get: { operationId: 'health', responses: { 200: { description: 'Liveness only, not dependency readiness', content: { 'application/json': { schema: { type: 'object', properties: { ok: { const: true }, payments: { const: 'dev' } } } } } } } } },
      '/': { get: { responses: { 200: { description: 'Static HTML, Markdown or JSON discovery according to Accept.' } } } },
      '/llms.txt': { get: { responses: { 200: { description: 'Plain-text agent instructions.' } } } },
      '/openapi.json': { get: { responses: { 200: { description: 'This OpenAPI document.' } } } },
      '/mcp': { post: { description: 'Official MCP Streamable HTTP JSON-RPC transport. Use an MCP client; tools share the /v1 schemas.', responses: { 200: { description: 'JSON-RPC response' }, 202: { description: 'Notification accepted' }, 400: { description: 'Invalid JSON-RPC input' }, 406: { description: 'Accept must include application/json and text/event-stream' } } }, get: { responses: { 405: { description: 'No SSE stream' } } }, delete: { responses: { 405: { description: 'Stateless: no session to delete' } } } },
    }, components: { schemas } };
}

export function landing() {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AgentToolbox retry gate</title><style>body{font:18px/1.6 system-ui;max-width:760px;margin:4rem auto;padding:0 1rem;color:#18312d;background:#f5f7f2}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#e8ede4;padding:1rem}a{color:#13594c}</style><main><h1>Retry only when the evidence supports it.</h1><p>AgentToolbox is a narrow retry-gate experiment for API and MCP failures. It gives deterministic advice; your agent executes the retry. The correct answer is often “do not retry.”</p><p><strong>Payments: dev · Maximum charge: 0 USDC.</strong> No account, API key or wallet needed.</p><p><a href="/llms.txt">Agent instructions</a> · <a href="/openapi.json">OpenAPI</a> · MCP endpoint: <code>/mcp</code></p><h2>One bounded retry</h2><p>Known rate limits, temporary HTTP failures and allowlisted transport errors only. State-changing actions require confirmed upstream idempotency. Five-minute quotes, at most 30 seconds waiting. No credentials or arbitrary URL fetching.</p><h2>What a receipt means</h2><p>Completion is reported by the caller. An evidence digest is a reference, not independent proof. No payment has been integrated or received by this dev service.</p><h2>Data retained</h2><p>Allowlisted learning records expire after 24 hours and are deleted on the next quote or local stats run. Minimal dev payment events and non-identifying daily usage counters are kept separately until explicit database reset. Messages, keys and task bodies are never retained. Keep recovery IDs private.</p><pre>${JSON.stringify(example, null, 2)}</pre></main></html>`;
}
