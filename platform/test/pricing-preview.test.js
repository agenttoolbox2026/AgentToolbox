import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {database} from '../scripts/local-db.js';
import {hash} from '../src/telemetry.js';
import {paidInvocation,quotedPayment,paymentChallenge} from '../src/x402.js';
import {prepareResult,expirePreparations} from '../src/preparations.js';
import {paymentRequirements,MAX_UINT256,BASE_NETWORK,BASE_USDC,isAtomicAmount} from '../src/payment-config.js';
import {encodePaymentSignatureHeader} from '@x402/core/http';
import {exactLedgerTotals} from '../src/exact-totals.js';
const payer='0x'+'2'.repeat(40),payTo='0x'+'1'.repeat(40),transaction='0x'+'c'.repeat(64),secret='atbp_'+Buffer.alloc(32,7).toString('base64url');
const product={id:'pricing-fixture',version:'1.0.0',status:'validation',pricing:{payments_enabled:true,minimum_amount_atomic:'10000'}};
const config={enabled:true,live:false,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo};
const origin='https://example.invalid',url=origin+'/v1/products/'+product.id+'/invoke';
function setup(){
 const db=database(),counts={run:0,verify:0,settle:0};let date=new Date();
 const handler={input:z.strictObject({n:z.number().int().min(1)}),output:z.strictObject({n:z.number().int(),private:z.string()}),run:async input=>{counts.run++;return {n:input.n,private:'full-result-never-in-preview'};},success:()=>true,preview:result=>({validated:true,fields:2})};
 const request=()=>new Request(url,{headers:{'X-Preparation-Capability':secret}}),now=()=>date;
 const prepare=async(extra={},requestOverride=request(),client='client')=>prepareResult({db,request:requestOverride,body:{version:product.version,input:{n:1},request_id:'request_'+crypto.randomUUID().replaceAll('-',''),prepare_secret_hash:await hash(secret),...extra},product,handler,config,client,now});
 const quote=async(amount='10001',prepared_id,extra={})=>quotedPayment({db,request:request(),body:{version:product.version,payment_amount_atomic:amount,...(prepared_id?{prepared_id}:{input:{n:1}}),...extra},product,handler,config,origin,now});
 const invoke=async({body={version:product.version,input:{n:1},max_charge_usdc_atomic:'10000'},amount=body.payment_amount_atomic??'10000',nonce='a',key='key_'+('a'.repeat(32)),customProduct=product,customConfig=config,capability=secret,settle}={})=>{
  const terms=paymentRequirements(product,config,amount),seconds=Math.floor(date.getTime()/1000);
  const payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'0'.repeat(130),authorization:{from:payer,to:payTo,value:amount,validAfter:String(seconds-1),validBefore:String(seconds+300),nonce:'0x'+nonce.repeat(64)}}};
  return paidInvocation({db,request:new Request(url,{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'X-Preparation-Capability':capability,'X-AgentToolbox-Sample':'synthetic'}}),body,key,product:customProduct,handler,config:customConfig,now,adapterFactory:async({amount})=>({requirements:paymentRequirements(product,config,amount),verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;if(settle)return settle();return {success:true,network:BASE_NETWORK,transaction,payer,amount};}})});
 };
 return {db,counts,handler,prepare,quote,invoke,request,now,setDate:value=>{date=value;},close:()=>db.close()};
}
test('minimum compatibility, +1 atomic, higher and uint256 boundary remain exact; high quotes omit Bazaar',async()=>{
 for(const amount of ['10000','10001','100000000000000000000',MAX_UINT256]){const s=setup();try{
  const quote=amount==='10000'?null:await s.quote(amount),body={version:'1.0.0',input:{n:1},max_charge_usdc_atomic:amount,...(quote?{quote_id:quote.quote_id,payment_amount_atomic:amount}:{})};
  if(quote)assert.equal(quote.payment.extensions,undefined);
  const result=await(await s.invoke({body,amount})).json();assert.equal(result.payment.amount_settled_atomic,amount);assert.equal(s.db.sqlite.prepare('SELECT amount_atomic FROM platform_payments').get().amount_atomic,amount);assert.equal(s.counts.settle,1);
 }finally{s.close();}}
 assert.equal(isAtomicAmount((BigInt(MAX_UINT256)+1n).toString()),false);for(const amount of ['01','1e4','1.1','-1',' 10000',10000])assert.equal(isAtomicAmount(amount),false);
 assert.ok(paymentChallenge(product,paymentRequirements(product,config),origin).extensions.bazaar);
});
test('above-minimum requires durable input-bound quote; malformed/overflow/below-minimum cannot settle',async()=>{
 const s=setup();try{
  for(const amount of ['9999',(BigInt(MAX_UINT256)+1n).toString(),'010000'])await assert.rejects(s.quote(amount),e=>e.status===400);
  await assert.rejects(s.invoke({body:{version:'1.0.0',input:{n:1},payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'}}),e=>e.code==='quote_required');
  const q=await s.quote();for(const body of [{input:{n:2},payment_amount_atomic:'10001'},{input:{n:1},payment_amount_atomic:'10002'}])await assert.rejects(s.invoke({body:{version:'1.0.0',quote_id:q.quote_id,max_charge_usdc_atomic:'20000',...body}}),e=>e.code==='quote_mismatch');
  assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});
test('preview is stable, bounded and private; paid claim reuses saved result and consumes one quote/preparation',async()=>{
 const s=setup();try{
  const request_id='repeat_'+('z'.repeat(32)),p=await s.prepare({request_id});assert.deepEqual(await s.prepare({request_id}),p);assert.equal(s.counts.run,1);assert(!JSON.stringify(p).includes('full-result'));
  const q=await s.quote('10001',p.prepared_id),other=await s.quote('10002',p.prepared_id),body={version:'1.0.0',prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'};
  const result=await(await s.invoke({body})).json();assert.equal(result.output.private,'full-result-never-in-preview');assert.equal(s.counts.run,1);assert.equal(s.counts.settle,1);
  const replay=await(await s.invoke({body})).json();assert.deepEqual(replay,result);
  await assert.rejects(s.invoke({body:{...body,quote_id:other.quote_id,payment_amount_atomic:'10002',max_charge_usdc_atomic:'10002'},nonce:'b',key:'other_'+('b'.repeat(32))}),e=>e.code==='preparation_unavailable');
  await assert.rejects(s.invoke({body,capability:'atbp_'+Buffer.alloc(32,8).toString('base64url')}),e=>e.code==='preparation_capability_invalid');
  assert.equal(s.counts.settle,1);const stored=JSON.stringify(s.db.sqlite.prepare('SELECT * FROM platform_preparations').all());assert(!stored.includes(secret));assert(!stored.includes('PAYMENT-SIGNATURE'));
 }finally{s.close();}
});
test('wrong capability, cross-product preparation, expired quote and free budget exhaustion fail before work/payment',async()=>{
 const s=setup();try{
  const wrong=new Request(url,{headers:{'X-Preparation-Capability':'atbp_'+Buffer.alloc(32,9).toString('base64url')}});
  await assert.rejects(s.prepare({},wrong),e=>e.code==='preparation_capability_invalid');
  const p=await s.prepare(),q=await s.quote('10001',p.prepared_id);
  await assert.rejects(quotedPayment({db:s.db,request:s.request(),body:{version:'1.0.0',prepared_id:p.prepared_id,payment_amount_atomic:'10000'},product:{...product,id:'other'},handler:s.handler,config,origin}),e=>e.code==='preparation_capability_invalid');
  s.setDate(new Date(s.now().getTime()+901000));await assert.rejects(s.invoke({body:{version:'1.0.0',prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'}}),e=>e.code==='quote_expired');
  for(let i=0;i<9;i++)await s.prepare();await assert.rejects(s.prepare(),e=>e.code==='preparation_budget_exhausted');assert.equal(s.counts.run,10);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});
test('minimum policy change rejects fresh stale quote; exact completed replay uses frozen terms',async()=>{
 const s=setup();try{
  const q=await s.quote(),body={version:'1.0.0',input:{n:1},quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'};
  const changed={...product,pricing:{...product.pricing,minimum_amount_atomic:'10001'}};
  await assert.rejects(s.invoke({body,customProduct:changed}),e=>e.code==='quote_terms_changed');
  const result=await(await s.invoke({body})).json();assert.deepEqual(await(await s.invoke({body,customProduct:changed})).json(),result);
  await assert.rejects(s.invoke({body:{...body,payment_amount_atomic:'10002'}}),e=>e.code==='payment_replay_conflict');assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('global nonce reuse across preparations rolls back second claim atomically',async()=>{
 const s=setup();try{
  const a=await s.prepare(),b=await s.prepare(),q1=await s.quote('10001',a.prepared_id),q2=await s.quote('10001',b.prepared_id);
  const body=q=>({version:'1.0.0',prepared_id:q.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'});
  await s.invoke({body:body(q1)});await assert.rejects(s.invoke({body:body(q2),key:'second_'+('q'.repeat(32))}),e=>e.code==='authorization_already_used');
  assert.equal(s.db.sqlite.prepare('SELECT state FROM platform_preparations WHERE prepared_id=?').get(b.prepared_id).state,'ready');assert.equal(s.db.sqlite.prepare('SELECT operation_id FROM platform_quotes WHERE quote_id=?').get(q2.quote_id).operation_id,null);assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('concurrent distinct claims buy a prepared result only once',async()=>{
 const s=setup();try{
  const p=await s.prepare(),a=await s.quote('10001',p.prepared_id),b=await s.quote('10002',p.prepared_id);
  const call=(q,nonce)=>s.invoke({body:{version:'1.0.0',prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:q.payment_amount_atomic,max_charge_usdc_atomic:q.payment_amount_atomic},nonce,key:nonce.repeat(32)});
  const results=await Promise.allSettled([call(a,'a'),call(b,'b')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(s.counts.settle,1);assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,1);
 }finally{s.close();}
});
test('pending settlement retains prepared output after expiry and never releases or retries settlement',async()=>{
 const s=setup();try{
  const p=await s.prepare(),q=await s.quote('10001',p.prepared_id),body={version:'1.0.0',prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001'};
  await assert.rejects(s.invoke({body,settle:()=>{throw new Error('uncertain');}}),e=>e.code==='settlement_unresolved');
  s.setDate(new Date(s.now().getTime()+90000000));await expirePreparations(s.db,s.now());
  assert(s.db.sqlite.prepare('SELECT result_json FROM platform_preparations').get().result_json);assert(s.db.sqlite.prepare('SELECT result_json FROM platform_payments').get().result_json);
  // A changed authorization is rejected; neither path retries settlement.
  await assert.rejects(s.invoke({body}),e=>e.code==='payment_replay_conflict');assert.equal(s.counts.settle,1);
 }finally{s.close();}
});
test('exact private ledger and daily sums preserve values above uint256 across purchases',()=>{
 const row={product_id:'p',version:'1',sample_kind:'unclassified',event:'settlement_reported',created_at:'2026-10-06T00:00:00Z',amount_atomic:MAX_UINT256};
 const result=exactLedgerTotals([row,row]);assert.equal(result.ledger_totals[0].recorded_atomic_units,(BigInt(MAX_UINT256)*2n).toString());assert.equal(result.daily_ledger_totals[0].recorded_atomic_units,(BigInt(MAX_UINT256)*2n).toString());
 assert.throws(()=>exactLedgerTotals([{...row,amount_atomic:1e20}]));
});
test('migration statements survive the exact Wrangler remote SQL splitter',async()=>{
 const {createRequire}=await import('node:module'),{readFileSync,readdirSync}=await import('node:fs'),{DatabaseSync}=await import('node:sqlite');
 const require=createRequire(import.meta.url),{unstable_splitSqlQuery}=require('wrangler'),sqlite=new DatabaseSync(':memory:');
 try{for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())for(const statement of unstable_splitSqlQuery(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8')))sqlite.exec(statement);assert(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='platform_claim_quote'").get());}finally{sqlite.close();}
});
