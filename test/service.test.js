import test from 'node:test';
import assert from 'node:assert/strict';
import { localDatabase } from '../scripts/local-db.js';
import { createService } from '../src/service.js';
import { example } from '../src/contracts.js';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function fixture() {
  let now = Date.parse('2026-10-05T12:00:00Z');
  const db = localDatabase();
  return { db, service: createService(db, { clock: () => now }), advance: ms => now += ms };
}
const accepted = { accept: true, max_price_usdc_atomic: 0 };
const good = { outcome: 'success', retry_attempts: 1, completed: true, evidence: { type: 'http', final_status: 200, digest_sha256: 'a'.repeat(64) } };

test('concurrent quote/result submissions create one receipt and ledger event each', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const key = crypto.randomUUID();
  const quotes = await Promise.all(Array.from({ length: 12 }, () => f.service.recover(example, key)));
  assert.equal(new Set(quotes.map(q => q.recovery_id)).size, 1);
  const rid = quotes[0].recovery_id;
  assert.equal(quotes[0].max_charge_usdc_atomic, 0);
  const a = await Promise.all(Array.from({ length: 8 }, () => f.service.accept(rid, accepted)));
  assert.ok(a.every(x => x.state === 'accepted'));
  await assert.rejects(f.service.result(rid, good), /accept_and_wait/);
  f.advance(1000);
  const results = await Promise.all(Array.from({ length: 12 }, () => f.service.result(rid, good)));
  assert.ok(results.every(r => r.eligible_success && r.amount_settled_usdc_atomic === 0));
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n, 3);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM results').get().n, 1);
  assert.equal(results[0].evidence.independently_verified, false);
  await assert.rejects(f.service.recover({ ...example, operation: 'changed' }, key), /idempotency_conflict/);
  await assert.rejects(f.service.result(rid, { ...good, outcome: 'failure' }), /result_conflict/);
  await assert.rejects(f.service.accept(rid, { ...accepted, accept: false }), /acceptance_conflict/);
});
test('failed, incomplete and mismatched evidence never qualifies or charges', async t => {
  const f = fixture(); t.after(() => f.db.close());
  for (const body of [
    { ...good, outcome: 'failure' }, { ...good, outcome: 'unverifiable' }, { ...good, completed: false },
    { ...good, evidence: { type: 'http', final_status: 200 } },
    { ...good, evidence: { ...good.evidence, final_status: 500 } },
    { ...good, evidence: { type: 'mcp', mcp_is_error: false, digest_sha256: 'a'.repeat(64) } },
  ]) {
    const q = await f.service.recover(example);
    await f.service.accept(q.recovery_id, accepted); f.advance(1000);
    const r = await f.service.result(q.recovery_id, body);
    assert.equal(r.eligible_success, false); assert.equal(r.amount_settled_usdc_atomic, 0);
  }
});
test('unaccepted, declined, stopped and expired quotes cannot complete', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const q = await f.service.recover(example);
  await assert.rejects(f.service.result(q.recovery_id, good), /accept_and_wait/);
  await f.service.accept(q.recovery_id, { ...accepted, accept: false });
  f.advance(1000);
  await assert.rejects(f.service.result(q.recovery_id, good), /accept_and_wait/);
  assert.equal((await f.service.receipt(q.recovery_id)).state, 'declined');
  const stopped = await f.service.recover({ ...example, safety: { read_only: false } });
  await assert.rejects(f.service.accept(stopped.recovery_id, accepted), /recommendation_stopped/);
  const expired = await f.service.recover(example);
  await f.service.accept(expired.recovery_id, accepted);
  f.advance(300000);
  assert.equal((await f.service.receipt(expired.recovery_id)).state, 'expired');
  assert.equal((await f.service.receipt(expired.recovery_id)).action, 'stop');
  await assert.rejects(f.service.result(expired.recovery_id, good), /quote_expired/);
  const notAccepted = await f.service.recover(example); f.advance(300000);
  await assert.rejects(f.service.accept(notAccepted.recovery_id, accepted), /quote_expired/);
});
test('MCP success needs matching non-error evidence', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const q = await f.service.recover({ ...example, failure: { kind: 'mcp', code: 'TIMEOUT' } });
  await f.service.accept(q.recovery_id, accepted); f.advance(1000);
  const r = await f.service.result(q.recovery_id, { ...good, evidence: { type: 'mcp', mcp_is_error: false, digest_sha256: 'b'.repeat(64) } });
  assert.equal(r.eligible_success, true);
});
test('ledger is append-only, atomic with state and excluded from live revenue', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const q = await f.service.recover(example);
  assert.throws(() => f.db.sqlite.exec('UPDATE payment_events SET settled_atomic=1'), /append_only/);
  assert.throws(() => f.db.sqlite.exec('DELETE FROM payment_events'), /append_only/);
  assert.throws(() => f.db.sqlite.exec("INSERT INTO payment_events(event_id,time_ms,recovery_id,event_type,mode) VALUES('bad',1,'r','settled','live')"), /CHECK constraint/);
  f.db.sqlite.exec("CREATE TRIGGER test_fail BEFORE INSERT ON payment_events WHEN NEW.event_type='accepted_dev' BEGIN SELECT RAISE(ABORT,'forced_failure'); END;");
  await assert.rejects(f.service.accept(q.recovery_id, accepted), /forced_failure/);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM acceptances').get().n, 0);
  assert.throws(() => createService(f.db, { mode: 'live' }), /Only no-charge/);
});
test('free text, raw operation, upstream keys and agent pseudonyms are not persisted; retention purges learning records', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const agent = crypto.randomUUID();
  const r = { ...example, operation: 'secret-tool-label', agent_id: agent, safety: { read_only: false, idempotency_supported: true, idempotency_key: 'sensitive-upstream-key' }, failure: { ...example.failure, redacted_message: 'SECRET_MUST_NOT_PERSIST' } };
  const q = await f.service.recover(r);
  await f.service.feedback({ recovery_id: q.recovery_id, helpful: true, reason: 'saved_time', operator_effort_ms: 0 });
  const stored = JSON.stringify(['recoveries', 'payment_events', 'feedback'].flatMap(table => f.db.sqlite.prepare(`SELECT * FROM ${table}`).all()));
  for (const secret of ['secret-tool-label', 'sensitive-upstream-key', 'SECRET_MUST_NOT_PERSIST', agent]) assert.equal(stored.includes(secret), false);
  f.advance(86400001);
  await assert.rejects(f.service.receipt(q.recovery_id), /not_found/);
  await f.service.recover(example);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 0);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) AS n FROM payment_events').get().n, 2);
});

