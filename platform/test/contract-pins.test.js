import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {encodePaymentSignatureHeader,decodePaymentRequiredHeader} from '@x402/core/http';
import {canonicalJson,CANONICAL_JSON_PROFILE,successContractPin,paymentRequirementsPin,contractPins} from '../src/contract-pins.js';
import {products} from '../src/registry.js';
import {database} from '../scripts/local-db.js';
import {paidInvocation,quotedPayment,discoveryChallenge,canonical as historicalCanonical} from '../src/x402.js';
import {prepareResult} from '../src/preparations.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC} from '../src/payment-config.js';
import {hash} from '../src/telemetry.js';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

test('canonical profile fixes UTF-16 key order, scalar bytes, array order and Unicode without normalization',()=>{
 const value={'\ufffd':'replacement','😀':'astral',z:[-0,1e30,1e-7,true,null,'é','e\u0301','\n'],a:{y:2,x:1}};
 const expected='{"a":{"x":1,"y":2},"z":[0,1e+30,1e-7,true,null,"é","é","\\n"],"😀":"astral","�":"replacement"}';
 assert.equal(canonicalJson(value),expected);
 assert.equal(canonicalJson({b:2,a:1}),canonicalJson({a:1,b:2}));
 assert.notEqual(canonicalJson([1,2]),canonicalJson([2,1]));
 assert.notEqual(canonicalJson('é'),canonicalJson('e\u0301'));
 assert.equal(canonicalJson(Object.assign(Object.create(null),{b:2,a:1})),'{"a":1,"b":2}');
 assert.equal(CANONICAL_JSON_PROFILE.id,'agenttoolbox-json-v1');
});

test('canonical profile rejects lossy or executable non-JSON values and malformed Unicode',()=>{
 let accessed=false;const accessor={get secret(){accessed=true;return 1;}},cyclic={};cyclic.self=cyclic;
 const extra=[1];extra.extra=2;
 const hidden={};Object.defineProperty(hidden,'secret',{value:1});
 for(const value of [undefined,NaN,Infinity,-Infinity,1n,()=>1,Symbol('x'),new Date(),[undefined],Array(1),extra,hidden,accessor,cyclic,{x:undefined},{[Symbol('x')]:1},'\ud800','\udc00',{'\ud800':1}])assert.throws(()=>canonicalJson(value),TypeError);
 assert.equal(accessed,false);
 assert.equal(canonicalJson('😀'),'"😀"');
});

test('all live success contracts have independently reproducible UTF-8 SHA-256 pins; every qualifying field is covered',async()=>{
 for(const product of products.filter(p=>p.status==='active')){
  const pin=await successContractPin(product),document=JSON.parse(pin.canonical_json);
  assert.equal(pin.sha256,createHash('sha256').update(pin.canonical_json,'utf8').digest('hex'));
  assert.equal(pin.canonical_json,canonicalJson(document));assert(!pin.canonical_json.endsWith('\n'));
  for(const mutate of [p=>p.id+='-changed',p=>p.version='9.0.0',p=>p.outcome.criteria.criteria_version='changed',p=>p.outcome.success_criterion+=' changed',p=>p.limits={changed:true},p=>p.input_schema={type:'null'},p=>p.output_schema={type:'null'}]){
   const changed=structuredClone(product);mutate(changed);assert.notEqual((await successContractPin(changed)).sha256,pin.sha256);
  }
  assert.equal((await successContractPin({...product,name:'Cosmetic label',pricing:{...product.pricing,live_payment_verified:true}})).sha256,pin.sha256);
 }
});

