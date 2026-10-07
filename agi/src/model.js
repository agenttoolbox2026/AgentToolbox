// Build-time only. Every published tool fact comes from the canonical registry.
// The deployed presentation Worker imports generated.json, never a service or ledger.
import {products, REGISTRY_VERSION} from '../../platform/src/registry.js';
import {formatUsdcPrice, minimumAmount} from '../../platform/src/payment-config.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {creatorTerms} from '../../platform/src/submissions.js';
import {referralTerms} from '../../platform/src/referrals.js';

export const CANONICAL_ORIGIN='https://agnttoolbx.agenttoolbox2026.workers.dev';
export const SITE_ORIGIN='https://agi.agenttoolbox2026.workers.dev';
const fit={
 'docs-pack':'Need literal excerpts from several documentation pages?',
 'quote-proof':'Need to check whether documentation says those exact words?',
 'contract-cases':'Need boundary and negative tests for a bounded JSON Schema?',
 'mcp-wirecheck':'Need to inspect MCP discovery on your workers.dev endpoint?',
};
export async function createModel(){
 const tools=await Promise.all(products.filter(p=>p.status==='active').map(async p=>({
  ...p,price_label:'$'+formatUsdcPrice(minimumAmount(p))+' USDC',fit:fit[p.id],
  scope:p.id==='docs-pack'?`${p.limits.max_urls} pages · ${p.limits.supported_hosts.length} allowed hosts · literal matches`:
    p.id==='quote-proof'?'Literal quotation fidelity · supported documentation hosts · not truth verification':
    p.id==='contract-cases'?'Accepted JSON Schema subset · valid seed required · bounded coverage':
    'Public canonical workers.dev endpoints only · discovery + tools/list · no tools/call',
  guide_url:'/tools/'+p.id,markdown_url:'/tools/'+p.id+'.md',
  success_pin:await successContractPin(p),
  links:{detail:CANONICAL_ORIGIN+'/v1/products/'+p.id,
   criteria:CANONICAL_ORIGIN+'/v1/products/'+p.id+'/criteria',
   payment_requirements:CANONICAL_ORIGIN+p.invocation.path,
   examples:CANONICAL_ORIGIN+p.examples_url,
   preview:p.preview.supported?CANONICAL_ORIGIN+p.preview.page:null,
   prepare:p.preview.supported?CANONICAL_ORIGIN+p.preview.path:null,
   invoke:CANONICAL_ORIGIN+p.invocation.path,quote:CANONICAL_ORIGIN+p.quote.path,
   reviews:CANONICAL_ORIGIN+'/products/'+p.id+'/reviews'},
 })));
 return {name:'AgentToolbox',origin:CANONICAL_ORIGIN,siteOrigin:SITE_ORIGIN,
  registryVersion:REGISTRY_VERSION,tools,sellerTerms:creatorTerms(),referralTerms:referralTerms(),
  contract_policy:'Build-time view of the canonical registry. Read and verify current canonical criteria and payment requirements before authorizing. This presentation host never processes operational requests.',
  machine:{catalog:CANONICAL_ORIGIN+'/v1/products',openapi:CANONICAL_ORIGIN+'/openapi.json',mcp:CANONICAL_ORIGIN+'/mcp',payments:CANONICAL_ORIGIN+'/.well-known/x402'},
 };
}
