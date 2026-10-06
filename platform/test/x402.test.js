import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {sdkAdapter,BASE_NETWORK,BASE_USDC,paidInvocation} from '../src/x402.js';
import {encodePaymentSignatureHeader,decodePaymentRequiredHeader,decodePaymentResponseHeader} from '@x402/core/http';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
const payTo='0x1111111111111111111111111111111111111111';
const payer='0x2222222222222222222222222222222222222222';
const nonce='0x'+'ab'.repeat(32),transaction='0x'+'cd'.repeat(32);
const product={id:'paid-fixture',version:'1.0.0',name:'Test only',status:'validation',summary:'Never deployed',problem:'Test',tags:[],outcome:{success_criterion:'Double the nonnegative integer'},pricing:{amount_atomic:1000,payments_enabled:true}};
const body={version:'1.0.0',input:{n:3},max_charge_usdc_atomic:1000};
const handler={input:z.strictObject({n:z.number().int()}),output:z.strictObject({value:z.number().int()}),run:async p=>({value:p.n*2}),success:async p=>p.value>=0};
const config={enabled:true,receiverConfirmed:true,network:BASE_NETWORK,payTo};
const key='payment_test_abcdefghijklmnopqrstuvwxyz12345';
const url='https://example.invalid/v1/products/paid-fixture/invoke';
async function setup({settle,db:overrideDb,handler:overrideHandler}={}){
 const db=overrideDb??database();const counts={verify:0,settle:0,execute:0};
 const facilitator={
 getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:BASE_NETWORK}],extensions:[],signers:{}}),
 verify:async()=>{counts.verify++;return {isValid:true,payer};},
 settle:async()=>{counts.settle++;return settle?settle():{success:true,network:BASE_NETWORK,transaction,payer,amount:'1000'};},
 };
 const adapter=await sdkAdapter({payTo,amount:1000,facilitatorClient:facilitator});
 const now=Math.floor(Date.now()/1000);
 const payload={x402Version:2,resource:{url,description:'Mock fixture',mimeType:'application/json'},accepted:adapter.requirements,
 payload:{signature:'0x'+'00'.repeat(65),authorization:{from:payer,to:payTo,value:'1000',validAfter:String(now-1),validBefore:String(now+300),nonce}}};
 const execute=async({signed=true,value=body,customPayload=payload,customKey=key,method='POST',path=url,customConfig=config,synthetic=true,customNow=()=>new Date()}={})=>{
  const request=new Request(path,{method,headers:{...(signed?{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(customPayload)}:{}),...(synthetic?{'X-AgentToolbox-Sample':'synthetic'}:{})}});
  return paidInvocation({request,body:value,key:customKey,product,handler:{...(overrideHandler??handler),run:async p=>{counts.execute++;return (overrideHandler??handler).run(p);}},db,config:customConfig,adapterFactory:async()=>adapter,now:customNow});
 };
 return {db,counts,adapter,payload,execute,close:()=>db.close()};
}
test('official SDK produces unsigned 402 requirements without verify or settlement',async()=>{
 const s=await setup();try{const r=await s.execute({signed:false});assert.equal(r.status,402);const required=decodePaymentRequiredHeader(r.headers.get('PAYMENT-REQUIRED'));assert.equal(required.x402Version,2);assert.equal(required.accepts[0].asset,BASE_USDC);assert.equal(required.accepts[0].amount,'1000');assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);}finally{s.close();}
});
test('wrong chain, recipient, amount, expiry and charge cap are rejected before facilitator verification',async()=>{
 const s=await setup();try{
  for(const mutate of [
   p=>p.accepted.network='eip155:84532',p=>p.payload.authorization.to=payer,
   p=>p.payload.authorization.value='999',p=>p.payload.authorization.validBefore='1',
   p=>p.accepted.extra.assetTransferMethod='permit2']){
   const p=structuredClone(s.payload);mutate(p);await assert.rejects(s.execute({customPayload:p}),e=>e.status===400);
  }
  await assert.rejects(s.execute({value:{...body,max_charge_usdc_atomic:0}}),e=>e.code==='charge_cap_exceeded');
  assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});
test('failed outcome never settles; duplicate cannot run or charge again',async()=>{
 const s=await setup();try{
  await assert.rejects(s.execute({value:{...body,input:{n:-1}}}),e=>e.code==='outcome_not_met');
  await assert.rejects(s.execute({value:{...body,input:{n:-1}}}),e=>e.code==='outcome_not_met');
  assert.equal(s.counts.execute,1);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});
test('concurrent same request settles once; lost-delivery replay returns durable result/receipt',async()=>{
 let release;
 const executionGate=new Promise(resolve=>{release=resolve;});
 const s=await setup({handler:{...handler,run:async input=>{await executionGate;return handler.run(input);}}});try{
  const original=s.execute();
  while(s.counts.execute===0)await new Promise(resolve=>setTimeout(resolve,1));
  await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');
  assert.equal(s.counts.execute,1);assert.equal(s.counts.settle,0);
  release();
  const first=await(await original).json();
  const replay=await s.execute();assert.deepEqual(await replay.json(),first);
  assert.equal(decodePaymentResponseHeader(replay.headers.get('PAYMENT-RESPONSE')).transaction,transaction);
  assert.equal(s.counts.execute,1);assert.equal(s.counts.settle,1);
  await assert.rejects(s.execute({value:{...body,input:{n:7}}}),e=>e.code==='payment_replay_conflict');
  await assert.rejects(s.execute({customKey:'new_key_abcdefghijklmnopqrstuvwxyz123456'}),e=>e.code==='authorization_already_used');
  assert.equal(s.counts.settle,1);
  assert.throws(()=>s.db.sqlite.exec("DELETE FROM platform_payment_ledger"),/append_only/);
 }finally{release();s.close();}
});
test('database failure before settlement sends no settlement call',async()=>{
 const real=database();const db={...real,prepare(sql){if(sql.includes("state='outcome_ready'"))throw new Error('disk unavailable');return real.prepare(sql);}};
 const s=await setup({db});try{await assert.rejects(s.execute(),/disk unavailable/);assert.equal(s.counts.settle,0);}finally{s.close();}
});
test('settlement timeout stays unknown and withholds output without recharge',async()=>{
 const s=await setup({settle:async()=>{throw new Error('timeout');}});try{
  await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');
  assert.equal(s.db.sqlite.prepare('SELECT state FROM platform_payments').get().state,'unknown');
  await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);
  await assert.rejects(s.execute({customNow:()=>new Date(Date.now()+3600000)}),e=>e.code==='settlement_unresolved');
  assert.equal(s.counts.execute,1);assert.equal(s.counts.verify,1);assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('free-credit exhaustion fails closed with no automatic provider upgrade or second charge',async()=>{
 const s=await setup({settle:async()=>({success:false,errorReason:'free_tier_exhausted',network:BASE_NETWORK,transaction:''})});
 try{await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);}finally{s.close();}
});
test('SDK settlement_pending is not automatically retried',async()=>{
 const s=await setup({settle:async()=>({success:false,errorReason:'settlement_pending',network:BASE_NETWORK,transaction,payer})});
 try{await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);}finally{s.close();}
});
test('ledger failure after settlement leaves unresolved state; replay cannot recharge',async()=>{
 const real=database();const db={...real,prepare(sql){const statement=real.prepare(sql);if(!sql.startsWith('INSERT INTO platform_payment_ledger'))return statement;return {bind(...args){if(args[4]==='settlement_reported')return {run:async()=>{throw new Error('ledger unavailable');}};return statement.bind(...args);}};}};
 const s=await setup({db});try{await assert.rejects(s.execute(),/ledger unavailable/);assert.equal(s.counts.settle,1);await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);}finally{s.close();}
});
test('HEAD, alternate path and unconfirmed receiving config cannot enter payment flow',async()=>{
 const s=await setup();try{
  await assert.rejects(s.execute({method:'HEAD'}),e=>e.status===405);
  await assert.rejects(s.execute({path:url+'/extra'}),e=>e.status===405);
  await assert.rejects(s.execute({customConfig:{...config,receiverConfirmed:false}}),e=>e.code==='payment_not_ready');
  assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});
test('HTTP adapter exposes official payment challenge only for explicit callable test product',async()=>{
 const s=await setup();try{
  const app=createPlatform({db:s.db,origin:'https://example.invalid',catalog:[product],handlers:{'paid-fixture':handler},payments:config,paymentAdapterFactory:async()=>s.adapter});
  const r=await app(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-AgentToolbox-Sample':'synthetic'},body:JSON.stringify(body)}));
  assert.equal(r.status,402);assert.ok(r.headers.get('PAYMENT-REQUIRED'));assert.equal(s.counts.settle,0);
 }finally{s.close();}
});

test('live counter includes only completed non-synthetic purchases and excludes repeated delivery',async()=>{
 const s=await setup();try{
  const read=async()=>Number((await s.db.prepare('SELECT value FROM platform_public_totals WHERE key=?').bind('paid_purchases').first()).value);
  assert.equal(await read(),0);
  await s.execute({synthetic:false,customConfig:{...config,live:true}});
  assert.equal(await read(),1);
  await s.execute({synthetic:false,customConfig:{...config,live:true}});
  assert.equal(await read(),1);
  assert.equal(s.counts.settle,1);
  const second=structuredClone(s.payload);second.payload.authorization.nonce='0x'+'bb'.repeat(32);
  await s.execute({customPayload:second,customKey:'synthetic_other_abcdefghijklmnopqrstuvwxyz',customConfig:{...config,live:true}});
  assert.equal(await read(),1);
  const third=structuredClone(s.payload);third.payload.authorization.nonce='0x'+'cc'.repeat(32);
  await s.execute({customPayload:third,customKey:'mock_other_abcdefghijklmnopqrstuvwxyz',synthetic:false});
  assert.equal(await read(),1);
  const fourth=structuredClone(s.payload);fourth.payload.authorization.nonce='0x'+'dd'.repeat(32);
  await s.execute({customPayload:fourth,customKey:'repeat_customer_abcdefghijklmnopqrstuvwxyz',synthetic:false,customConfig:{...config,live:true}});
  assert.equal(await read(),2);
  assert.throws(()=>s.db.sqlite.exec('DELETE FROM platform_paid_purchases'),/append_only/);
 }finally{s.close();}
});
test('unresolved and failed operations never increment public purchases',async()=>{
 const s=await setup({settle:async()=>{throw new Error('timeout');}});try{
  await assert.rejects(s.execute({synthetic:false,customConfig:{...config,live:true}}),e=>e.code==='settlement_unresolved');
  assert.equal(s.db.sqlite.prepare('SELECT value FROM platform_public_totals').get().value,0);
 }finally{s.close();}
 const f=await setup();try{await assert.rejects(f.execute({value:{...body,input:{n:-1}},synthetic:false,customConfig:{...config,live:true}}));assert.equal(f.db.sqlite.prepare('SELECT value FROM platform_public_totals').get().value,0);}finally{f.close();}
});
test('settled replay works after authorization expiry; retained output expires without a second charge',async()=>{
 const s=await setup();try{
  const original=await(await s.execute()).json();
  const later=()=>new Date(Date.now()+3600000);
  assert.deepEqual(await(await s.execute({customNow:later})).json(),original);
  await assert.rejects(s.execute({customNow:()=>new Date(Date.now()+90000000)}),e=>e.code==='paid_result_expired');
  assert.equal(s.counts.settle,1);assert.equal(s.db.sqlite.prepare('SELECT result_json FROM platform_payments').get().result_json,null);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_payment_ledger').get().n,3);
 }finally{s.close();}
});
test('paid usefulness report is private, idempotent and never causes a payment',async()=>{
 const s=await setup();try{
  const result=await(await s.execute()).json();
  const app=createPlatform({db:s.db,origin:'https://example.invalid'});
  const report=outcome=>app(new Request('https://example.invalid'+result.outcome_url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({outcome})}));
  assert.equal((await report('success')).status,200);assert.equal((await report('success')).status,200);assert.equal((await report('failure')).status,409);
  assert.equal(s.counts.settle,1);assert.equal(s.db.sqlite.prepare("SELECT SUM(count) AS n FROM platform_daily WHERE event='outcome_success'").get().n,1);
 }finally{s.close();}
});
test('unsigned client flags cannot create a live purchase or advance the public counter',async()=>{
 const s=await setup();try{
  const app=createPlatform({db:s.db,origin:'https://example.invalid',catalog:[product],handlers:{[product.id]:handler},payments:{...config,live:true},paymentAdapterFactory:async()=>s.adapter});
  for(const flag of ['live','settled','unclassified','synthetic']){
   const response=await app(new Request(url,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,'X-AgentToolbox-Sample':flag,'X-Payment-Status':'settled','X-Is-Live':'true'},body:JSON.stringify(body)}));
   assert.equal(response.status,402);
  }
  assert.equal(s.counts.verify,0);assert.equal(s.counts.execute,0);assert.equal(s.counts.settle,0);
  assert.equal(s.db.sqlite.prepare('SELECT count(*) AS n FROM platform_payments').get().n,0);
  assert.equal(s.db.sqlite.prepare('SELECT value FROM platform_public_totals').get().value,0);
 }finally{s.close();}
});

