import test from 'node:test';
import assert from 'node:assert/strict';
import { decide } from '../src/recovery.js';
import { example, recoverSchema } from '../src/contracts.js';
const now = Date.parse('2026-10-05T12:00:00Z');
const request = (patch = {}) => ({ ...structuredClone(example), ...patch });

test('supported HTTP statuses and transport codes are bounded and deterministic', () => {
  for (const status of [429, 500, 502, 503, 504]) {
    const r = request({ failure: { kind: 'http', status } });
    assert.deepEqual(decide(r, now), decide(r, now));
    assert.equal(decide(r, now).max_attempts, 1);
  }
  for (const [kind, code] of [['network', 'ETIMEDOUT'], ['network', 'ECONNRESET'], ['mcp', 'TIMEOUT'], ['mcp', 'UNAVAILABLE'], ['mcp', 'CONNECTION_RESET'], ['mcp', 'RATE_LIMITED']]) {
    assert.equal(decide(request({ failure: { kind, code } }), now).recoverable, true);
  }
});
test('all unsafe and unsupported cases stop', () => {
  for (const kind of ['business', 'auth', 'missing_resource', 'browser', 'unknown']) assert.equal(decide(request({ failure: { kind } }), now).action, 'stop');
  for (const status of [200, 400, 401, 403, 404, 409, 422, 501, 505, 599]) assert.equal(decide(request({ failure: { kind: 'http', status } }), now).action, 'stop');
  for (const safety of [{ read_only: false }, { read_only: false, idempotency_key: 'key' }, { read_only: false, idempotency_supported: true }]) assert.equal(decide(request({ safety }), now).reason, 'unsafe_side_effect');
  assert.equal(decide(request({ safety: { read_only: false, idempotency_key: 'key', idempotency_supported: true } }), now).recoverable, true);
  for (const failure of [{ kind: 'mcp', code: 'INTERNAL_ERROR' }, { kind: 'network', code: 'ECONNREFUSED' }, { kind: 'http', status: 500, code: 'INSUFFICIENT_FUNDS' }, { kind: 'mcp', code: 'TIMEOUT', status: 401 }]) assert.equal(decide(request({ failure }), now).action, 'stop');
});
test('attempt, wait and economic limits stop rather than retry early', () => {
  assert.equal(decide(request({ attempts_so_far: 2 }), now).reason, 'attempt_limit');
  assert.equal(decide(request({ estimates: { retry_cost_usdc_atomic: 5, failure_avoided_usdc_atomic: 4 } }), now).reason, 'cost_exceeds_value');
  for (const value of ['4', '999999999999999999999999999999', 'Mon, 05 Oct 2026 12:00:04 GMT']) assert.equal(decide(request({ failure: { kind: 'http', status: 429, headers: { 'retry-after': value } } }), now).reason, 'wait_limit');
  for (const value of ['-1', '1.5', 'tomorrow', 'NaN']) assert.equal(decide(request({ failure: { kind: 'http', status: 429, headers: { 'retry-after': value } } }), now).reason, 'invalid_retry_after');
  for (const [value, ms] of [['0', 0], ['3', 3000], ['Mon, 05 Oct 2026 12:00:02 GMT', 2000]]) assert.equal(decide(request({ failure: { kind: 'http', status: 429, headers: { 'retry-after': value } } }), now).retry_after_ms, ms);
  assert.equal(decide(request({ failure: { kind: 'http', status: 503, headers: { 'retry-after': 'Mon, 05 Oct 2026 12:00:01 GMT', date: 'Mon, 05 Oct 2026 11:59:00 GMT' } } }), now).reason, 'wait_limit');
});
test('strict schema rejects extra fields, headers, malformed types and oversized input', () => {
  assert.equal(recoverSchema.safeParse(example).success, true);
  for (const r of [request({ url: 'https://example.com' }), request({ operation: 'a'.repeat(81) }), request({ attempts_so_far: -1 }), request({ safety: { read_only: 'yes' } }), request({ failure: { kind: 'http', status: 503, headers: { authorization: 'secret' } } })]) assert.equal(recoverSchema.safeParse(r).success, false);
});