const origin='https://example.invalid',payTo='0x'+'1'.repeat(40),payer='0x'+'2'.repeat(40),transaction='0x'+'c'.repeat(64);
const secret='atbp_'+Buffer.alloc(32,7).toString('base64url'),key='pin_test_'+('a'.repeat(32));
const config={enabled:true,receiverConfirmed:true,live:false,network:BASE_NETWORK,asset:BASE_USDC,payTo};
function fixture({decorateDb}={}){
 const base=database(),db=decorateDb?decorateDb(base):base,counts={run:0,verify:0,settle:0,adapter:0},date=new Date(),seconds=Math.floor(date.getTime()/1000);
 const input=z.strictObject({n:z.number().int()}),output=z.strictObject({n:z.number().int()});
 const product={id:'pin-fixture',version:'1.0.0',status:'validation',outcome:{success_criterion:'Return the integer',criteria:{criteria_version:'1',rules:[{eq:['output.n','input.n']}]}},limits:{max_output_bytes:1000},input_schema:z.toJSONSchema(input),output_schema:z.toJSONSchema(output),pricing:{payments_enabled:true,minimum_amount_atomic:'10000'}};
 const handler={input,output,run:async input=>{counts.run++;return input;},success:()=>true,preview:()=>({ready:true})};
 const request=()=>new Request(origin,{headers:{'X-Preparation-Capability':secret}});
 const body={version:'1.0.0',input:{n:1},max_charge_usdc_atomic:'10000'};
 const invoke=async({value=body,currentProduct=product,currentConfig=config,currentHandler=handler,afterVerify}={})=>{
  const terms=paymentRequirements(product,config,value.payment_amount_atomic??'10000');
  const payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'0'.repeat(130),authorization:{from:payer,to:payTo,value:terms.amount,validAfter:String(seconds-1),validBefore:String(seconds+300),nonce:'0x'+'a'.repeat(64)}}};
  return paidInvocation({db,request:new Request(origin+'/v1/products/'+product.id+'/invoke',{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'X-AgentToolbox-Sample':'synthetic','X-Preparation-Capability':secret}}),body:value,key,product:currentProduct,handler:currentHandler,config:currentConfig,origin,now:()=>date,
   adapterFactory:async()=>{counts.adapter++;return {requirements:terms,verify:async()=>{counts.verify++;afterVerify?.();return {isValid:true,payer};},settle:async()=>{counts.settle++;return {success:true,network:BASE_NETWORK,transaction,payer,amount:terms.amount};}};}});
 };
 const quote=(value={version:'1.0.0',input:{n:1},payment_amount_atomic:'10000'},currentProduct=product)=>quotedPayment({db,request:request(),body:value,product:currentProduct,handler,config,origin,now:()=>date});
 const prepare=async(value={})=>prepareResult({db,request:request(),body:{version:'1.0.0',input:{n:1},request_id:'prepare_'+('b'.repeat(32)),prepare_secret_hash:await hash(secret),...value},product,handler,config,client:'local-test',now:()=>date});
 return {db,counts,product,handler,body,invoke,quote,prepare,close:()=>db.close()};
}

