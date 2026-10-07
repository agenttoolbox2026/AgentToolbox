import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {decodePaymentRequiredHeader} from '@x402/core/http';
import {createPlatform} from '../src/app.js';
import {products} from '../src/registry.js';
import {BASE_NETWORK,BASE_USDC} from '../src/payment-config.js';
import {database} from '../scripts/local-db.js';
import {createDocsPack,docsPackPreview} from '../src/docs-pack.js';
import {freeExampleManifest} from '../src/free-examples.js';
import {PREPARATION_LIMITS} from '../src/preparation-limits.js';
const origin='https://agnttoolbx.agenttoolbox2026.workers.dev';
const payments={enabled:true,live:false,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:'0x'+'1'.repeat(40)};
const active=products.filter(p=>p.status==='active');
const sha=text=>createHash('sha256').update(text).digest('hex');
const forbidden=()=>{throw new Error('Discovery must not do work or access the database');};
const noDb={prepare:forbidden,batch:forbidden};
const handlers=Object.fromEntries(active.map(p=>[p.id,{run:forbidden}]));
const get=(app,path,init={})=>app(new Request(origin+path,init));

test('GET and HEAD paid endpoints challenge all four tools without DB, execution, or adapter access',async()=>{
 const app=createPlatform({db:noDb,origin,payments,handlers,paymentAdapterFactory:forbidden});
 for(const p of active){
  const path='/v1/products/'+p.id+'/invoke';
  const response=await get(app,path,{headers:{'PAYMENT-SIGNATURE':'never-decode-this'}});
  assert.equal(response.status,402,p.id);
  const body=await response.json(),challenge=decodePaymentRequiredHeader(response.headers.get('PAYMENT-REQUIRED'));
  assert.deepEqual(body.payment,challenge);assert.equal(challenge.x402Version,2);assert.equal(challenge.accepts[0].amount,'10000');
  assert.equal(body.contract_pins.payment_requirements_sha256,sha(body.payment_requirements_pin.canonical_json));
  const head=await get(app,path,{method:'HEAD'});assert.equal(head.status,402);assert.equal(await head.text(),'');assert(head.headers.has('PAYMENT-REQUIRED'));
 }
 for(const id of ['retry-gate','missing'])assert.equal((await get(app,'/v1/products/'+id+'/invoke')).status,404);
 const unavailable=createPlatform({db:noDb,origin,payments:{enabled:false},handlers});
 assert.equal((await get(unavailable,'/v1/products/docs-pack/invoke')).status,503);
});

test('criteria canonical bytes describe the actual published schemas, limits and criteria',async()=>{
 const app=createPlatform({db:noDb,origin,payments,handlers});
 for(const p of active){
  const response=await get(app,'/v1/products/'+p.id+'/criteria');assert.equal(response.status,200);
  const body=await response.json(),contract=JSON.parse(body.canonical_json);
  assert.equal(body.sha256,sha(body.canonical_json));assert.equal(body.canonicalization.id,'agenttoolbox-json-v1');
  assert.deepEqual(contract.input_schema,JSON.parse(JSON.stringify(p.input_schema)));
  assert.deepEqual(contract.output_schema,JSON.parse(JSON.stringify(p.output_schema)));
  assert.deepEqual(contract.criteria,body.criteria);assert.deepEqual(contract.limits,body.limits);
  const challenge=await(await get(app,'/v1/products/'+p.id+'/invoke')).json();
  assert.equal(challenge.contract_pins.success_contract_sha256,body.sha256);
 }
});

test('free examples are bounded inert manifests, and cannot be claimed by an external listing',async()=>{
 const app=createPlatform({db:noDb,origin,handlers});
 for(const p of active){const result=await get(app,p.examples_url);assert.equal(result.status,200);const body=await result.json();assert.deepEqual(body,freeExampleManifest(p.id));assert.equal(body.execution,'none');}
 const external=createPlatform({db:noDb,origin,catalog:[{...active[0],provider:{type:'external',name:'Creator'}}]});
 assert.equal((await get(external,'/v1/products/docs-pack/examples')).status,404);
 assert.equal((await get(app,'/v1/products/retry-gate/examples')).status,404);
});

