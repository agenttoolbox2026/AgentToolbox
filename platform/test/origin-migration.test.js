// All purchases, capabilities, URLs and adapters in this file are local fixtures.
// No real wallet, facilitator, target endpoint or production database is contacted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {encodePaymentSignatureHeader,decodePaymentRequiredHeader} from '@x402/core/http';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
import {paidInvocation,quotedPayment,discoveryChallenge} from '../src/x402.js';
import {prepareResult,expirePreparations} from '../src/preparations.js';
import {expirePaidResults} from '../src/purchases.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC} from '../src/payment-config.js';
import {hash} from '../src/telemetry.js';
import {MCP_WIRE_ENDPOINTS} from '../src/mcp-wirecheck.js';
import {USER_AGENT} from '../src/docs-pack.js';
import {freeExampleManifest} from '../src/free-examples.js';
const OLD='https://old-origin.example.invalid',AGI='https://agi-origin.example.invalid';
const product={id:'migration-fixture',version:'1.0.0',status:'validation',name:'Local fixture',summary:'Local migration tests',problem:'Testing',tags:[],outcome:{success_criterion:'Positive integer doubled'},pricing:{payments_enabled:true,minimum_amount_atomic:'10000'}};
const config={enabled:true,live:false,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:'0x'+'1'.repeat(40)};
const payer='0x'+'2'.repeat(40),transaction='0x'+'c'.repeat(64),capability='atbp_'+Buffer.alloc(32,7).toString('base64url');
const key='migration_'+('a'.repeat(32)),input={n:2},body={version:product.version,input,max_charge_usdc_atomic:'10000'};
const path='/v1/products/'+product.id+'/invoke';
function setup(){
 const db=database(),counts={run:0,verify:0,settle:0,adapter:0};let date=new Date();
 const handler={input:z.strictObject({n:z.number().int()}),output:z.strictObject({n:z.number().int()}),run:async input=>{counts.run++;return {n:input.n*2};},success:result=>result.n>0,preview:()=>({validated:true})};
 const now=()=>date;
 const request=(origin=OLD,secret=capability)=>new Request(origin+path,{headers:{'X-Preparation-Capability':secret}});
 const payment=(origin=OLD,amount='10000')=>({x402Version:2,resource:{url:origin+path,description:'Local fixture'},accepted:paymentRequirements(product,config,amount),payload:{signature:'0x'+'0'.repeat(130),authorization:{from:payer,to:config.payTo,value:amount,validAfter:String(Math.floor(date.getTime()/1000)-1),validBefore:String(Math.floor(date.getTime()/1000)+300),nonce:'0x'+'a'.repeat(64)}}});
 const adapterFactory=async({amount})=>{counts.adapter++;return {requirements:paymentRequirements(product,config,amount),verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;return {success:true,network:BASE_NETWORK,transaction,payer,amount};}};};
 const invoke=({origin=OLD,payload=payment(),value=body,secret=capability,customConfig=config,customHandler=handler,customAdapter=adapterFactory,trackingEnabled=false}={})=>paidInvocation({db,request:new Request(origin+path,{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'X-Preparation-Capability':secret,'X-AgentToolbox-Sample':'synthetic'}}),body:value,key,product,handler:customHandler,config:customConfig,origin,adapterFactory:customAdapter,now,trackingEnabled});
 const prepare=async(origin=OLD)=>prepareResult({db,request:request(origin),body:{version:product.version,input,request_id:'preparation_'+('b'.repeat(32)),prepare_secret_hash:await hash(capability)},product,handler,config,client:'local',now});
 const quote=(prepared_id,origin=OLD)=>quotedPayment({db,request:request(origin),body:{version:product.version,payment_amount_atomic:'10001',...(prepared_id?{prepared_id}:{input})},product,handler,config,origin,now});
 return {db,counts,handler,request,payment,adapterFactory,invoke,prepare,quote,now,setDate:d=>{date=d;},close:()=>db.close()};
}
test('new challenges change only resource origin; exact payment and success pins stay stable',async()=>{
 const old=await discoveryChallenge({product,config,origin:OLD}),agi=await discoveryChallenge({product,config,origin:AGI});
 const a=decodePaymentRequiredHeader(old.headers.get('PAYMENT-REQUIRED')),b=decodePaymentRequiredHeader(agi.headers.get('PAYMENT-REQUIRED'));
 assert.equal(a.resource.url,OLD+path);assert.equal(b.resource.url,AGI+path);assert.deepEqual(a.accepts,b.accepts);
 const oldBody=await old.json(),agiBody=await agi.json();assert.deepEqual(oldBody.payment_requirements_pin,agiBody.payment_requirements_pin);assert.deepEqual(oldBody.contract_pins,agiBody.contract_pins);
});
test('old exact paid packet replays at AGI without adapter, handler or settlement even after terms change',async()=>{
 const s=setup();try{
  const payload=s.payment(),first=await s.invoke({payload}),result=await first.json(),receipt=first.headers.get('PAYMENT-RESPONSE');
  const before=JSON.stringify(s.db.sqlite.prepare('SELECT * FROM platform_payments').all());
  const replay=await s.invoke({origin:AGI,payload,customConfig:{enabled:false},customHandler:null,customAdapter:()=>{throw new Error('Replay called adapter');}});
  assert.deepEqual(await replay.json(),result);assert.equal(replay.headers.get('PAYMENT-RESPONSE'),receipt);
  assert.equal(JSON.stringify(s.db.sqlite.prepare('SELECT * FROM platform_payments').all()),before);
  assert.deepEqual(s.counts,{run:1,verify:1,settle:1,adapter:1});
  for(const mutate of [p=>p.resource.url=AGI+path,p=>delete p.resource]){
   const changed=structuredClone(payload);mutate(changed);
   await assert.rejects(s.invoke({origin:AGI,payload:changed}),e=>e.code==='payment_replay_conflict');
  }
  await assert.rejects(s.invoke({origin:AGI,payload,value:{...body,input:{n:3}}}),e=>e.code==='payment_replay_conflict');assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('unresolved old operation on AGI never retries settlement or releases the durable result',async()=>{
 const s=setup();try{
  const payload=s.payment();await assert.rejects(s.invoke({payload,customAdapter:async args=>({...await s.adapterFactory(args),settle:async()=>{s.counts.settle++;throw new Error('Local uncertain settlement');}})}),e=>e.code==='settlement_unresolved');
  s.setDate(new Date(s.now().getTime()+90000000));await expirePaidResults(s.db,s.now());await expirePreparations(s.db,s.now(),{preserveRecords:true});
  await assert.rejects(s.invoke({origin:AGI,payload,customAdapter:()=>{throw new Error('No settlement retry');}}),e=>e.code==='settlement_unresolved');
  assert.equal(s.counts.settle,1);assert(s.db.sqlite.prepare('SELECT result_json FROM platform_payments').get().result_json);
 }finally{s.close();}
});
test('cross-origin concurrent identical first claims execute and settle exactly once',async()=>{
 const s=setup();try{
  const payload=s.payment();const results=await Promise.allSettled([s.invoke({origin:OLD,payload}),s.invoke({origin:AGI,payload})]);
  assert(results.some(r=>r.status==='fulfilled'));assert.equal(s.counts.run,1);assert.equal(s.counts.settle,1);
  const result=await(await s.invoke({origin:AGI,payload})).json();assert.equal(result.output.n,4);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,1);
 }finally{s.close();}
});
test('old preview and quote move with exact capabilities, amounts, pins and expiry; no refetch or TTL extension',async()=>{
 const s=setup();try{
  const preview=await s.prepare(),saved=s.db.sqlite.prepare('SELECT * FROM platform_preparations').get(),quote=await s.quote(preview.prepared_id);
  assert.deepEqual(await s.prepare(AGI),preview);assert.equal(s.counts.run,1);
  assert.deepEqual(s.db.sqlite.prepare('SELECT * FROM platform_preparations').get(),saved);
  const value={version:product.version,prepared_id:preview.prepared_id,quote_id:quote.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'};
  const payload=s.payment(OLD,'10001'),result=await(await s.invoke({origin:AGI,payload,value})).json();assert.equal(result.output.n,4);assert.equal(s.counts.run,1);assert.equal(s.counts.settle,1);
  s.setDate(new Date(s.now().getTime()+901000));assert.deepEqual(await(await s.invoke({origin:AGI,payload,value})).json(),result);
  await assert.rejects(s.invoke({origin:AGI,payload,value,secret:'atbp_'+Buffer.alloc(32,8).toString('base64url')}),e=>e.code==='preparation_capability_invalid');
  assert.equal(s.db.sqlite.prepare('SELECT expires_at FROM platform_quotes').get().expires_at,quote.expires_at);
 }finally{s.close();}
});
test('preserving expired unpaid rows keeps history but does not make a quote or preview payable',async()=>{
 const s=setup();try{
  const p=await s.prepare(),q=await s.quote(p.prepared_id),before=JSON.stringify({preparations:s.db.sqlite.prepare('SELECT * FROM platform_preparations').all(),quotes:s.db.sqlite.prepare('SELECT * FROM platform_quotes').all()});
  s.setDate(new Date(s.now().getTime()+90000000));await expirePreparations(s.db,s.now(),{preserveRecords:true});
  assert.equal(JSON.stringify({preparations:s.db.sqlite.prepare('SELECT * FROM platform_preparations').all(),quotes:s.db.sqlite.prepare('SELECT * FROM platform_quotes').all()}),before);
  const value={version:product.version,prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'};
  await assert.rejects(s.invoke({origin:AGI,payload:s.payment(OLD,'10001'),value}),e=>e.code==='quote_expired');assert.equal(s.counts.adapter,0);assert.equal(s.counts.settle,0);
  await assert.rejects(s.prepare(AGI),e=>e.code==='preparation_expired');
 }finally{s.close();}
});
test('tracking disabled preserves existing metrics and financial records while recording no new events',async()=>{
 const s=setup();try{
  const old=createPlatform({db:s.db,origin:OLD,catalog:[product],handlers:{[product.id]:s.handler},payments:config});
  await old(new Request(OLD+'/v1/products'));const snapshot=JSON.stringify(s.db.sqlite.prepare('SELECT * FROM platform_daily').all());
  const app=createPlatform({db:s.db,origin:AGI,catalog:[product],handlers:{[product.id]:s.handler},payments:config,paymentAdapterFactory:s.adapterFactory,trackingEnabled:false});
  await app(new Request(AGI+'/v1/products'));await app(new Request(AGI+'/v1/products/'+product.id));
  const unsigned=await app(new Request(AGI+path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));assert.equal(unsigned.status,402);
  const paid=await app(new Request(AGI+path,{method:'POST',headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':encodePaymentSignatureHeader(s.payment(AGI)),'Idempotency-Key':key,'X-AgentToolbox-Sample':'synthetic'},body:JSON.stringify(body)}));
  assert.equal(paid.status,200);const result=await paid.json();
  const outcome=await app(new Request(AGI+'/v1/runs/'+result.operation_id+'/outcome',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome:'success'})}));assert.equal(outcome.status,200);
  assert.equal(JSON.stringify(s.db.sqlite.prepare('SELECT * FROM platform_daily').all()),snapshot);
  assert.equal(s.db.sqlite.prepare('SELECT state,outcome FROM platform_payments').get().state,'settled');assert.equal(s.db.sqlite.prepare('SELECT outcome FROM platform_payments').get().outcome,'success');
  assert(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payment_ledger').get().n>=2);assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('free invocation with tracking off retains exact delivery and outcome without caller pseudonym tracking',async()=>{
 const s=setup();try{
  const free={...product,pricing:{model:'free',amount_atomic:0,payments_enabled:false}},app=createPlatform({db:s.db,origin:AGI,catalog:[free],handlers:{[free.id]:s.handler},trackingEnabled:false});
  const value={...body,max_charge_usdc_atomic:0,agent_id:crypto.randomUUID()},make=()=>new Request(AGI+path,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(value)});
  const first=await(await app(make())).json();assert.equal(first.execution,'completed');assert.deepEqual(await(await app(make())).json(),first);
  assert.equal(s.db.sqlite.prepare('SELECT caller_hash FROM platform_runs').get().caller_hash,null);assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_callers').get().n,0);assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_daily').get().n,0);assert.equal(s.counts.run,1);
 }finally{s.close();}
});
test('early AGI telemetry option also disables tracking, including when trackingEnabled defaults to true',async()=>{
 const db=database();try{
  const app=createPlatform({db,origin:AGI,telemetryEnabled:false});
  assert.equal((await app(new Request(AGI+'/v1/products'))).status,200);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_daily').get().n,0);
 }finally{db.close();}
});
test('asset binding receives safe method/path without incoming secrets or query; POST never reaches assets',async()=>{
 const db=database(),seen=[];try{
  const app=createPlatform({db,origin:AGI,trackingEnabled:false,assets:{fetch:async request=>{seen.push(request);return new Response('asset');}}});
  for(const method of ['GET','HEAD']){
   const response=await app(new Request(AGI+'/site.js?private=fixture',{method,headers:{Authorization:'Bearer local-fixture',Cookie:'private=fixture','PAYMENT-SIGNATURE':'local-fixture','X-Creator-Capability':'local-fixture','X-Preparation-Capability':'local-fixture','X-Referral-Capability':'local-fixture'}}));
   assert.equal(response.status,200);assert.equal(seen.at(-1).url,AGI+'/site.js');assert.equal(seen.at(-1).method,method);assert.equal([...seen.at(-1).headers].length,0);assert.equal(seen.at(-1).body,null);
  }
  assert.equal((await app(new Request(AGI+'/site.js',{method:'POST',body:'private'}))).status,405);assert.equal(seen.length,2);
 }finally{db.close();}
});
test('MCP origin checks stay explicit and CORS never grants browser credentials',async()=>{
 const db=database();try{
  const app=createPlatform({db,origin:AGI,trackingEnabled:false});
  const headers={Origin:OLD,'Content-Type':'application/json',Accept:'application/json, text/event-stream'};
  const bad=await app(new Request(AGI+'/mcp',{method:'POST',headers,body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}));assert.equal(bad.status,403);assert.equal((await bad.json()).error.code,'origin_not_allowed');
  const allowed=await app(new Request(AGI+'/mcp',{method:'POST',headers:{...headers,Origin:AGI},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list'})}));assert.equal(allowed.status,200);
  const preflight=await app(new Request(AGI+'/v1/tool-submissions',{method:'OPTIONS',headers:{Origin:OLD,'Access-Control-Request-Method':'POST'}}));assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
 }finally{db.close();}
});
test('current endpoint examples and respectful crawler identity name AGI without changing products',()=>{
 assert.deepEqual(MCP_WIRE_ENDPOINTS,['https://agi.agenttoolbox2026.workers.dev/mcp']);assert.match(USER_AGENT,/https:\/\/agi\.agenttoolbox2026\.workers\.dev\/humans/);
 const fixtures=freeExampleManifest('mcp-wirecheck');assert(fixtures.cases.filter(c=>c.expected.input_valid).every(c=>c.input.endpoint==='https://agi.agenttoolbox2026.workers.dev/mcp'));
});