test('payment pin covers complete exact requirements, preserves string case, and discovery executes nothing',async()=>{
 const s=fixture();try{
  const terms=paymentRequirements(s.product,config),pin=await paymentRequirementsPin(terms);
  assert.equal(pin.sha256,createHash('sha256').update(pin.canonical_json).digest('hex'));
  assert.equal((await paymentRequirementsPin(Object.fromEntries(Object.entries(terms).reverse()))).sha256,pin.sha256);
  for(const changed of [{...terms,amount:'10001'},{...terms,asset:terms.asset.toLowerCase()},{...terms,extra:{...terms.extra,newField:true}}])assert.notEqual((await paymentRequirementsPin(changed)).sha256,pin.sha256);
  const response=await discoveryChallenge({product:s.product,config,origin});assert.equal(response.status,402);
  const data=await response.json();assert.deepEqual(decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED')).accepts,[terms]);
  assert.equal(data.payment_requirements_pin.sha256,pin.sha256);assert.equal(data.contract_pins.payment_requirements_sha256,pin.sha256);
  assert.deepEqual(s.counts,{run:0,verify:0,settle:0,adapter:0});
 }finally{s.close();}
});

test('wrong client pins and invalid agent_id fail before adapter, verification, work, settlement or quote creation',async()=>{
 const s=fixture();try{
  for(const [field,code] of [['success_contract_sha256','success_contract_mismatch'],['payment_requirements_sha256','payment_requirements_pin_mismatch']]){
   await assert.rejects(s.invoke({value:{...s.body,[field]:'0'.repeat(64)}}),e=>e.status===409&&e.code===code);
   await assert.rejects(s.quote({version:'1.0.0',input:{n:1},payment_amount_atomic:'10000',[field]:'0'.repeat(64)}),e=>e.status===409&&e.code===code);
  }
  await assert.rejects(s.invoke({value:{...s.body,agent_id:'research-buyer'}}),e=>e.status===400&&e.code==='invalid_agent_id'&&e.message.includes('UUID'));
  assert.deepEqual(s.counts,{run:0,verify:0,settle:0,adapter:0});
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_quotes').get().n,0);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,0);
 }finally{s.close();}
});

test('new quotes inherit the saved success contract even when invoke omits explicit pins',async()=>{
 const s=fixture();try{
  const q=await s.quote(),value={...s.body,quote_id:q.quote_id,payment_amount_atomic:'10000'};
  assert.equal(s.db.sqlite.prepare('SELECT success_contract_sha256 FROM platform_quotes').get().success_contract_sha256,q.contract_pins.success_contract_sha256);
  const changed=structuredClone(s.product);changed.limits.max_output_bytes=999;
  await assert.rejects(s.invoke({value,currentProduct:changed}),e=>e.code==='success_contract_mismatch');
  assert.deepEqual(s.counts,{run:0,verify:0,settle:0,adapter:0});
  assert.throws(()=>s.db.sqlite.exec("UPDATE platform_quotes SET success_contract_sha256=NULL"),/immutable_success_contract_pin/);
 }finally{s.close();}
});

test('prepared results retain their original success contract and cannot be sold under changed criteria',async()=>{
 const s=fixture();try{
  await assert.rejects(s.prepare({success_contract_sha256:'0'.repeat(64)}),e=>e.code==='success_contract_mismatch');assert.equal(s.counts.run,0);
  const p=await s.prepare(),q=await s.quote({version:'1.0.0',prepared_id:p.prepared_id,payment_amount_atomic:'10000'});
  assert.equal(p.contract_pins.success_contract_sha256,q.contract_pins.success_contract_sha256);
  const changed=structuredClone(s.product);changed.outcome.criteria.criteria_version='2';
  await assert.rejects(s.quote({version:'1.0.0',prepared_id:p.prepared_id,payment_amount_atomic:'10000'},changed),e=>e.code==='success_contract_mismatch');
  await assert.rejects(s.invoke({value:{version:'1.0.0',prepared_id:p.prepared_id,quote_id:q.quote_id,payment_amount_atomic:'10000',max_charge_usdc_atomic:'10000'},currentProduct:changed}),e=>e.code==='success_contract_mismatch');
  assert.equal(s.counts.run,1);assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);
  assert.throws(()=>s.db.sqlite.exec('UPDATE platform_preparations SET success_contract_sha256=NULL'),/immutable_success_contract_pin/);
 }finally{s.close();}
});

test('contract drift during preparation or after payment verification fails without settlement',async()=>{
 const a=fixture();try{
  a.handler.run=async input=>{a.counts.run++;a.product.limits.max_output_bytes=999;return input;};
  await assert.rejects(a.prepare(),e=>e.code==='success_contract_mismatch');
  assert.equal(a.db.sqlite.prepare('SELECT state FROM platform_preparations').get().state,'failed');assert.equal(a.counts.settle,0);
 }finally{a.close();}
 const b=fixture();try{
  await assert.rejects(b.invoke({afterVerify:()=>{b.product.limits.max_output_bytes=999;}}),e=>e.code==='success_contract_mismatch');
  assert.equal(b.counts.verify,1);assert.equal(b.counts.run,0);assert.equal(b.counts.settle,0);
 }finally{b.close();}
 const c=fixture();try{
  c.handler.run=async input=>{c.counts.run++;c.product.outcome.success_criterion='Changed';return input;};
  await assert.rejects(c.invoke(),e=>e.code==='success_contract_mismatch');
  assert.equal(c.counts.settle,0);assert.equal(c.db.sqlite.prepare('SELECT state FROM platform_payments').get().state,'failed');
 }finally{c.close();}
});

