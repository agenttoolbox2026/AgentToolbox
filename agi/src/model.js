// Build-time only. Every published tool fact comes from the canonical registry.
// Presentation and operational routes share the same contracts and origin.
import {products, REGISTRY_VERSION} from '../../platform/src/registry.js';
import {formatUsdcPrice, minimumAmount} from '../../platform/src/payment-config.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {creatorTerms} from '../../platform/src/submissions.js';
import {referralTerms} from '../../platform/src/referrals.js';

export const CANONICAL_ORIGIN='https://agi.agenttoolbox2026.workers.dev';
export const SITE_ORIGIN='https://agi.agenttoolbox2026.workers.dev';
const fit={
 'docs-pack':'Need literal excerpts from several documentation pages?',
 'quote-proof':'Need to check whether documentation says those exact words?',
 'contract-cases':'Need boundary and negative tests for a bounded JSON Schema?',
 'mcp-wirecheck':'Need to inspect MCP discovery on your workers.dev endpoint?',
};
export async function createModel({origin=CANONICAL_ORIGIN}={}){
 const tools=await Promise.all(products.filter(p=>p.status==='active').map(async p=>({
  ...p,price_label:'$'+formatUsdcPrice(minimumAmount(p))+' USDC',fit:fit[p.id],
  scope:p.id==='docs-pack'?`${p.limits.max_urls} pages · ${p.limits.supported_hosts.length} allowed hosts · literal matches`:
    p.id==='quote-proof'?'Literal quotation fidelity · supported documentation hosts · not truth verification':
    p.id==='contract-cases'?'Accepted JSON Schema subset · valid seed required · bounded coverage':
    'Public canonical workers.dev endpoints only · discovery + tools/list · no tools/call',
  guide_url:'/tools/'+p.id,markdown_url:'/tools/'+p.id+'.md',
  success_pin:await successContractPin(p),
  links:{detail:origin+'/v1/products/'+p.id,
   criteria:origin+'/v1/products/'+p.id+'/criteria',
   payment_requirements:origin+p.invocation.path,
   examples:origin+p.examples_url,
   preview:p.preview.supported?origin+p.preview.page:null,
   prepare:p.preview.supported?origin+p.preview.path:null,
   invoke:origin+p.invocation.path,quote:origin+p.quote.path,
   reviews:origin+'/products/'+p.id+'/reviews'},
 })));
 return {name:'AgentToolbox',origin,siteOrigin:origin,
  registryVersion:REGISTRY_VERSION,tools,sellerTerms:creatorTerms(),referralTerms:referralTerms(),
  contract_policy:'Built from the operational registry. Read and verify current criteria and payment requirements before authorizing.',
  machine:{catalog:origin+'/v1/products',openapi:origin+'/openapi.json',mcp:origin+'/mcp',payments:origin+'/.well-known/x402'},
 };
}
