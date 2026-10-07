import assert from 'node:assert/strict';
const origin=process.argv[2];if(!origin)throw new Error('Provide origin. Read-only and unsigned/nonfinancial probes only.');
const headers={'X-AgentToolbox-Sample':'synthetic'},request=(path,init={})=>fetch(origin+path,{...init,headers:{...headers,...init.headers},signal:AbortSignal.timeout(15000)}),read=async path=>{const response=await request(path);assert.equal(response.status,200);return response.json();};
const catalog=await read('/v1/products');assert.equal(catalog.products.length,4);
assert.deepEqual(catalog.products.filter(p=>p.preview.supported).map(p=>p.id),['docs-pack','contract-cases']);
for(const product of catalog.products){const criteria=await read('/v1/products/'+product.id+'/criteria');assert.equal(criteria.criteria.criteria_version,'1');assert.equal(criteria.product_version,product.version);assert(criteria.criteria.rules.length);const response=await request('/v1/products/'+product.id+'/invoke',{method:'POST',body:'{not JSON'});assert.equal(response.status,402);}
const terms=await read('/v1/creator-terms');assert.equal(terms.terms.list_fee_atomic,'500000');assert.equal(terms.terms.charged_fee_atomic,'0');assert.equal(terms.terms.share_bps,9000);assert.equal(terms.terms.revenue_basis,'gross');assert.equal(terms.terms.transfers_enabled,false);
assert.equal((await request('/v1/tool-submissions')).status,404);
assert.equal((await request('/v1/tool-submissions/00000000-0000-4000-8000-000000000000')).status,403);
assert.equal((await request('/v1/tool-submissions',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
assert.equal((await request('/v1/creator-tools/creator-00000000-0000-4000-8000-000000000000')).status,403);
assert.equal((await request('/v1/tool-updates/00000000-0000-4000-8000-000000000000')).status,403);
assert.equal((await request('/v1/creator-tools/creator-00000000-0000-4000-8000-000000000000/updates',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,400);
let id=1;const rpc=async(method,params)=>{const response=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:id++,method,params})});assert.equal(response.status,200);return (await response.json()).result;};
const tools=(await rpc('tools/list')).tools.map(tool=>tool.name);assert.equal(tools.length,16);for(const name of ['get_creator_terms','submit_tool','get_tool_submission','get_creator_tool','submit_tool_update','get_tool_update'])assert(tools.includes(name));
assert.equal((await rpc('tools/call',{name:'get_creator_terms',arguments:{}})).structuredContent.terms.charged_fee_atomic,'0');
assert.equal((await rpc('tools/call',{name:'get_product',arguments:{product_id:'contract-cases'}})).structuredContent.product.preview.page,'/products/contract-cases/preview');
const manifest=await read('/.well-known/x402');assert.equal(manifest.resources.length,4);assert(manifest.payment.routes.every(r=>r.method==='POST'&&r.criteria_url));
console.log(JSON.stringify({origin,synthetic_header:true,active_tools:4,previews_discoverable:2,versioned_criteria:4,unsigned_invalid_body_402:4,mcp_tools:16,creator_terms_verified:true,private_status_requires_capability:true,private_update_requires_capability:true,valid_updates:0,valid_submissions:0,free_examples:0,preparations:0,payment_headers:0,settlements:0,refunds:0,payouts:0}));
