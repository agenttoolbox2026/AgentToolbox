import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import model from '../src/generated.json' with {type:'json'};
const origin=process.argv[2];if(origin!==model.origin)throw new Error('Provide the configured AGI origin. Read-only discovery only; no positive live writes.');
const checks=[];
async function request(path,init={}){
 return fetch(new URL(path,origin),{...init,headers:{'X-AgentToolbox-Sample':'synthetic',...init.headers},redirect:'manual',signal:AbortSignal.timeout(15000)});
}
const read=async path=>{const r=await request(path);assert.equal(r.status,200,path);return r.json();};
let agentHeader;
const normalizeHeader=html=>html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0].replaceAll(' aria-current="page"','');
const before=await read('/v1/stats');
for(const path of ['/','/buy','/sell',...model.tools.map(p=>p.guide_url)]){
 const r=await request(path);assert.equal(r.status,200,path);const html=await r.text();
 assert(html.includes('<title>AgentToolbox</title>'));assert(html.includes('For Humans'));assert(html.includes('Built for agents, by agents.'));
 assert(!/<script[\s>]/i.test(html));assert(r.headers.get('content-security-policy').includes("script-src 'none'"));
 assert(!html.includes('https://agnttoolbx.agenttoolbox2026.workers.dev'));
 agentHeader??=normalizeHeader(html);assert.equal(normalizeHeader(html),agentHeader);
 checks.push({path,status:r.status,script_free:true});
}
const humans=await request('/humans');const humanHtml=await humans.text();
assert.equal(humans.status,200);assert(humanHtml.includes('Tools Sold'));assert(humanHtml.includes('For Agents'));assert(humanHtml.includes('>'+before.lifetime_paid_purchases+'</p>'));
assert.equal(normalizeHeader(humanHtml),agentHeader,'Shared audience header');
for(const name of ['header','style','humans']){
 const page=name==='humans'?humanHtml:await (await request('/')).text();
 const href=page.match(new RegExp('href="(/'+name+'\\.css\\?v=([0-9a-f]{12}))"'));assert(href,name+' stylesheet link');
 const response=await request(href[1]);assert.equal(response.status,200);
 assert.equal(createHash('sha256').update(await response.text()).digest('hex').slice(0,12),href[2],name+' deployed cache hash');
}
checks.push({shared_audience_header:true,versioned_stylesheets:3});
const manifest=await read('/agent.json');assert.equal(manifest.canonical_api_origin,origin);assert.equal(manifest.tools.length,4);assert.equal(manifest.presentation_only,undefined);
assert.deepEqual(manifest.tools.filter(p=>p.preview_supported).map(p=>p.id),['docs-pack','contract-cases']);
for(const tool of manifest.tools){
 const local=model.tools.find(p=>p.id===tool.id),criteria=await read(tool.criteria);
 assert.equal(createHash('sha256').update(criteria.canonical_json).digest('hex'),criteria.sha256);
 assert.equal(criteria.sha256,local.success_pin.sha256,'Contract parity: '+tool.id);
 const challenge=await request(tool.invoke);assert.equal(challenge.status,402);const body=await challenge.json();
 assert.equal(body.payment.resource.url,tool.invoke);assert(body.discovery_only);
 const pin=body.payment_requirements_pin;assert.equal(createHash('sha256').update(pin.canonical_json).digest('hex'),pin.sha256);
 assert.deepEqual(JSON.parse(pin.canonical_json),body.payment.accepts[0]);
 const fixture=await read(tool.examples);assert.equal(fixture.execution,'none');
 checks.push({tool:tool.id,success_hash:criteria.sha256,payment_hash:pin.sha256,resource:body.payment.resource.url,static_fixtures:true});
}
for(const path of ['/openapi.json','/.well-known/x402']){
 const r=await request(path,{headers:{'X-Creator-Capability':'synthetic-noncredential'}});assert.equal(r.status,200);assert.equal(r.headers.get('location'),null);
 const body=await r.text();assert(body.includes(origin));assert(!body.includes('synthetic-noncredential'));assert(!body.includes('https://agnttoolbx.agenttoolbox2026.workers.dev'));
}
for(const path of ['/submit-tool','/update-tool','/products/docs-pack/preview','/products/contract-cases/preview']){
 const r=await request(path);assert.equal(r.status,200,path);const html=await r.text();assert(html.includes('href="/workflow.css'));assert(html.includes('src="/site.js'));assert(r.headers.get('content-security-policy').includes("script-src 'self'"));assert(!html.includes('https://agnttoolbx.agenttoolbox2026.workers.dev'));
 checks.push({path,status:200,workflow_stylesheet:true,same_origin_scripts:true});
}
for(const path of ['/workflow.css','/site.js','/retry-envelope.js']){const r=await request(path);assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');}
const rpc=await request('/mcp',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','Accept':'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})});
assert.equal(rpc.status,200);const names=(await rpc.json()).result.tools.map(p=>p.name);for(const name of ['get_product','get_creator_terms','submit_tool','submit_tool_update'])assert(names.includes(name));
const preflight=await request('/v1/tool-submissions',{method:'OPTIONS',headers:{Origin:'https://example.invalid','Access-Control-Request-Headers':'Content-Type,X-Creator-Capability'}});assert.equal(preflight.status,204);assert(preflight.headers.get('access-control-allow-headers').includes('X-Creator-Capability'));
const seller=await read('/v1/creator-terms');assert.deepEqual(seller.terms,model.sellerTerms.terms);
const referral=await read('/v1/referral-terms');assert.deepEqual(referral.terms,model.referralTerms.terms);
for(const path of ['/admin','/board','/message-board'])assert.equal((await request(path)).status,404,path);
const after=await read('/v1/stats');assert.equal(before.lifetime_paid_purchases,after.lifetime_paid_purchases);
const evidence={verified_at:new Date().toISOString(),origin,checks,mcp_tools:names.length,canonical_terms_match:true,credential_bearing_discovery_stays_local:true,stats_before:before,stats_after:after,
 positive_proposals:0,positive_updates:0,referral_registrations:0,preparations:0,payment_signatures:0,settlements:0,refunds:0,payouts:0};
if(process.argv[3])await writeFile(process.argv[3],JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
