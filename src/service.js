import { recoverSchema, acceptSchema, resultSchema, feedbackSchema, key, id } from './contracts.js';
import { decide } from './recovery.js';
import { devPayments, qualifies, SUCCESS_RULE } from './payments.js';

export class ApiError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export function parse(schema, value) {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, 'invalid_input'); // Never echo sensitive values.
  return parsed.data;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export async function hash(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(canonical(value)));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function createService(db, { mode = 'dev', clock = Date.now } = {}) {
  const payment = devPayments(mode); // Fail closed for testnet/live.
  const statement = (sql, ...args) => db.prepare(sql).bind(...args);
  const lookup = (rid) => statement('SELECT * FROM recoveries WHERE id = ? AND delete_after_ms > ?', rid, clock()).first();
  async function required(rid) {
    parse(id, rid);
    const row = await lookup(rid);
    if (!row) throw new ApiError(404, 'recovery_not_found');
    return row;
  }
  async function receipt(rid) {
    const r = await required(rid);
    const [a, result] = await Promise.all([
      statement('SELECT * FROM acceptances WHERE recovery_id = ?', rid).first(),
      statement('SELECT * FROM results WHERE recovery_id = ?', rid).first(),
    ]);
    let decision = JSON.parse(r.decision_json);
    const state = result ? 'completed' : a?.accepted === 0 ? 'declined' : !r.recoverable ? 'stopped' : clock() >= r.expires_ms ? 'expired' : a ? 'accepted' : 'quoted';
    if (['completed', 'declined', 'expired'].includes(state)) decision = {
      recoverable: false, reason: state === 'completed' ? 'result_recorded' : `quote_${state}`,
      action: 'stop', retry_after_ms: 0, max_attempts: 0,
      instructions: 'This recovery is terminal. Do not execute another retry under this quote.',
    };
    return { recovery_id: rid, product: 'retry-gate', version: '0.1.0', state,
      ...decision, ...payment, created_at: new Date(r.created_ms).toISOString(),
      expires_at: new Date(r.expires_ms).toISOString(),
      success_condition: { rule: SUCCESS_RULE, evidence_type: r.evidence_type,
        description: 'Exactly one retry, completed=true, final HTTP 2xx or MCP isError=false matching evidence_type, and SHA-256 evidence digest. Caller self-report only.' },
      outcome: result?.outcome ?? null, eligible_success: result ? !!result.eligible : false,
      evidence: { source: result ? 'agent_self_report' : 'none', independently_verified: false, digest_sha256: result?.evidence_hash ?? null },
      time_to_recovery_ms: result ? result.created_ms - r.created_ms : null,
      accepted_at: a?.accepted ? new Date(a.created_ms).toISOString() : null,
    };
  }
  async function recover(input, idempotencyKey) {
    const started = performance.now();
    const r = parse(recoverSchema, input);
    const suppliedKey = idempotencyKey !== undefined ? parse(key, idempotencyKey) : crypto.randomUUID();
    // Remove arbitrary free text before hashing. It never reaches any stored record.
    const { redacted_message: _discard, ...failure } = r.failure;
    const fingerprint = await hash({ ...r, failure });
    const idem = await hash(suppliedKey);
    const now = clock();
    const rid = crypto.randomUUID();
    const decision = decide(r, now);
    const [agentHash, operationHash] = await Promise.all([r.agent_id ? hash(r.agent_id) : null, hash(r.operation)]);
    await db.batch([
      statement('DELETE FROM recoveries WHERE delete_after_ms <= ?', now),
      statement(`INSERT INTO recoveries(id,idem_hash,request_hash,created_ms,expires_ms,delete_after_ms,recoverable,decision_json,evidence_type,attempts_before,agent_hash,discovery_source,latency_ms,operation_hash)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM recoveries) < 10000
        AND (SELECT COUNT(*) FROM payment_events) < 100000
        ON CONFLICT DO NOTHING`, rid, idem, fingerprint, now, now + 300_000, now + 86_400_000,
        Number(decision.recoverable), JSON.stringify(decision), r.failure.kind === 'mcp' ? 'mcp' : 'http', r.attempts_so_far,
        agentHash, r.discovery_source ?? 'unknown', Math.max(0, Math.ceil(performance.now() - started)), operationHash),
    ]);
    const row = await statement('SELECT id,request_hash FROM recoveries WHERE idem_hash = ?', idem).first();
    if (!row) throw new ApiError(503, 'experiment_capacity_reached');
    if (row.request_hash !== fingerprint) throw new ApiError(409, 'idempotency_conflict');
    return receipt(row.id);
  }
  async function accept(rid, input) {
    const body = parse(acceptSchema, input);
    await required(rid);
    await statement(`INSERT INTO acceptances(recovery_id,accepted,cap_atomic,created_ms)
      SELECT id,?,?,? FROM recoveries WHERE id = ? AND recoverable = 1 AND expires_ms > ?
      ON CONFLICT DO NOTHING`, Number(body.accept), body.max_price_usdc_atomic, clock(), rid, clock()).run();
    const a = await statement('SELECT * FROM acceptances WHERE recovery_id = ?', rid).first();
    if (!a) {
      const r = await required(rid);
      throw new ApiError(clock() >= r.expires_ms ? 410 : 409, clock() >= r.expires_ms ? 'quote_expired' : 'recommendation_stopped');
    }
    if (a.accepted !== Number(body.accept) || a.cap_atomic !== body.max_price_usdc_atomic) throw new ApiError(409, 'acceptance_conflict');
    return receipt(rid);
  }
  async function result(rid, input) {
    const body = parse(resultSchema, input);
    const fingerprint = await hash(body);
    const r = await required(rid);
    const eligible = qualifies(body, r.evidence_type);
    const now = clock();
    const wait = JSON.parse(r.decision_json).retry_after_ms;
    await statement(`INSERT INTO results(recovery_id,fingerprint,created_ms,outcome,eligible,evidence_type,evidence_hash,result_json)
      SELECT r.id,?,?,?,?,?,?,? FROM recoveries r JOIN acceptances a ON a.recovery_id = r.id
      WHERE r.id = ? AND a.accepted = 1 AND r.expires_ms > ? AND a.created_ms + ? <= ?
      ON CONFLICT DO NOTHING`, fingerprint, now, body.outcome, Number(eligible), body.evidence.type,
      body.evidence.digest_sha256 ?? null, JSON.stringify(body), rid, now, wait, now).run();
    const stored = await statement('SELECT fingerprint FROM results WHERE recovery_id = ?', rid).first();
    if (!stored) throw new ApiError(now >= r.expires_ms ? 410 : 409, now >= r.expires_ms ? 'quote_expired' : 'accept_and_wait_before_result');
    if (stored.fingerprint !== fingerprint) throw new ApiError(409, 'result_conflict');
    return receipt(rid);
  }
  async function feedback(input) {
    const b = parse(feedbackSchema, input);
    await required(b.recovery_id);
    const fingerprint = await hash(b);
    await statement(`INSERT INTO feedback(recovery_id,fingerprint,created_ms,helpful,reason,operator_effort_ms)
      VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING`, b.recovery_id, fingerprint, clock(), Number(b.helpful), b.reason, b.operator_effort_ms ?? null).run();
    const saved = await statement('SELECT fingerprint FROM feedback WHERE recovery_id = ?', b.recovery_id).first();
    if (saved.fingerprint !== fingerprint) throw new ApiError(409, 'feedback_conflict');
    return { recorded: true, recovery_id: b.recovery_id };
  }
  return { recover, accept, result, receipt, feedback, payment };
}