test('402 Index file exposes only an explicitly configured public hash',async()=>{
 const path='/.well-known/402index-verify.txt';
 for(const value of [undefined,'private_verification_token','A'.repeat(64),'a'.repeat(65)]){
  const app=createPlatform({db:noDb,origin,index402VerificationHash:value});assert.equal((await get(app,path)).status,404);
 }
 const app=createPlatform({db:noDb,origin,index402VerificationHash:'b'.repeat(64)}),response=await get(app,path);
 assert.equal(response.status,200);assert.equal(await response.text(),'b'.repeat(64));assert.match(response.headers.get('Content-Type'),/^text\/plain/);
 assert.equal(await(await get(app,path,{method:'HEAD'})).text(),'');
});

test('invalid agent pseudonyms produce an actionable error before payment processing',async()=>{
 const app=createPlatform({db:noDb,origin,payments,handlers,paymentAdapterFactory:forbidden});
 const response=await get(app,'/v1/products/docs-pack/invoke',{method:'POST',headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':'not-processed'},body:JSON.stringify({version:'0.1.0',input:{},max_charge_usdc_atomic:'10000',agent_id:'pigeon'})});
 assert.equal(response.status,400);const body=await response.json();assert.equal(body.error.code,'invalid_agent_id');assert.match(body.error.message,/UUID/);assert.match(body.error.message,/Omit/);
});

test('free Docs preview reports real literal coverage and bounded snippet from the saved output',async()=>{
 const manifest=freeExampleManifest('docs-pack'),example=manifest.cases[0];let fetches=0;
 const handler=createDocsPack({now:()=>new Date(manifest.fixed_clock),fetcher:async url=>{fetches++;const row=example.fixture.responses.find(r=>r.url===url);assert(row);return new Response(row.body,{status:row.status,headers:row.headers});}});
 const output=await handler.run(handler.input.parse(example.input)),preview=handler.preview(output);
 assert.equal(fetches,2);assert.equal(preview.sources[0].matched_terms_count,1);assert.equal(preview.sources[0].query_terms_count,1);
 assert.equal(preview.sample.text,output.sources[0].excerpts[0].text);assert.equal(preview.source_content,'untrusted_data');assert.match(preview.match_measure,/not semantic/);
 assert.equal(preview.sources[0].source_sha256,undefined);
 const huge={...output,sources:Array.from({length:5},()=>({...output.sources[0],excerpts:[{...output.sources[0].excerpts[0],text:'😀'.repeat(1800)}]}))};
 const bounded=docsPackPreview(huge);assert.equal(Array.from(bounded.sample.text).length,120);assert.equal(bounded.sample.truncated,true);
 assert(Buffer.byteLength(JSON.stringify(bounded))<=PREPARATION_LIMITS.max_preview_bytes);
});

test('catalog, llms and OpenAPI expose first-party ownership and free verification paths',async()=>{
 const db=database();try{
  const app=createPlatform({db,origin,payments,handlers});
  const catalog=await(await get(app,'/v1/products')).json();
  assert(catalog.products.every(p=>p.provider?.id==='agenttoolbox'&&p.provider?.type==='first_party'&&p.examples_url&&p.criteria_url));
  const llms=await(await get(app,'/llms.txt')).text();assert(llms.includes(origin));assert(!llms.includes('agnttoolbox.agenttoolbox2026.workers.dev'));assert.match(llms,/success_contract_sha256/);
  const spec=await(await get(app,'/openapi.json')).json();
  assert(spec.paths['/v1/products/{id}/invoke'].get);assert(spec.paths['/v1/products/{id}/invoke'].head);assert(spec.paths['/v1/products/{id}/examples']);
  assert(spec.paths['/v1/products/docs-pack/invoke'].get);assert(spec.paths['/v1/products/{id}/invoke'].post.requestBody.content['application/json'].schema.properties.success_contract_sha256);
 }finally{db.close();}
});
