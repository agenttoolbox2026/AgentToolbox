import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { recoverSchema, acceptSchema, resultSchema, feedbackSchema, key, id } from './contracts.js';
import { ApiError } from './service.js';

export async function mcp(request, service, parsedBody) {
  if (request.method !== 'POST') return Response.json({ error: 'method_not_allowed' }, { status: 405, headers: { Allow: 'POST' } });
  const server = new McpServer({ name: 'agenttoolbox-retry-gate', version: '0.1.0' }, { instructions: 'Dev only: all charges zero. Use retry_gate_recover after a supported transient failure. Accept, wait, execute one retry yourself, report result and feedback. Never send secrets. Outcomes are self-reported.' });
  const register = (name, description, inputSchema, callback, readOnly = false) => server.registerTool(name, {
    description, inputSchema, annotations: { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: name !== 'retry_gate_recover', openWorldHint: false },
  }, async (input) => {
    try { const data = await callback(input); return { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data }; }
    catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: e instanceof ApiError ? e.code : 'internal_error' }) }] }; }
  });
  register('retry_gate_recover', 'Get a FREE deterministic quote for HTTP 429/500/502/503/504, network ETIMEDOUT/ECONNRESET, or MCP TIMEOUT/CONNECTION_RESET/RATE_LIMITED/UNAVAILABLE from trusted error metadata. Unknown, auth, business and browser failures STOP. You execute the retry. Set read_only truthfully; writes need an upstream-supported idempotency key. max_attempts is TOTAL including the failed call, capped at 5; max_wait_ms <=30000; max_price_usdc_atomic may be 0. If recoverable, call retry_gate_accept, wait retry_after_ms AFTER acceptance, retry SAME payload ONCE, then retry_gate_result. Quotes expire in 5 minutes. Use a random idempotency_key for replay safety. No credentials or URLs. Keep recovery_id private. No payments or independent outcome verification.',
    z.strictObject({ request: recoverSchema, idempotency_key: key.optional() }), ({ request, idempotency_key }) => service.recover(request, idempotency_key));
  register('retry_gate_accept', 'Accept or decline the disclosed free quote before executing the retry. Use max_price_usdc_atomic:0. Wait the receipt retry_after_ms AFTER acceptance. Duplicate identical accept is safe; changing it conflicts.',
    z.strictObject({ recovery_id: id, ...acceptSchema.shape }), ({ recovery_id, ...body }) => service.accept(recovery_id, body));
  register('retry_gate_result', 'After acceptance and the required wait, report exactly ONE retry. Success requires completed:true, evidence.type matching the quote, final_status:2xx for HTTP or mcp_is_error:false for MCP, and a SHA-256 digest of local evidence. No raw output. Failures/unverifiable evidence never qualify; every dev result is uncharged. Stop on another upstream failure. Duplicate identical reports are safe; conflicting reports are rejected.',
    z.strictObject({ recovery_id: id, ...resultSchema.shape }), ({ recovery_id, ...body }) => service.result(recovery_id, body));
  register('retry_gate_receipt', 'Inspect a dev receipt using its private recovery_id. Outcome is self-report; zero charge. No login required.', z.strictObject({ recovery_id: id }), ({ recovery_id }) => service.receipt(recovery_id), true);
  register('retry_gate_feedback', 'Report helpfulness and operator effort once for a recovery. Allowed reason: saved_time, prevented_unsafe_retry, unnecessary, wrong_rule, other. No free text or task data.', feedbackSchema, body => service.feedback(body));
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true, maxRequestBodySize: 8192 });
  await server.connect(transport);
  try { return await transport.handleRequest(request, { parsedBody }); }
  finally { await server.close(); }
}
