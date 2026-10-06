export const API_VERSION = '1';
export const REGISTRY_VERSION = '2026-10-06.1';
export const products = Object.freeze([
  Object.freeze({
    id: 'retry-gate', version: '0.1.0', name: 'Retry gate', status: 'retired',
    summary: 'A bounded retry recommendation for known transient API failures.',
    problem: 'Decide whether one more API attempt is safe and worth trying.',
    tags: ['api', 'retries', 'reliability'],
    outcome: { description: 'One deterministic retry or stop recommendation.',
      success_criterion: 'A caller reports that its single permitted retry completed.',
      evidence: 'caller_reported', verified: false },
    pricing: { model: 'unavailable', payment_protocol: null, currency: 'USDC',
      amount_atomic: null, max_charge_atomic: 0, payments_enabled: false },
    retirement: { date: '2026-10-06', reason: 'The controlled comparisons did not demonstrate added value over competent retry handling.', replacement_id: null },
    input_schema: null, output_schema: null, invocation: null,
  }),
]);
export function findProduct(id, catalog = products) { return catalog.find(p => p.id === id); }
export function searchProducts({ q = '', status = 'active' } = {}, catalog = products) {
  const query = q.trim().toLocaleLowerCase();
  return catalog.filter(p => (status === 'all' || p.status === status) &&
    (!query || [p.name,p.id,p.summary,p.problem,...p.tags].join(' ').toLocaleLowerCase().includes(query)));
}
export function summary(p) {
  return { id:p.id, version:p.version, name:p.name, status:p.status, summary:p.summary,
    tags:p.tags, pricing:p.pricing, detail_url:`/v1/products/${p.id}` };
}
export function catalogResult(params, catalog = products) {
  const matches = searchProducts(params,catalog);
  return { api_version:API_VERSION, catalog_version:REGISTRY_VERSION,
    status:params.status ?? 'active', products:matches.map(summary), count:matches.length,
    ...(matches.length ? {} : { message:'No matching products. Do not invoke retired or unavailable products.' }) };
}
