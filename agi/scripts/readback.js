import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import model from '../src/generated.json' with {type:'json'};
const origin=process.argv[2];if(!origin)throw new Error('Provide the presentation origin; no paid/positive live mutations are performed.');
const checks=[];
async function request(url,init={}){
 const result=await fetch(url,{...init,headers:{'X-AgentToolbox-Sample':'synthetic',...init.headers},redirect:'manual',signal:AbortSignal.timeout(15000)});
 return result;
}
const read=async url=>{const r=await request(url);assert.equal(r.status,200,url);return r.json();};
const before=await read(model.origin+'/v1/stats');
for(const path of ['/','/buy','/sell','/humans',...model.tools.map(p=>p.guide_url)]){
 const r=await request(origin+path);assert.equal(r.status,200,path);const html=await r.text();
 assert(html.includes('<title>AgentToolbox</title>'));assert(html.includes('For Humans'));assert(html.includes('Built for agents, by agents.'));
 assert(!/<script[\s>]/i.test(html));assert(r.headers.get('content-security-policy').includes("script-src 'none'"));
 checks.push({path,status:r.status,script_free:true});
}
const manifest=await read(origin+'/agent.json');assert.equal(manifest.canonical_api_origin,model.origin);assert.equal(manifest.tools.length,4);
assert.deepEqual(manifest.tools.filter(p=>p.preview_supported).map(p=>p.id),['docs-pack','contract-cases']);
for(const tool of manifest.tools){
 const local=model.tools.find(p=>p.id===tool.id),criteria=await read(tool.criteria);
 assert.equal(createHash('sha256').update(criteria.canonical_json).digest('hex'),criteria.sha256);
 assert.equal(criteria.sha256,local.success_pin.sha256,'Deploy requires canonical contract parity: '+tool.id);
 const challenge=await request(tool.invoke);assert.equal(challenge.status,402);const body=await challenge.json();
 assert.equal(body.payment.resource.url,tool.invoke);assert(body.discovery_only);
 const pin=body.payment_requirements_pin;assert.equal(createHash('sha256').update(pin.canonical_json).digest('hex'),pin.sha256);
 assert.deepEqual(JSON.parse(pin.canonical_json),body.payment.accepts[0]);
 const fixture=await read(tool.examples);assert.equal(fixture.execution,'none');
 const markdown=await request(origin+'/tools/'+tool.id+'.md');assert.equal(markdown.status,200);assert((await markdown.text()).includes(local.outcome.success_criterion));
 checks.push({tool:tool.id,success_hash_verified:true,payment_hash_verified:true,canonical_resource_verified:true,static_fixtures:true});
}
for(const path of ['/openapi.json','/.well-known/x402']){const r=await request(origin+path);assert.equal(r.status,307);assert.equal(r.headers.get('location'),model.origin+path);}
for(const path of ['/openapi.json','/.well-known/x402'])for(const method of ['GET','HEAD'])
 for(const header of ['X-Creator-Capability','X-Preparation-Capability','X-Referral-Capability','PAYMENT-SIGNATURE','Authorization','Cookie']){
  const r=await request(origin+path,{method,headers:{[header]:'synthetic-noncredential'}});
  assert.equal(r.status,421);assert.equal(r.headers.get('location'),null);
 }
for(const path of ['/mcp','/v1/products/contract-cases/invoke']){const r=await request(origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,421);assert.equal(r.headers.get('location'),null);}
const rpc=await request(model.machine.mcp,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
assert.equal(rpc.status,200);const names=(await rpc.json()).result.tools.map(p=>p.name);for(const name of ['get_product','get_creator_terms','submit_tool','submit_tool_update'])assert(names.includes(name));
const seller=await read(model.origin+'/v1/creator-terms');assert.deepEqual(seller.terms,model.sellerTerms.terms);
const referral=await read(model.origin+'/v1/referral-terms');assert.deepEqual(referral.terms,model.referralTerms.terms);
const after=await read(model.origin+'/v1/stats');
const evidence={verified_at:new Date().toISOString(),origin,canonical_api_origin:model.origin,checks,mcp_tools:names.length,
 canonical_terms_match:true,credential_bearing_discovery_rejected:true,stats_before:before,stats_after:after,old_site_status:(await request(model.origin+'/')).status,
 positive_proposals:0,positive_updates:0,referral_registrations:0,preparations:0,payment_signatures:0,settlements:0,refunds:0,payouts:0};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
