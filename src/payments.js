export const SUCCESS_RULE = 'agent_reported_success_v1';
export function devPayments(mode) {
  if (mode !== 'dev') throw new Error('Only no-charge dev mode is implemented');
  return { mode, asset: 'USDC', network: null, price_usdc_atomic: 0, max_charge_usdc_atomic: 0,
    amount_settled_usdc_atomic: 0, payment_status: 'dev_no_charge', settlement_reference: null };
}
export function qualifies(result, evidenceType) {
  const e = result.evidence;
  return result.outcome === 'success' && result.completed && result.retry_attempts === 1 &&
    !!e.digest_sha256 && e.type === evidenceType &&
    (e.type === 'http' ? e.final_status >= 200 && e.final_status < 300 && e.mcp_is_error === undefined :
      e.type === 'mcp' && e.mcp_is_error === false && e.final_status === undefined);
}
