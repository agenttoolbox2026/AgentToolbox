// Build-time only. Every published tool fact comes from the canonical registry.
// Presentation and operational routes share the same contracts and origin.
import {products, REGISTRY_VERSION} from '../../platform/src/registry.js';
import {formatUsdcPrice, minimumAmount} from '../../platform/src/payment-config.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {creatorTerms} from '../../platform/src/submissions.js';
import {referralTerms} from '../../platform/src/referrals.js';
import {freeExampleManifest} from '../../platform/src/free-examples.js';
import {isPublishedTool} from './catalog.js';

export const CANONICAL_ORIGIN='https://agi.agenttoolbox2026.workers.dev';
export const SITE_ORIGIN='https://agi.agenttoolbox2026.workers.dev';
const fit={
 'docs-pack':'Need literal excerpts from several documentation pages?',
 'quote-proof':'Need to check whether documentation says those exact words?',
 'contract-cases':'Need boundary and negative tests for a bounded JSON Schema?',
 'mcp-wirecheck':'Need to inspect MCP discovery on your workers.dev endpoint?',
};
const scope={
 'docs-pack':p=>Number.isInteger(p.limits?.max_urls)&&Array.isArray(p.limits?.supported_hosts)?`${p.limits.max_urls} pages · ${p.limits.supported_hosts.length} allowed hosts · literal matches`:null,
 'quote-proof':()=> 'Literal quotation fidelity · supported documentation hosts · not truth verification',
 'contract-cases':()=> 'Accepted JSON Schema subset · valid seed required · bounded coverage',
 'mcp-wirecheck':()=> 'Public canonical workers.dev endpoints only · discovery + tools/list · no tools/call',
};
const optionalText=value=>typeof value==='string'&&value.trim()?value:null;
// catalog is a compiled public registry, never a submission body or D1 metadata
// query. The default is the same source used by the operational service.
export async function createModel({origin=CANONICAL_ORIGIN,catalog=products,registryVersion=REGISTRY_VERSION}={}){
 const published=catalog.filter(isPublishedTool);
 if(new Set(published.map(p=>p.id)).size!==published.length)throw new TypeError('Published tool IDs must be unique.');
 const tools=await Promise.all(published.map(async p=>{
 const productPath='/v1/products/'+p.id;
 const minimum=minimumAmount(p);
 const firstParty=p.provider.type==='first_party'&&p.provider.id==='agenttoolbox';
 const quote=p.quote?.path===productPath+'/quote';
 const preview=p.preview?.supported===true&&p.preview.path===productPath+'/prepare'&&p.preview.page==='/products/'+p.id+'/preview'&&quote;
 const examples=firstParty&&p.examples_url===productPath+'/examples'&&freeExampleManifest(p.id);
 return {
  ...p,pricing:{...p.pricing,minimum_amount_atomic:minimum},price_label:'$'+formatUsdcPrice(minimum)+' USDC',
  fit:optionalText(p.fit)??(firstParty?fit[p.id]:null)??p.summary,
  scope:optionalText(p.scope)??(firstParty?scope[p.id]?.(p):null)??null,
  preview:preview?p.preview:p.preview?.supported===false?p.preview:{supported:false},
  guide_url:'/tools/'+p.id,markdown_url:'/tools/'+p.id+'.md',
  success_pin:await successContractPin(p),
  links:{detail:origin+'/v1/products/'+p.id,
   criteria:origin+'/v1/products/'+p.id+'/criteria',
   payment_requirements:origin+p.invocation.path,
   examples:examples?origin+p.examples_url:null,
   preview:preview?origin+p.preview.page:null,
   prepare:preview?origin+p.preview.path:null,
   invoke:origin+p.invocation.path,quote:quote?origin+p.quote.path:null,
   reviews:origin+'/products/'+p.id+'/reviews'},
 };}));
 return {name:'AgentToolbox',origin,siteOrigin:origin,
  registryVersion,tools,sellerTerms:creatorTerms(),referralTerms:referralTerms(),
  contract_policy:'Built from the operational registry. Read and verify current criteria and payment requirements before authorizing.',
  machine:{catalog:origin+'/v1/products',openapi:origin+'/openapi.json',mcp:origin+'/mcp',payments:origin+'/.well-known/x402'},
 };
}
