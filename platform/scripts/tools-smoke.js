import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {decodePaymentRequiredHeader} from '@x402/core/http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const origin=process.argv[2],output=process.argv[3];if(!origin)throw new Error('Explicit origin required.');
const local=['127.0.0.1','localhost'].includes(new URL(origin).hostname),headers={'X-AgentToolbox-Sample':'synthetic'};
const request=(path,init={})=>fetch(new URL(path,origin),{...init,headers:{...headers,...init.headers}});
const post=(path,body,extra={})=>request(path,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
const catalog=await(await request('/v1/products')).json(),ids=['docs-pack','quote-proof','contract-cases','mcp-wirecheck'];assert.deepEqual(catalog.products.map(p=>p.id),ids);
const manifest=await(await request('/.well-known/x402')).json();assert.equal(manifest.payment.routes.length,4);
const results=[];for(const p of catalog.products){assert.equal(p.pricing.minimum_amount_atomic,'10000');assert.equal(p.pricing.business_maximum,null);assert.equal(p.pricing.decimals,6);
 for(const init of [{method:'POST'},{method:'POST',headers:{'Content-Type':'application/json'},body:'{bad'},{method:'POST',body:'arbitrary'}]){const r=await request('/v1/products/'+p.id+'/invoke',init);assert.equal(r.status,402);const terms=decodePaymentRequiredHeader(r.headers.get('PAYMENT-REQUIRED'));assert.equal(terms.accepts[0].amount,'10000');assert.ok(terms.extensions.bazaar);}
 const reviews=await(await request('/v1/products/'+p.id+'/reviews')).json();assert(Array.isArray(reviews.reviews));
 const page=await(await request('/products/'+p.id+'/reviews')).text();assert(page.includes('<title>AgentToolbox</title>'));
 const invalid=await post('/v1/products/'+p.id+'/quote',{version:'0.1.0',payment_amount_atomic:'010000',input:{}});assert.equal(invalid.status,400);
 results.push({id:p.id,minimum:'10000',unsigned_shapes_402:3,review_page:true,invalid_quote_rejected:true});
}
for(const route of ['/','/humans','/?q=quote']){const r=await request(route);assert.equal(r.status,200);assert((await r.text()).includes('<title>AgentToolbox</title>'));}
let preparation=null;if(local){
 const product=(await(await request('/v1/products/contract-cases')).json()).product;
 const secret='atbp_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),commitment=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))).toString('hex'),cap={'X-Preparation-Capability':secret};
 const body={version:product.version,input:product.example_input,request_id:'local_'+crypto.randomUUID().replaceAll('-',''),prepare_secret_hash:commitment};
 const r=await post('/v1/products/contract-cases/prepare',body,cap);assert.equal(r.status,200);const saved=await r.json();assert(!JSON.stringify(saved).includes('coverage_gaps'));assert(!JSON.stringify(saved).includes(secret));
 assert.deepEqual(await(await post('/v1/products/contract-cases/prepare',body,cap)).json(),saved);
 const q=await post('/v1/products/contract-cases/quote',{version:product.version,prepared_id:saved.prepared_id,payment_amount_atomic:'10001'},cap);assert.equal(q.status,200);const quoted=await q.json();assert.equal(quoted.payment.accepts[0].amount,'10001');assert.equal(quoted.payment.extensions,undefined);
 const wrong=await post('/v1/products/contract-cases/quote',{version:product.version,prepared_id:saved.prepared_id,payment_amount_atomic:'10001'});assert.equal(wrong.status,403);
 preparation={stable_preview:true,quote_saved:true,chosen_atomic:'10001',capability_required:true,settlements:0};
}
const transport=new StreamableHTTPClientTransport(new URL('/mcp',origin),{requestInit:{headers}}),client=new Client({name:'local-tools-smoke',version:'1.0.0'});
await client.connect(transport);const tools=await client.listTools();assert(tools.tools.some(t=>t.name==='list_reviews'));const listing=await client.callTool({name:'list_products',arguments:{}});assert.deepEqual(listing.structuredContent.products.map(p=>p.id),ids);await client.close();
const report={origin,checked_at:new Date().toISOString(),tools:results,mcp_catalog_count:ids.length,preparation,real_signatures:0,settlements:0,purchases:0,public_review_writes:0};if(output)writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
