import { localDatabase } from './local-db.js';

export function stats(db, now = Date.now()) {
  db.sqlite.prepare('DELETE FROM recoveries WHERE delete_after_ms <= ?').run(now);
  const rows = db.sqlite.prepare(`SELECT r.*, a.accepted, s.outcome, s.eligible, s.created_ms AS result_ms,
    s.result_json, f.helpful, f.operator_effort_ms FROM recoveries r
    LEFT JOIN acceptances a ON a.recovery_id=r.id LEFT JOIN results s ON s.recovery_id=r.id
    LEFT JOIN feedback f ON f.recovery_id=r.id`).all();
  const group = fn => Object.fromEntries([...new Set(rows.map(fn))].map(k => [k, rows.filter(r => fn(r) === k).length]));
  const agents = new Map();
  for (const row of rows) if (row.agent_hash) agents.set(row.agent_hash, (agents.get(row.agent_hash) ?? 0) + 1);
  const sums = { time_ms: 0, tokens: 0, usdc_atomic: 0 };
  for (const r of rows) for (const k of Object.keys(sums)) sums[k] += (r.result_json ? JSON.parse(r.result_json).savings?.[k] : 0) ?? 0;
  return {
    mode: 'dev', window: 'unexpired 24-hour learning records', calls: rows.length,
    recommendations: group(r => JSON.parse(r.decision_json).reason),
    actions: group(r => JSON.parse(r.decision_json).action), discovery: group(r => r.discovery_source),
    accepted_quotes: rows.filter(r => r.accepted === 1).length,
    outcomes: group(r => r.outcome ?? 'not_reported'),
    eligible_self_reported_successes: rows.filter(r => r.eligible === 1).length,
    repeat_pseudonyms: [...agents.values()].filter(n => n > 1).length,
    attempts_before: rows.reduce((n, r) => n + r.attempts_before, 0),
    reported_retry_attempts: rows.filter(r => r.result_json).length,
    recovery_times_ms: rows.filter(r => r.result_ms).map(r => r.result_ms - r.created_ms),
    decision_latency_ms: rows.map(r => r.latency_ms),
    helpful: rows.filter(r => r.helpful === 1).length,
    reported_operator_effort_ms: rows.reduce((n, r) => n + (r.operator_effort_ms ?? 0), 0),
    reported_savings: sums, savings_independently_verified: false,
    cost_to_serve_usdc_atomic: null, cost_status: 'unmeasured; decision latency is only a proxy',
    settled_usdc_atomic: 0, mainnet_revenue_usdc_atomic: 0,
    ledger_events: db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n,
  };
}
if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const db = localDatabase(process.argv[2] ?? '.data/agenttoolbox.sqlite');
  console.log(JSON.stringify(stats(db), null, 2)); db.close();
}
