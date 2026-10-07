import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {z} from 'zod';
import {decodePaymentRequiredHeader} from '@x402/core/http';
import {createPlatform} from '../src/app.js';
import {database} from '../scripts/local-db.js';
import {products} from '../src/registry.js';
import {BASE_NETWORK,BASE_USDC,paymentRequirements} from '../src/payment-config.js';
const sdkRequire=createRequire(import.meta.resolve('@modelcontextprotocol/sdk/server/mcp.js'));
const Ajv2020=sdkRequire('ajv/dist/2020.js').default;
const origin='https://configured.example.invalid',path='/v1/products/docs-pack/invoke';
const payTo='0x1111111111111111111111111111111111111111';
const config={enabled:true,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo,private_test_secret:'must-never-appear'};
function setup({catalog=products,payments=config,limit=async()=>true}={}){
 const db=database(),calls={factory:0,execute:0,verify:0,settle:0};
 const product=catalog.find(p=>p.id==='docs-pack');
 const handler={input:z.strictObject({ok:z.literal(true)}),output:z.any(),run:async()=>{calls.execute++;return {ok:true};},success:()=>false};
 const app=createPlatform({db,origin,catalog,handlers:{'docs-pack':handler},payments,limit,paymentAdapterFactory:async()=>{calls.factory++;return {requirements:paymentRequirements(product,payments),verify:async()=>{calls.verify++;return {isValid:false};},settle:async()=>{calls.settle++;throw Error('must not settle');}};}});
 return {db,calls,app,request:(route=path,init={})=>app(new Request(origin+route,init)),close:()=>db.close()};
}
test('unsigned empty, malformed, invalid and non-JSON probes receive 402 without product or facilitator work',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('unpaid probes must not fetch');});
 const s=setup();try{
  for(const init of [{method:'POST'},{method:'POST',body:''},{method:'POST',headers:{'Content-Type':'application/json'},body:'{'},{method:'POST',headers:{'Content-Type':'application/json'},body:'null'},{method:'POST',headers:{'Content-Type':'application/json'},body:'{"input":{"private":"probe"}}'},{method:'POST',headers:{'Content-Type':'text/plain'},body:'not json'}]){
   const response=await s.request(path,init);assert.equal(response.status,402);
   const challenge=decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));assert.equal(challenge.x402Version,2);assert.deepEqual(challenge.accepts,[paymentRequirements(products[0],config)]);
  }
  assert.deepEqual(s.calls,{factory:0,execute:0,verify:0,settle:0});
  for(const table of ['platform_payments','platform_payment_ledger','platform_paid_purchases','platform_examples'])assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0);
 }finally{s.close();}
});
test('cheap body, route, method and rate limits remain before payment challenge',async()=>{
 const s=setup();try{
  for(const init of [{method:'POST',headers:{'Content-Length':'20000'}},{method:'POST',body:'x'.repeat(16385)}]){const r=await s.request(path,init);assert.equal(r.status,413);assert.equal(r.headers.get('PAYMENT-REQUIRED'),null);}
  const stream=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(10000));controller.enqueue(new Uint8Array(7000));controller.close();}});
  assert.equal((await s.request(path,{method:'POST',body:stream,duplex:'half'})).status,413);
  for(const method of ['GET','HEAD']){const r=await s.request(path,{method});assert.equal(r.status,402);assert(r.headers.has('PAYMENT-REQUIRED'));if(method==='HEAD')assert.equal(await r.text(),'');}
  const unsupported=await s.request(path,{method:'PUT'});assert.equal(unsupported.status,405);assert.equal(unsupported.headers.get('PAYMENT-REQUIRED'),null);
  assert.equal((await s.request('/v1/products/missing/invoke',{method:'POST'})).status,404);
  assert.equal((await s.request(path+'-extra',{method:'POST'})).status,404);
  assert.deepEqual(s.calls,{factory:0,execute:0,verify:0,settle:0});
 }finally{s.close();}
 const blocked=setup({limit:async()=>false});try{assert.equal((await blocked.request(path,{method:'POST'})).status,429);assert.equal(blocked.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_daily').get().n,0);}finally{blocked.close();}
});
test('requests carrying a payment header still validate JSON and product inputs before verification, work or settlement',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('invalid paid input must not fetch');});
 const s=setup();try{
  const headers={'Content-Type':'application/json','PAYMENT-SIGNATURE':'mock-not-a-live-signature','Idempotency-Key':'invalid_paid_abcdefghijklmnopqrstuvwxyz'};
  for(const body of ['{','null','{}',JSON.stringify({version:'0.1.0',input:{ok:false},max_charge_usdc_atomic:10000}),JSON.stringify({version:'0.1.0',input:{ok:true,private:'no'},max_charge_usdc_atomic:10000})]){
   const response=await s.request(path,{method:'POST',headers,body});assert.equal(response.status,400);assert.equal(response.headers.get('PAYMENT-REQUIRED'),null);
  }
  const oversized=await s.request(path,{method:'POST',headers:{...headers,'PAYMENT-SIGNATURE':'x'.repeat(12289)},body:JSON.stringify({version:'0.1.0',input:{ok:true},max_charge_usdc_atomic:10000})});assert.equal(oversized.status,413);
  assert.deepEqual(s.calls,{factory:0,execute:0,verify:0,settle:0});assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_payments').get().n,0);
 }finally{s.close();}
});
test('manifest version 1, v2 challenge, catalog price and concrete OpenAPI metadata use the same live terms',async()=>{
 for(const [amount,receiver] of [[10000,payTo],[25000,'0x3333333333333333333333333333333333333333']]){
  const catalog=products.map(p=>p.id==='docs-pack'?{...p,pricing:{...p.pricing,minimum_amount_atomic:String(amount)}}:p),payments={...config,payTo:receiver},s=setup({catalog,payments});
  try{
   const manifest=await(await s.request('/.well-known/x402')).json();assert.equal(manifest.version,1);assert.deepEqual(manifest.resources,[origin+path]);assert.equal(manifest.payment.x402Version,2);
   const response=await s.app(new Request('https://attacker.example.invalid'+path+'?bad=query',{method:'POST'}));assert.equal(response.status,402);const challenge=decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));assert.equal(challenge.resource.url,origin+path);
   assert.deepEqual(challenge.accepts,manifest.payment.routes[0].accepts);assert.equal(challenge.accepts[0].amount,String(amount));assert.equal(challenge.accepts[0].payTo,receiver);
   const registry=await(await s.request('/v1/products')).json(),price=registry.products[0].pricing;assert.equal(price.minimum_amount_atomic,String(amount));assert.equal(price.pay_to,receiver);assert.equal(price.network,challenge.accepts[0].network);assert.equal(price.asset,challenge.accepts[0].asset);assert.equal(price.payments_configured,true);
   const api=await(await s.request('/openapi.json')).json();assert.equal(api.paths[path].post['x-payment-info'].price.minimum,amount===10000?'0.01':'0.025');
   const bazaar=challenge.extensions.bazaar;assert.deepEqual(bazaar.info.input.body.input,catalog[0].example_input);assert.equal(bazaar.info.input.bodyType,'json');
   const validate=new Ajv2020({strict:false,validateFormats:false}).compile(bazaar.schema);assert.equal(validate(bazaar.info),true,JSON.stringify(validate.errors));
   assert(!JSON.stringify({manifest,challenge,api,registry}).includes(config.private_test_secret));assert.equal(manifest.payment.routes[0].live_payment_verified,false);
  }finally{s.close();}
 }
});
test('disabled, unsupported asset/network and missing receiver configurations do not advertise payable routes',async()=>{
 for(const change of [{enabled:false},{receiverConfirmed:false},{network:'eip155:1'},{asset:'0x4444444444444444444444444444444444444444'},{asset:null},{payTo:null}]){
  const s=setup({payments:{...config,...change}});try{const manifest=await(await s.request('/.well-known/x402')).json();assert.deepEqual(manifest.resources,[]);assert.equal(manifest.payment.configured,false);const r=await s.request(path,{method:'POST'});assert.equal(r.status,503);assert.equal(r.headers.get('PAYMENT-REQUIRED'),null);assert.equal(s.calls.factory,0);}finally{s.close();}
 }
});
