export const SEARCH_QUERY_CHARS=120;
const text=value=>typeof value==='string'?value:'';
export const normalizeSearchText=value=>text(value).normalize('NFKC').toLowerCase();
export const normalizeSearchQuery=value=>text(value).normalize('NFKC').trim().replace(/\s+/gu,' ');
export const searchTerms=query=>normalizeSearchText(normalizeSearchQuery(query)).split(' ').filter(Boolean);

// Existing public first-party fit/scope text also supports protocol discovery.
// These task words are search metadata, never new product capabilities.
const purpose={
 'docs-pack':product=>['Need literal excerpts from several documentation pages?',
  Number.isInteger(product.limits?.max_urls)&&Array.isArray(product.limits?.supported_hosts)
   ?`${product.limits.max_urls} pages · ${product.limits.supported_hosts.length} allowed hosts · literal matches`:null],
 'quote-proof':()=>['Need to check whether documentation says those exact words?',
  'Literal quotation fidelity · supported documentation hosts · not truth verification'],
 'contract-cases':()=>['Need boundary and negative tests for a bounded JSON Schema?',
  'Accepted JSON Schema subset · valid seed required · bounded coverage'],
 'mcp-wirecheck':()=>['Need to inspect MCP discovery on your workers.dev endpoint?',
  'Public canonical workers.dev endpoints only · discovery + tools/list · no tools/call'],
};

export function matchesProductSearch(product,terms){
 const firstParty=product.provider?.id==='agenttoolbox'&&product.provider?.type==='first_party';
 const taskText=firstParty&&Object.hasOwn(purpose,product.id)?purpose[product.id](product):[];
 const haystack=normalizeSearchText([product.id,product.name,product.summary,product.problem,
  product.fit,product.scope,product.provider?.id,product.provider?.name,product.provider?.type,
  ...(Array.isArray(product.tags)?product.tags:[]),...taskText].map(text).join(' '));
 return terms.every(term=>haystack.includes(term));
}
