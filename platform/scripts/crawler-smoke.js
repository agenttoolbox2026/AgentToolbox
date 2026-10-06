import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {decodePaymentRequiredHeader} from '@x402/core/http';
const Ajv2020=createRequire(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'))('ajv/dist/2020.js').default;
const origin=process.argv[2]??'https://agnttoolbx.agenttoolbox2026.workers.dev',path='/v1/products/docs-pack/invoke',headers={'X-AgentToolbox-Sample':'synthetic'};
const report={checked_at:new Date().toISOString(),origin,version:process.argv[3]??null,probes:[],live_signatures:0,settlements_attempted:0};
let challenge;
for(const [name,init] of [['empty',{method:'POST'}],['empty_json',{method:'POST',headers:{'Content-Type':'application/json'},body:''}],['malformed_json',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}],['invalid_schema',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"input":{"unpaid_probe":"no execution"}}'}],['null_json',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'}],['non_json',{method:'POST',headers:{'Content-Type':'text/plain'},body:'not json'}]]){
 const response=await fetch(origin+path,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,402,name);
 const value=decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));
 if(challenge)assert.deepEqual(value.accepts,challenge.accepts);
 challenge=value;report.probes.push({name,status:response.status,standard_v2_header:true});
}
const get=route=>fetch(origin+route,{headers,signal:AbortSignal.timeout(15000)});
const manifest=await(await get('/.well-known/x402')).json();
const catalog=await(await get('/v1/products?status=all')).json(),paid=catalog.products.filter(p=>p.pricing.payments_configured),docsRoute=manifest.payment.routes.find(r=>r.product_id==='docs-pack');
assert.equal(manifest.version,1);assert.deepEqual(manifest.resources,paid.map(p=>origin+'/v1/products/'+p.id+'/invoke'));assert(manifest.resources.includes(origin+path));assert.deepEqual(docsRoute.accepts,challenge.accepts);assert.equal(manifest.payment.x402Version,2);assert.equal(docsRoute.live_payment_verified,false);
for(const product of paid){const route=manifest.payment.routes.find(r=>r.product_id===product.id);assert(route);assert.equal(route.accepts[0].amount,product.pricing.minimum_amount_atomic);assert.equal(route.pricing.model,'buyer_chosen_per_success');}
assert.equal(challenge.resource.url,origin+path);
const bazaar=challenge.extensions.bazaar,validate=new Ajv2020({strict:false,validateFormats:false}).compile(bazaar.schema);
assert.equal(validate(bazaar.info),true,JSON.stringify(validate.errors));
const pricing=catalog.products.find(p=>p.id==='docs-pack').pricing;
assert.equal(String(pricing.minimum_amount_atomic),challenge.accepts[0].amount);assert.equal(pricing.pay_to,challenge.accepts[0].payTo);assert.equal(pricing.asset,challenge.accepts[0].asset);assert.equal(pricing.network,challenge.accepts[0].network);assert.equal(pricing.payments_configured,true);
const api=await(await get('/openapi.json')).json();assert(api.paths[path].post['x-payment-info']);
for(const [route,init,status] of [[path,{method:'POST',body:'x'.repeat(16385)},413],[path,{method:'GET'},404],[path,{method:'HEAD'},404],['/v1/products/missing/invoke',{method:'POST'},404],['/admin',{method:'GET'},404],['/admin.js',{method:'GET'},404]]){
 const response=await fetch(origin+route,{...init,headers,signal:AbortSignal.timeout(15000)});
 assert.equal(response.status,status,route);assert.equal(response.headers.get('PAYMENT-REQUIRED'),null);report.probes.push({path:route,method:init.method,status:response.status});
}
for(const route of ['/','/humans','/missing-crawler-check']){
 const html=await(await get(route)).text();assert(html.includes('<title>AgentToolbox</title>'));assert(html.includes('Built for agents, by agents.'));if(route==='/humans')assert(html.includes('For Agents ↗'));
}
report.discovery={manifest_version:manifest.version,resources:manifest.resources,payment_version:challenge.x402Version,amount_atomic:challenge.accepts[0].amount,network:challenge.accepts[0].network,terms_match_catalog:true,terms_match_manifest:true,bazaar_example_matches_schema:true,live_payment_verified:false};
report.exact_titles_and_copy=true;report.all_passed=true;
writeFileSync(new URL('../evidence/x402-crawler-public.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
