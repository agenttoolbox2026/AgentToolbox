import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {encodePaymentSignatureHeader} from '@x402/core/http';
import {database} from '../scripts/local-db.js';
import {creatorBeneficiary} from '../src/submissions.js';
import {paidInvocation} from '../src/x402.js';
import {BASE_NETWORK,BASE_USDC,paymentRequirements} from '../src/payment-config.js';
const creatorId='creator-00000000-0000-4000-8000-000000000001',origin='https://fixture.invalid';
const denied=e=>e.status===503&&e.code==='creator_adapter_unavailable';
const noDb={prepare(){throw Error('No database lookup should occur for an absent adapter marker');}};
test('creator IDs and every explicit non-platform provider require a creator adapter even when omitted or malformed',async()=>{
 const sellerProducts=[{id:creatorId},{id:creatorId,provider:{id:'agenttoolbox',type:'first_party'}},...['creator','external','third_party','unknown'].map(type=>({id:'fixture-product',provider:{id:'seller',type}})),{id:'fixture-product',provider:{id:'seller',type:'first_party'}},{id:'fixture-product',provider:{type:'first_party'}}];
 for(const p of sellerProducts)for(const adapter of [undefined,null,'','   ',false,42,'x'.repeat(257)])await assert.rejects(creatorBeneficiary(noDb,p,{creatorAdapterId:adapter}),denied);
 await assert.rejects(creatorBeneficiary(noDb,{id:creatorId},null),denied);
});
test('platform products and legacy unlabeled noncreator fixtures retain no-beneficiary behavior; malformed explicit markers never fall through',async()=>{
 const none={tool_id:null,creator_id:null,share_bps:null};
 for(const p of [{id:'docs-pack',provider:{id:'agenttoolbox',type:'first_party'}},{id:'legacy-local-fixture'}])assert.deepEqual(await creatorBeneficiary(noDb,p,{}),none);
 for(const adapter of [null,'',false])await assert.rejects(creatorBeneficiary(noDb,{id:'docs-pack',provider:{id:'agenttoolbox',type:'first_party'}},{creatorAdapterId:adapter}),denied);
});
test('an explicit seller adapter still requires the exact approved stable entitlement mapping',async()=>{
 const db=database();try{
  for(const p of [{id:creatorId},{id:'docs-pack',provider:{type:'creator',id:'seller'}}])await assert.rejects(creatorBeneficiary(db,p,{creatorAdapterId:'local-compiled-adapter'}),denied);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_entitlements').get().n,0);
 }finally{db.close();}
});
test('signed miswired creator invocation fails before adapter creation, authorization verification, execution or payment admission',async()=>{
 const db=database(),product={id:creatorId,provider:{type:'creator',id:'local'},version:'0.1.0',status:'validation',pricing:{payments_enabled:true,minimum_amount_atomic:'10000'}},config={enabled:true,live:false,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:'0x'+'1'.repeat(40)},terms=paymentRequirements(product,config),seconds=Math.floor(Date.now()/1000);
 const payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'00'.repeat(65),authorization:{from:'0x'+'2'.repeat(40),to:config.payTo,value:'10000',nonce:'0x'+'3'.repeat(64),validAfter:String(seconds-1),validBefore:String(seconds+300)}}};
 const counts={adapter:0,execute:0},handler={input:z.strictObject({n:z.number()}),output:z.strictObject({n:z.number()}),run:async()=>{counts.execute++;return {n:1};},success:()=>true};
 try{
  await assert.rejects(paidInvocation({db,product,handler,config,origin,body:{version:'0.1.0',input:{n:1},max_charge_usdc_atomic:'10000'},key:crypto.randomUUID(),request:new Request(origin+'/v1/products/'+creatorId+'/invoke',{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload)}}),adapterFactory:async()=>{counts.adapter++;throw Error('Must not instantiate payment adapter');}}),denied);
  assert.deepEqual(counts,{adapter:0,execute:0});for(const table of ['platform_payments','platform_payment_ledger','platform_live_receipts','platform_creator_allocations'])assert.equal(db.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
 }finally{db.close();}
});