test('caller commitment binds original paid request, is private and is never replaceable on replay',async()=>{
 const {hash}=await import('../src/telemetry.js');const secret='atbr_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const commitment=await hash(secret),s=await setup();try{
  const value={...body,review_secret_hash:commitment},result=await(await s.execute({value,synthetic:false,customConfig:{...config,live:true}})).json();
  const row=s.db.sqlite.prepare('SELECT * FROM platform_payments').get();assert.equal(row.review_secret_hash,commitment);assert.equal(row.state,'settled');assert(!JSON.stringify(row).includes(secret));assert(!JSON.stringify(result).includes(commitment));
  assert.deepEqual(await(await s.execute({value,synthetic:false,customConfig:{...config,live:true}})).json(),result);
  for(const changed of [body,{...body,review_secret_hash:'f'.repeat(64)}])await assert.rejects(s.execute({value:changed}),e=>e.code==='payment_replay_conflict');
  assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('malformed commitment or raw secret cannot reach verification, work or settlement',async()=>{
 const s=await setup();try{
  for(const extra of [{review_secret_hash:'bad'},{review_secret:'atbr_'+'A'.repeat(43)}])await assert.rejects(s.execute({value:{...body,...extra}}),e=>e.code==='invalid_input');
  assert.deepEqual(s.counts,{verify:0,settle:0,execute:0});
 }finally{s.close();}
});
test('commitment storage failure happens before work and settlement; failed work never activates proof',async()=>{
 const real=database(),db={...real,prepare(sql){if(sql.startsWith('INSERT OR IGNORE INTO platform_payments'))throw new Error('storage unavailable');return real.prepare(sql);}};
 const s=await setup({db});try{await assert.rejects(s.execute({value:{...body,review_secret_hash:'a'.repeat(64)}}),/storage unavailable/);assert.equal(s.counts.settle,0);assert.equal(s.counts.execute,0);}finally{s.close();}
 const f=await setup();try{await assert.rejects(f.execute({value:{...body,input:{n:-1},review_secret_hash:'b'.repeat(64)},synthetic:false,customConfig:{...config,live:true}}));assert.equal(f.db.sqlite.prepare('SELECT review_secret_hash FROM platform_payments').get().review_secret_hash,'b'.repeat(64));assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_paid_purchases').get().n,0);assert.equal(f.counts.settle,0);}finally{f.close();}
});
