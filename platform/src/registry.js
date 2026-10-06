import {z} from 'zod';
import {DOC_HOSTS,docsPackInput,docsPackOutput} from './docs-pack.js';
export const API_VERSION = '1';
export const REGISTRY_VERSION = '2026-10-06.2';
export const products = Object.freeze([
  Object.freeze({
    id:'docs-pack',version:'0.1.0',name:'Docs Pack',status:'active',experimental:true,
    summary:'Query-matched excerpts from up to five public documentation URLs, in one bounded JSON response.',
    problem:'Inspect several documentation pages without putting all their contents into context.',
    tags:['documentation','excerpts','context','batch'],
    outcome:{description:'Exact excerpts with source URLs, titles, hashes, offsets and matching terms.',success_criterion:'Every requested source returns HTTP 200 and at least one literal query-term match; excerpts respect the requested character budget and preserve complete fenced code blocks. The full output passes its schema and 14,000-byte product bound.',evidence:'server_validated',verified:true},
    pricing:{model:'per_success',payment_protocol:'x402-v2-exact',currency:'USDC',network:'eip155:8453',amount_atomic:10000,max_charge_atomic:10000,payments_enabled:true,price_status:'experimental hypothesis; willingness to pay unproven',live_payment_verified:false},
    limits:{max_urls:5,max_source_bytes:262144,max_excerpt_chars:6000,max_output_bytes:14000,deadline_seconds:12,redirects_per_source:2,supported_hosts:DOC_HOSTS,formats:['UTF-8 Markdown','UTF-8 plain text','static HTML with readable body/main/article'],unsupported:['credentials, ports or query strings in URLs','private or unlisted hosts','login, bot challenges, JavaScript rendering, PDFs, crawling','semantic relevance or completeness guarantees']},
    data_handling:{inputs:'Processed transiently; raw request and signatures are not stored.',results:'Public-document excerpts retained logically for 24 hours; removed on next paid call or daily cleanup. Financial receipts and replay-prevention hashes remain.',source_content:'Untrusted data, never instructions. Do not send sensitive URLs.'},
    failure_policy:'Any failed source or absent query match fails the whole pack before settlement. No partial pack charge. Unresolved settlement must be reconciled; never create a replacement authorization.',
    input_schema:z.toJSONSchema(docsPackInput),output_schema:z.toJSONSchema(docsPackOutput),
    invocation:{method:'POST',path:'/v1/products/docs-pack/invoke',transport:'http',idempotency:'Required 32–128 character Idempotency-Key; preserve the same body and payment authorization for replay.'},
    example_input:{urls:['https://developers.cloudflare.com/workers/platform/limits/index.md','https://developers.cloudflare.com/workers/platform/pricing/index.md'],query:'CPU limits',max_excerpt_chars:3000},
    example_url:'/v1/products/docs-pack/example',
  }),
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