test('daily aggregates are idempotent, atomic, private and survive learning expiry', async t => {
  const f = fixture(); t.after(() => f.db.close());
  const key = crypto.randomUUID();
  const quotes = await Promise.all(Array.from({ length: 4 }, () => f.service.recover(example,key)));
  const rid = quotes[0].recovery_id;
  await Promise.all(Array.from({ length: 4 }, () => f.service.accept(rid,accepted)));
  f.advance(1000);
  await Promise.all(Array.from({ length: 4 }, () => f.service.result(rid,good)));
  await Promise.all(Array.from({ length: 4 }, () => f.service.feedback({ recovery_id:rid, helpful:true, reason:'saved_time' })));
  await f.service.recover({ ...example,safety:{ read_only:false } });
  const expected = { day:'2026-10-05',quotes:2,stopped:1,accepted:1,declined:0,results:1,eligible_self_reports:1,helpful:1,unhelpful:0 };
  assert.deepEqual({ ...f.db.sqlite.prepare('SELECT * FROM daily_usage').get() },expected);
  const q = await f.service.recover(example);
  f.db.sqlite.exec("CREATE TRIGGER aggregate_fail BEFORE INSERT ON payment_events WHEN NEW.event_type='accepted_dev' BEGIN SELECT RAISE(ABORT,'aggregate_rollback'); END;");
  await assert.rejects(f.service.accept(q.recovery_id,accepted),/aggregate_rollback/);
  assert.equal(f.db.sqlite.prepare('SELECT accepted FROM daily_usage').get().accepted,1);
  f.advance(86400001);
  await f.service.recover(example);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM recoveries').get().n,1);
  assert.equal(f.db.sqlite.prepare("SELECT quotes FROM daily_usage WHERE day='2026-10-05'").get().quotes,3);
  assert.equal(f.db.sqlite.prepare("SELECT quotes FROM daily_usage WHERE day='2026-10-06'").get().quotes,1);
  const sql = readFileSync(new URL('../scripts/report-d1.sql',import.meta.url),'utf8');
  // The reporting file must work with SQLite/D1 query-only protection enabled.
  f.db.sqlite.exec('PRAGMA query_only=ON');
  f.db.sqlite.exec(sql);
});

test('local migrations apply once when an existing database is reopened', t => {
  const dir = mkdtempSync(join(tmpdir(),'agenttoolbox-migrations-'));
  t.after(() => rmSync(dir,{ recursive:true,force:true }));
  const path = join(dir,'test.sqlite');
  let db = localDatabase(path);
  db.sqlite.exec("INSERT INTO daily_usage(day,quotes) VALUES('2026-10-05',7)");
  const coverage = db.sqlite.prepare('SELECT started_at FROM usage_coverage').get().started_at;
  db.close(); db = localDatabase(path); t.after(() => db.close());
  assert.equal(db.sqlite.prepare('SELECT quotes FROM daily_usage').get().quotes,7);
  assert.equal(db.sqlite.prepare('SELECT started_at FROM usage_coverage').get().started_at,coverage);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM local_schema_migrations').get().n,2);
});
