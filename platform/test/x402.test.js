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
 const execute=async({signed=true,value=body,customPayload=payload,customKey=key,method='POST',path=url,customConfig=config}={})=>{
  const request=new Request(path,{method,headers:{...(signed?{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(customPayload)}:{}),'X-AgentToolbox-Sample':'synthetic'}});
  return paidInvocation({request,body:value,key:customKey,product,handler:{...(overrideHandler??handler),run:async p=>{counts.execute++;return (overrideHandler??handler).run(p);}},db,config:customConfig,adapterFactory:async()=>adapter});
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
 }finally{s.close();}
});
test('free-credit exhaustion fails closed with no automatic provider upgrade or second charge',async()=>{
 const s=await setup({settle:async()=>({success:false,errorReason:'free_tier_exhausted',network:BASE_NETWORK,transaction:''})});
 try{await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');await assert.rejects(s.execute(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);}finally{s.close();}
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
