import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startServer } from './dev.js';
import { stats } from './stats.js';
import { example } from '../src/contracts.js';
import { hash } from '../src/service.js';

// Controlled fixtures only: the product never receives/fetches these URLs.
const attempts = new Map();
const firstAt = new Map();
const upstream = createServer((req, res) => {
  const count = (attempts.get(req.url) ?? 0) + 1; attempts.set(req.url, count);
  if (count === 1) firstAt.set(req.url, Date.now());
  if (req.url.includes('catalog') && Date.now() - firstAt.get(req.url) < 1000) {
    res.writeHead(429, { 'Retry-After': '1' }); res.end('rate limited');
  } else if (req.url.includes('inventory') && count === 1) {
    res.writeHead(503, { 'Retry-After': '0' }); res.end('temporarily unavailable');
  } else { res.writeHead(200); res.end('fixture completed'); }
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
const upstreamOrigin = `http://127.0.0.1:${upstream.address().port}`;
mkdirSync('.data', { recursive: true });
const dbPath = `.data/trial-${Date.now()}.sqlite`;
const running = await startServer({ port: 0, database: dbPath });
const client = new Client({ name: 'codex-controlled-trial', version: '0.1.0' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const agentId = crypto.randomUUID();
const records = [];
try {
  const discovery = await fetch(running.origin + '/llms.txt');
  if (!discovery.ok) throw Error('discovery failed');
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', running.origin)));
  const tools = await client.listTools();
  async function call(name, args) {
    const response = await client.callTool({ name, arguments: args });
    if (response.isError) throw Error(JSON.stringify(response.content));
    return response.structuredContent;
  }
  for (const task of ['catalog', 'inventory', 'unsafe_order', 'catalog_return']) {
    for (const method of ['baseline_informed', 'gate']) {
      const started = performance.now();
      const path = `/${method}/${task}`;
      if (task === 'unsafe_order') {
        // Injected timeout with uncertain side effect: no actual order is sent.
        let decision = 'stop';
        if (method === 'gate') {
          const q = await call('retry_gate_recover', { request: { ...example, operation: 'order.submit', failure: { kind: 'network', code: 'ETIMEDOUT' }, safety: { read_only: false }, agent_id: agentId, discovery_source: 'mcp' }, idempotency_key: crypto.randomUUID() });
          decision = q.action;
          await call('retry_gate_feedback', { recovery_id: q.recovery_id, helpful: false, reason: 'unnecessary', operator_effort_ms: 0 });
        }
        records.push({ task, method, correct: decision === 'stop', action: decision, retries: 0, elapsed_ms: +(performance.now() - started).toFixed(2) });
        continue;
      }
      const initial = await fetch(upstreamOrigin + path);
      let wait = Number(initial.headers.get('retry-after')) * 1000;
      let q, latency;
      if (method === 'gate') {
        const before = performance.now();
        q = await call('retry_gate_recover', { request: { ...example, operation: `${task}.read`, failure: { kind: 'http', status: initial.status, headers: { 'retry-after': initial.headers.get('retry-after') } }, agent_id: agentId, discovery_source: 'mcp' }, idempotency_key: crypto.randomUUID() });
        latency = +(performance.now() - before).toFixed(2);
        if (!q.recoverable) throw Error('unexpected stop');
        await call('retry_gate_accept', { recovery_id: q.recovery_id, accept: true, max_price_usdc_atomic: 0 });
        wait = q.retry_after_ms;
      }
      await sleep(wait);
      const retried = await fetch(upstreamOrigin + path);
      const resultText = await retried.text();
      let receipt;
      if (q) {
        receipt = await call('retry_gate_result', { recovery_id: q.recovery_id, outcome: retried.ok ? 'success' : 'failure', retry_attempts: 1, completed: retried.ok,
          evidence: { type: 'http', final_status: retried.status, digest_sha256: await hash(resultText) } });
        await call('retry_gate_feedback', { recovery_id: q.recovery_id, helpful: false, reason: 'unnecessary', operator_effort_ms: 0 });
      }
      records.push({ task, method, correct: retried.ok, attempts: attempts.get(path), elapsed_ms: +(performance.now() - started).toFixed(2), recommendation_latency_ms: latency ?? null,
        receipt_state: receipt?.state ?? null, amount_settled_usdc_atomic: receipt?.amount_settled_usdc_atomic ?? 0 });
    }
  }
  const report = { trial_type: 'designer-assisted local fixture; not an independent agent or customer', recorded_at: new Date().toISOString(), payments: 'dev', tool_names: tools.tools.map(t => t.name), records, metrics: stats(running.db),
    interpretation: 'Both informed baseline and helper should solve the supported fixtures. This checks integration and instrumentation, not added customer value. The shared pseudonym is a scripted repeat, not organic retention.' };
  writeFileSync('docs/trial-results.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.close(); await running.close(); await new Promise(resolve => upstream.close(resolve));
}
