import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { example } from '../src/contracts.js';
const origin = process.argv[2] ?? 'http://127.0.0.1:8787';
async function get(path) { const r = await fetch(origin + path); assert.equal(r.status, 200); return r.json(); }
async function post(path, body, headers = {}) {
  const r = await fetch(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const value = await r.json(); assert.equal(r.status, 200, JSON.stringify(value)); return value;
}
assert.equal((await get('/health')).payments, 'dev');
assert.equal((await get('/openapi.json')).openapi, '3.1.0');
const request = { ...example, failure: { kind: 'http', status: 503, headers: { 'retry-after': '0' } } };
const key = crypto.randomUUID();
const quotes = await Promise.all(Array.from({ length: 4 }, () => post('/v1/recover', request, { 'Idempotency-Key': key })));
assert.equal(new Set(quotes.map(q => q.recovery_id)).size, 1);
const rid = quotes[0].recovery_id;
await post(`/v1/recover/${rid}/accept`, { accept: true, max_price_usdc_atomic: 0 });
const body = { outcome: 'success', retry_attempts: 1, completed: true, evidence: { type: 'http', final_status: 200, digest_sha256: 'c'.repeat(64) } };
const results = await Promise.all(Array.from({ length: 4 }, () => post(`/v1/recover/${rid}/result`, body)));
assert.ok(results.every(r => r.eligible_success && r.amount_settled_usdc_atomic === 0 && r.action === 'stop'));
await post('/v1/feedback', { recovery_id: rid, helpful: true, reason: 'saved_time' });
assert.equal((await get(`/v1/recover/${rid}`)).state, 'completed');
const client = new Client({ name: 'local-worker-smoke', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin)));
  assert.equal((await client.listTools()).tools.length, 5);
  const stopped = await client.callTool({ name: 'retry_gate_recover', arguments: { request: { ...example, safety: { read_only: false } } } });
  assert.equal(stopped.structuredContent.action, 'stop');
} finally { await client.close(); }
console.log(JSON.stringify({ status: 'passed', origin, http: 'concurrent quote/result idempotency; accept; feedback; receipt', mcp: 'SDK discovery and unsafe-write stop', recovery_id: rid, mode: 'dev' }));