test('successful pinned purchase replays frozen contract and receipt after current contract, version and availability change',async()=>{
 const s=fixture();try{
  const pins=await contractPins(s.product,paymentRequirements(s.product,config)),value={...s.body,success_contract_sha256:pins.success_contract_sha256,payment_requirements_sha256:pins.payment_requirements_sha256};
  const first=await(await s.invoke({value})).json();assert.deepEqual(first.contract_pins,pins);
  const changed=structuredClone(s.product);changed.version='2.0.0';changed.status='retired';changed.input_schema={type:'null'};changed.outcome.criteria.criteria_version='2';
  const replay=await(await s.invoke({value,currentProduct:changed,currentConfig:{...config,enabled:false},currentHandler:null})).json();
  assert.deepEqual(replay,first);assert.deepEqual(s.counts,{run:1,verify:1,settle:1,adapter:1});
  await assert.rejects(s.invoke({value:{...value,success_contract_sha256:'0'.repeat(64)}}),e=>e.code==='payment_replay_conflict');
  assert.equal(s.counts.settle,1);
 }finally{s.close();}
});

test('a contract change during durable settlement-intent recording still cannot reach settlement',async()=>{
 let mutate=()=>{};
 const s=fixture({decorateDb:base=>({...base,prepare(sql){const statement=base.prepare(sql);if(!sql.startsWith('INSERT INTO platform_payment_ledger'))return statement;return {bind(...args){const bound=statement.bind(...args);return {...bound,run:async()=>{const result=await bound.run();if(args[4]==='settlement_intent')mutate();return result;}};}};}})});
 try{
  mutate=()=>{s.product.limits.max_output_bytes=999;};
  await assert.rejects(s.invoke(),e=>e.code==='success_contract_mismatch');
  assert.equal(s.counts.run,1);assert.equal(s.counts.verify,1);assert.equal(s.counts.settle,0);
  assert.equal(s.db.sqlite.prepare('SELECT state FROM platform_payments').get().state,'failed');
 }finally{s.close();}
});

test('additive pin migration preserves old quote/preparation facts and leaves historical hashes explicitly unknown',()=>{
 const db=new DatabaseSync(':memory:'),directory=new URL('../migrations/',import.meta.url);
 try{
  for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')&&name<'0009_contract_pins.sql').sort())db.exec(readFileSync(new URL(name,directory),'utf8'));
  db.exec("INSERT INTO platform_preparations(prepared_id,product_id,version,request_hash,request_key_hash,capability_hash,client_hash,input_hash,state,created_at,expires_at) VALUES('legacy-preparation','legacy','1.0.0','request','key','capability','client','input','ready','2026-10-07','2026-10-08')");
  db.exec("INSERT INTO platform_quotes(quote_id,product_id,version,input_hash,amount_atomic,minimum_policy,requirements_json,created_at,expires_at) VALUES('legacy-quote','legacy','1.0.0','input','10000','1.0.0:10000','{}','2026-10-07','2026-10-08')");
  const before={quote:db.prepare('SELECT * FROM platform_quotes').get(),preparation:db.prepare('SELECT * FROM platform_preparations').get()};
  db.exec(readFileSync(new URL('0009_contract_pins.sql',directory),'utf8'));
  for(const [key,table] of [['quote','platform_quotes'],['preparation','platform_preparations']]){
   const row=db.prepare('SELECT * FROM '+table).get();assert.equal(row.success_contract_sha256,null);delete row.success_contract_sha256;assert.deepEqual(row,before[key]);
  }
  assert.throws(()=>db.exec("UPDATE platform_quotes SET success_contract_sha256='"+'a'.repeat(64)+"'"),/immutable_success_contract_pin/);
 }finally{db.close();}
});

