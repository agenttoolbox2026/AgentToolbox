// Pure rules. The caller supplies nowMs so date interpretation is deterministic.
export function decide(request, nowMs) {
  const stop = (reason) => ({ recoverable: false, reason, action: 'stop', retry_after_ms: 0, max_attempts: 0,
    instructions: 'Do not retry under this recommendation. Resolve the cause or escalate to the caller.' });
  const { failure: f, safety: s, limits, attempts_so_far: attempts } = request;
  if (!s.read_only && !(s.idempotency_supported === true && s.idempotency_key)) return stop('unsafe_side_effect');
  if (attempts >= Math.min(limits.max_attempts, 5)) return stop('attempt_limit');
  if (['business', 'auth', 'missing_resource', 'browser', 'unknown'].includes(f.kind)) return stop('unsupported_failure');
  // An explicit contradictory status overrides a purported transient code.
  if (f.status !== undefined && ![429, 500, 502, 503, 504].includes(f.status)) return stop('unsupported_status');
  const code = f.code?.toUpperCase();
  let category;
  if (f.kind === 'http') {
    if (![429, 500, 502, 503, 504].includes(f.status)) return stop('unsupported_status');
    // Unknown business codes cannot be overridden by a generic HTTP 500.
    if (code && !['RATE_LIMITED', 'UNAVAILABLE', 'TIMEOUT', 'ECONNRESET', 'ETIMEDOUT'].includes(code)) return stop('unsupported_code');
    category = f.status === 429 ? 'rate_limited' : 'temporary_http';
  } else {
    const allowed = f.kind === 'network' ? ['ETIMEDOUT', 'ECONNRESET'] : ['TIMEOUT', 'CONNECTION_RESET', 'RATE_LIMITED', 'UNAVAILABLE'];
    if (!allowed.includes(code)) return stop('unsupported_code');
    category = code === 'RATE_LIMITED' ? 'rate_limited' : 'temporary_transport';
  }
  const estimates = request.estimates;
  if (estimates && estimates.retry_cost_usdc_atomic >= estimates.failure_avoided_usdc_atomic) return stop('cost_exceeds_value');
  let wait = Math.min(1000 * 2 ** (attempts - 1), 30_000);
  const retryAfter = f.headers?.['retry-after'];
  if (retryAfter !== undefined) {
    if (/^\d+$/.test(retryAfter)) wait = Number(retryAfter) * 1000;
    else {
      const httpDate = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
      if (!httpDate.test(retryAfter) || !Number.isFinite(Date.parse(retryAfter))) return stop('invalid_retry_after');
      const target = Date.parse(retryAfter);
      // Use the larger wait when upstream Date exposes clock skew.
      const upstreamDate = f.headers?.date;
      if (upstreamDate && (!httpDate.test(upstreamDate) || !Number.isFinite(Date.parse(upstreamDate)))) return stop('invalid_upstream_date');
      wait = Math.max(0, target - nowMs, upstreamDate ? target - Date.parse(upstreamDate) : 0);
    }
  }
  if (!Number.isFinite(wait) || wait > Math.min(limits.max_wait_ms, 30_000)) return stop('wait_limit');
  return { recoverable: true, reason: category, action: wait ? 'wait_then_retry' : 'retry', retry_after_ms: wait, max_attempts: 1,
    instructions: `Accept the quote before retrying. Wait at least ${wait} ms after acceptance, then make at most ONE retry of the same operation and payload${s.read_only ? '' : ' using the SAME upstream idempotency key'}. Submit the outcome; stop on another failure. Never send credentials to AgentToolbox.` };
}
