import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
const origin=process.argv[2]??'https://agnttoolbx.agenttoolbox2026.workers.dev';
const headers={'X-AgentToolbox-Sample':'synthetic'},results={origin,checked_at:new Date().toISOString(),public_review_writes:0,live_payment_calls:0};
const get=path=>fetch(origin+path,{headers});
const rpc=async(name,args)=>{const r=await fetch(origin+'/mcp',{method:'POST',headers:{...headers,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});assert.equal(r.status,200);return (await r.json()).result;};
const list=await get('/v1/products/docs-pack/reviews?limit=2');assert.equal(list.status,200);const data=await list.json();
assert.equal(data.unique_buyers,false);assert.equal(data.includes_repeat_purchases,true);assert.deepEqual(data.aggregates.map(x=>x.badge),['Verified purchase','Example-linked','Unverified']);assert(!JSON.stringify(data).match(/review_secret_hash|purchase_operation_id|payment_digest|payer|signature/));
results.public_reviews=data.reviews.length;results.rating_groups=data.aggregates;
for(const path of ['/','/humans','/products/docs-pack/reviews']){const r=await get(path);assert.equal(r.status,200);const html=await r.text();assert.equal(html.match(/<title>.*?<\/title>/)[0],'<title>AgentToolbox</title>');if(path.includes('reviews')){assert(html.includes('Publish my display name and text'));assert(html.includes('method="post"'));}}
const spec=await(await get('/openapi.json')).json();for(const path of ['/v1/reviews','/v1/reviews/{id}','/v1/reviews/{id}/replies','/v1/products/{id}/reviews'])assert(spec.paths[path]);assert(spec.paths['/v1/products/docs-pack/invoke'].post.requestBody.content['application/json'].schema.properties.review_secret_hash);
assert.equal((await get('/v1/products/docs-pack/reviews?limit=21')).status,400);
assert.equal((await get('/v1/feedback')).status,404);assert.equal((await get('/admin/api/overview')).status,404);
const mcpList=await rpc('list_reviews',{product_id:'docs-pack',limit:2});assert.equal(mcpList.isError,undefined);assert.deepEqual(mcpList.structuredContent.aggregates,data.aggregates);
const absent='00000000-0000-4000-8000-000000000000';assert.equal((await get('/v1/reviews/'+absent)).status,404);assert.equal((await get('/v1/reviews/'+absent+'/replies')).status,404);
for(const name of ['get_review','list_review_replies'])assert.match(JSON.stringify(await rpc(name,{review_id:absent})),/review_not_found/);
// Invalid public-write probes cannot create reviews, even if validation regresses:
// the explicit synthetic classification excludes them from all public surfaces.
const invalid=await fetch(origin+'/v1/reviews',{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({product_id:'docs-pack',visibility:'public',message:'INVALID schema probe only',badge:'verified_purchase'})});assert.equal(invalid.status,400);
assert.equal((await rpc('submit_review',{product_id:'docs-pack',visibility:'public',message:'INVALID schema probe only',badge:'verified_purchase',idempotency_key:crypto.randomUUID()})).isError,true);
const reply=await rpc('reply_to_review',{review_id:absent,visibility:'public',message:'INVALID parent probe only',idempotency_key:crypto.randomUUID()});assert.match(JSON.stringify(reply),/review_not_found/);
Object.assign(results,{exact_titles:true,discovery:true,http_mcp_lists:true,missing_threads_404:true,forged_badge_rejected:true,private_routes_404:true});
writeFileSync(new URL('../evidence/public-reviews-live.json',import.meta.url),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify(results));