test('legacy unpaid preparation without a pin must be regenerated instead of being sold as current',async()=>{
 const s=fixture();try{
  s.db.sqlite.prepare("INSERT INTO platform_preparations(prepared_id,product_id,version,request_hash,request_key_hash,capability_hash,client_hash,input_hash,state,created_at,expires_at,result_hash,result_json,preview_json) VALUES(?,?,?,?,?,?,?,?,'ready',?,?,?,?,?)").run('00000000-0000-4000-8000-000000000001',s.product.id,s.product.version,'request','legacy-key',await hash(secret),'client','input',new Date().toISOString(),new Date(Date.now()+900000).toISOString(),'result','{"n":1}','{"ready":true}');
  await assert.rejects(s.quote({version:'1.0.0',prepared_id:'00000000-0000-4000-8000-000000000001',payment_amount_atomic:'10000'}),e=>e.code==='preparation_unpinned');
  assert.equal(s.counts.run,0);assert.equal(s.counts.verify,0);assert.equal(s.counts.settle,0);
 }finally{s.close();}
});

test('legacy quote with no historical success pin requires a fresh quote even if invocation provides a current pin',async()=>{
 const s=fixture();try{
  const quoteId='00000000-0000-4000-8000-000000000002',terms=paymentRequirements(s.product,config),pins=await contractPins(s.product,terms);
  s.db.sqlite.prepare("INSERT INTO platform_quotes(quote_id,product_id,version,input_hash,amount_atomic,minimum_policy,requirements_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)").run(quoteId,s.product.id,s.product.version,await hash(canonicalJson({n:1})),'10000','1.0.0:10000',canonicalJson(terms),new Date().toISOString(),new Date(Date.now()+900000).toISOString());
  for(const extra of [{},{success_contract_sha256:pins.success_contract_sha256}])await assert.rejects(s.invoke({value:{...s.body,quote_id:quoteId,payment_amount_atomic:'10000',...extra}}),e=>e.code==='quote_unpinned');
  assert.deepEqual(s.counts,{run:0,verify:0,settle:0,adapter:0});
 }finally{s.close();}
});

test('historical request fingerprints retain prior bytes, including lone surrogates, so old completed responses still replay',async()=>{
 const oldCanonical=value=>Array.isArray(value)?'['+value.map(oldCanonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+oldCanonical(value[key])).join(',')+'}':JSON.stringify(value);
 for(const value of [{n:'\ud800'},[1,null,{'2':'two','10':'ten'}],{z:undefined,a:-0}])assert.equal(historicalCanonical(value),oldCanonical(value));
 assert.throws(()=>canonicalJson({n:'\ud800'}),TypeError);
 const s=fixture();try{
  s.handler.input=z.strictObject({n:z.string()});s.handler.output=z.strictObject({n:z.string()});
  s.product.input_schema=z.toJSONSchema(s.handler.input);s.product.output_schema=z.toJSONSchema(s.handler.output);
  const value={...s.body,input:{n:'\ud800'}};
  const first=await(await s.invoke({value})).json();
  assert.equal(s.db.sqlite.prepare('SELECT request_hash FROM platform_payments').get().request_hash,await hash(oldCanonical(value)));
  // Historical retained output has no pin envelope. It is returned as saved.
  delete first.contract_pins;s.db.sqlite.prepare('UPDATE platform_payments SET result_json=?').run(JSON.stringify(first));
  const changed={...s.product,status:'retired',version:'2.0.0',input_schema:{type:'null'}};
  assert.deepEqual(await(await s.invoke({value,currentProduct:changed,currentConfig:{...config,enabled:false},currentHandler:null})).json(),first);
  assert.deepEqual(s.counts,{run:1,verify:1,settle:1,adapter:1});
 }finally{s.close();}
});
