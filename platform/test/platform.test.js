import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {createPlatform} from '../src/app.js';
import {products} from '../src/registry.js';
import {database} from '../scripts/local-db.js';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {start} from '../scripts/dev.js';
const origin='http://127.0.0.1:8787';
const fixture={id:'test-only',version:'1.0.0',name:'Test fixture',status:'active',summary:'Not a deployed product',problem:'Testing',tags:[],
 outcome:{description:'A number doubled',success_criterion:'Output equals input multiplied by two',evidence:'server_validated',verified:true},
 pricing:{model:'free',amount_atomic:0,payments_enabled:false,max_charge_atomic:0}};
const handler={input:z.strictObject({value:z.number().int().max(100)}),output:z.strictObject({doubled:z.number().int()}),run:async({value})=>({doubled:value*2}),success:out=>out.doubled>=0};
function setup(overrides={}){
 const db=database();const app=createPlatform({db,origin,...overrides});
 const request=(path,options={})=>app(new Request(origin+path,options));
 return {db,request,close:()=>db.close()};
}
const post=(body,key='test_key_abcdefghijklmnopqrstuvwxyz123')=>({method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
const input={version:'1.0.0',input:{value:4},max_charge_usdc_atomic:0};
test('same experimental product in HTML, JSON, Markdown and OpenAPI; retired remains uncallable',async()=>{
 const {request,close}=setup();try{
  const active=await(await request('/v1/products')).json();assert.deepEqual(active.products.map(p=>p.id),['docs-pack','quote-proof','contract-cases','mcp-wirecheck']);
  const html=await(await request('/')).text();assert.match(html,/Docs Pack/);assert.match(html,/\$0.01/);assert.ok(!html.includes('Our approach'));
  const json=await(await request('/',{headers:{Accept:'application/json'}})).json();assert.deepEqual(json,active);
  const md=await(await request('/llms.txt')).text();assert.match(md,/docs-pack/);
  const retired=await(await request('/v1/products?status=retired&q=retry')).json();assert.equal(retired.products[0].id,'retry-gate');
  const detail=await(await request('/v1/products/retry-gate')).json();assert.equal(detail.product.status,'retired');assert.equal(detail.product.invocation,null);
  const schema=await(await request('/openapi.json')).json();assert.equal(schema.openapi,'3.1.0');assert.ok(schema.paths['/v1/products/{id}/invoke']);
 }finally{close();}
});
test('search escapes HTML; invalid filters and oversized queries fail clearly',async()=>{
 const {request,close}=setup();try{
  const page=await(await request('/?q='+encodeURIComponent('<script>alert(1)</script>'))).text();
  assert.ok(!page.includes('<script>alert(1)</script>'));assert.match(page,/&lt;script&gt;/);
  assert.equal((await request('/?status=fake')).status,400);
  assert.equal((await request('/?q='+'x'.repeat(121))).status,400);
  assert.equal((await request('/?private=secret')).status,400);
 }finally{close();}
});
test('retired, unknown and wrong-method calls never execute or ask for payments',async()=>{
 let calls=0;const {request,close}=setup({handlers:{'retry-gate':{...handler,run:async()=>{calls++;return {doubled:4};}}}});
 try{
  const retired=await request('/v1/products/retry-gate/invoke',post({...input,version:'0.1.0'}));assert.equal(retired.status,410);assert.equal((await retired.json()).error.code,'product_retired');
  assert.equal(retired.headers.get('PAYMENT-REQUIRED'),null);
  assert.equal((await request('/v1/products/missing/invoke',post(input))).status,404);
  assert.equal((await request('/v1/products/retry-gate/invoke')).status,404);
  assert.equal((await request('/v1/products/retry-gate/invoke',{method:'HEAD'})).status,404);
  assert.equal(calls,0);
 }finally{close();}
});
test('request and method bounds; private operations have no public dashboard',async()=>{
 const {request,close}=setup();try{
  assert.equal((await request('/v1/products/retry-gate/invoke',{method:'POST',body:'{}'})).status,415);
  assert.equal((await request('/v1/products/retry-gate/invoke',post({extra:'x'.repeat(20000)}))).status,413);
  assert.equal((await request('/mcp')).status,405);
  assert.equal((await request('/admin')).status,404);
  for(const path of ['/metrics','/v1/recover','/v1/runs/not-a-run/outcome'])assert.equal((await request(path)).status,404);
  const head=await request('/',{method:'HEAD'});assert.equal(await head.text(),'');
  assert.equal((await request('/v1/products',{method:'OPTIONS'})).status,204);
 }finally{close();}
});
test('available fixture uses validated outcome, idempotency and private run capability',async()=>{
 let calls=0;const {request,db,close}=setup({catalog:[fixture],handlers:{'test-only':{...handler,run:async p=>{calls++;return handler.run(p);}}}});
 try{
  const response=await request('/v1/products/test-only/invoke',post(input));assert.equal(response.status,200);
  const run=await response.json();assert.equal(run.output.doubled,8);assert.equal(run.payment.amount_settled_atomic,0);
  const again=await(await request('/v1/products/test-only/invoke',post(input))).json();assert.equal(again.run_id,run.run_id);assert.equal(calls,1);
  assert.equal((await request('/v1/products/test-only/invoke',post({...input,input:{value:5}}))).status,409);
  assert.equal((await request('/v1/products/test-only/invoke',post({...input,version:'2.0.0'},'different_abcdefghijklmnopqrstuvwxyz'))).status,409);
  assert.equal((await request('/v1/products/test-only/invoke',post(input,'short'))).status,400);
  assert.equal((await request('/v1/products/test-only/invoke',post({...input,input:{value:5,secret:'not stored'}},'different_abcdefghijklmnopqrstuvwxyz'))).status,400);
  assert.equal((await request(run.outcome_url,post({outcome:'success'}))).status,200);
  assert.equal((await request(run.outcome_url,post({outcome:'success'}))).status,200);
  assert.equal((await request(run.outcome_url,post({outcome:'failure'}))).status,409);
  assert.equal(db.sqlite.prepare("SELECT SUM(count) AS n FROM platform_daily WHERE event='execution_success'").get().n,1);
  assert.equal(db.sqlite.prepare("SELECT SUM(count) AS n FROM platform_daily WHERE event='outcome_success'").get().n,1);
 }finally{close();}
});
test('concurrent identical calls execute once; failure is uncharged and not retried automatically',async()=>{
 let calls=0;const {request,close}=setup({catalog:[fixture],handlers:{'test-only':{...handler,run:async p=>{calls++;await new Promise(r=>setTimeout(r,5));return handler.run(p);}}}});
 try{
  const results=await Promise.all([request('/v1/products/test-only/invoke',post(input)),request('/v1/products/test-only/invoke',post(input))]);
  assert.equal(calls,1);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const failure=await request('/v1/products/test-only/invoke',post({...input,input:{value:-1}},'failure_abcdefghijklmnopqrstuvwxyz'));
  assert.equal(failure.status,422);
  const again=await request('/v1/products/test-only/invoke',post({...input,input:{value:-1}},'failure_abcdefghijklmnopqrstuvwxyz'));assert.equal(again.status,409);
 }finally{close();}
});
test('a priced product without verified adapter fails closed',async()=>{
 const paid={...fixture,pricing:{amount_atomic:100,payments_enabled:true}};
 const {request,close}=setup({catalog:[paid],handlers:{'test-only':handler}});try{
  const r=await request('/v1/products/test-only/invoke',post(input));assert.equal(r.status,503);assert.equal((await r.json()).error.code,'payment_not_ready');
 }finally{close();}
});
test('telemetry separates synthetic from unclassified and stores no search text',async()=>{
 const {request,db,close}=setup();try{
  await request('/v1/products?q=private-secret',{headers:{'X-AgentToolbox-Sample':'synthetic'}});
  await request('/v1/products');
  const rows=db.sqlite.prepare('SELECT * FROM platform_daily').all();assert.equal(rows.length,2);assert.deepEqual(rows.map(x=>x.sample_kind).sort(),['synthetic','unclassified']);
  assert.ok(!JSON.stringify(rows).includes('private-secret'));
 }finally{close();}
});
test('rate limit fails explicitly before records',async()=>{
 const {request,db,close}=setup({limit:async()=>false});try{
  const r=await request('/v1/products');assert.equal(r.status,429);assert.equal(db.sqlite.prepare('SELECT count(*) AS n FROM platform_daily').get().n,0);
 }finally{close();}
});
test('official MCP SDK discovers active paid HTTP contract and retired stop',async()=>{
 const run=await start({port:0});const client=new Client({name:'platform-smoke',version:'1'},{capabilities:{}});
 try{
  await client.connect(new StreamableHTTPClientTransport(new URL(run.origin+'/mcp'),{requestInit:{headers:{'X-AgentToolbox-Sample':'synthetic'}}}));
   const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get_creator_terms','get_creator_tool','get_product','get_review','get_tool_submission','get_tool_update','invoke_product','leave_feedback','list_products','list_review_replies','list_reviews','reply_to_review','report_outcome','submit_review','submit_tool','submit_tool_update']);
  const list=await client.callTool({name:'list_products',arguments:{}});assert.deepEqual(list.structuredContent.products.map(p=>p.id),['docs-pack','quote-proof','contract-cases','mcp-wirecheck']);
  const paid=await client.callTool({name:'invoke_product',arguments:{product_id:'docs-pack',version:'0.1.0',input:{},max_charge_usdc_atomic:10000,idempotency_key:'mcp_paid_abcdefghijklmnopqrstuvwxyz'}});assert.equal(paid.isError,true);assert.match(paid.content[0].text,/paid_http_required/);
  const detail=await client.callTool({name:'get_product',arguments:{product_id:'retry-gate'}});assert.equal(detail.structuredContent.product.status,'retired');
  const retired=await client.callTool({name:'invoke_product',arguments:{product_id:'retry-gate',version:'0.1.0',input:{},max_charge_usdc_atomic:0,idempotency_key:'mcp_test_abcdefghijklmnopqrstuvwxyz'}});assert.equal(retired.isError,true);assert.match(retired.content[0].text,/product_retired/);
 }finally{await client.close();await run.close();}
});
