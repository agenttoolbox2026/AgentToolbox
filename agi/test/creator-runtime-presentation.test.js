import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {encodePaymentSignatureHeader} from '../../platform/node_modules/@x402/core/dist/esm/http/index.mjs';
import {createAgi} from '../src/worker.js';
import {createModel,CANONICAL_ORIGIN as origin} from '../src/model.js';
import {createCompiledRuntime,getCompiledRuntime,archivedCreatorProducts} from '../src/compiled-runtime.js';
import {products} from '../../platform/src/registry.js';
import {database} from '../../platform/scripts/local-db.js';
import {submitTool,CREATOR_TERMS} from '../../platform/src/submissions.js';
import {hash} from '../../platform/src/telemetry.js';
import {successContractPin,paymentRequirementsPin} from '../../platform/src/contract-pins.js';
import {createReviewedCreatorRegistry,reviewedCreatorRegistry} from '../../platform/src/reviewed-creator-adapters.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC} from '../../platform/src/payment-config.js';

const capability='atbc_'+Buffer.alloc(32,57).toString('base64url');
const payer='0x'+'2'.repeat(40),payTo='0x'+'1'.repeat(40),transaction='0x'+'c'.repeat(64);
const payments={enabled:true,receiverConfirmed:true,live:false,network:BASE_NETWORK,asset:BASE_USDC,payTo};
const jsonPost=(body,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const responseJson=async(response,status=200)=>{assert.equal(response.status,status,await response.clone().text());return response.json();};
const financialSnapshot=db=>Object.fromEntries(['platform_payments','platform_live_receipts','platform_creator_allocations','platform_creator_installation_events','platform_creator_installation_heads'].map(table=>[table,db.sqlite.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]));

async function fixture(t){
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Synthetic creator integration must never make a network request.');});
 const db=database();t.after(()=>db.close());db.sqlite.exec('PRAGMA foreign_keys=ON');
 const submission=await submitTool({db,capability,client:'local-runtime-fixture',body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,
  proposal:{name:'Local compiled creator fixture',summary:'Local lifecycle test only',endpoint_url:'https://never-fetch.example/private-proposal',input_schema:{type:'object'},output_schema:{type:'object'}}}});
 await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),submission.submission_id,'local-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'approved','Local fixture only',new Date().toISOString()).run();
 const input=z.strictObject({n:z.number().int().min(0).max(10)}),output=z.strictObject({doubled:z.number().int().min(0).max(20)});
 const product={id:submission.tool_id,name:'Local compiled creator fixture',summary:'Double one bounded integer for a local test.',problem:'Test exact reviewed publication.',version:'0.1.0',status:'active',maturity:'beta',experimental:false,tags:['local-fixture'],
  provider:{id:'fixture-creator',name:'Fixture Creator',type:'creator'},pricing:{...products[0].pricing},preview:{supported:false},
  outcome:{description:'A doubled integer.',success_criterion:'The output equals the input integer multiplied by two.',criteria:{criteria_version:'local-fixture-v1',rules:[{eq:[{path:'output.doubled'},6]}]},evidence:'server_validated',verified:true},
  limits:{max_output_bytes:1000},input_schema:z.toJSONSchema(input),output_schema:z.toJSONSchema(output),example_input:{n:3},
  invocation:{method:'POST',path:'/v1/products/'+submission.tool_id+'/invoke',transport:'http'}};
 const pin=await successContractPin(product),counts={run:0,verify:0,settle:0,adapter:0};
 const handler={input,output,run:async({n})=>{counts.run++;return {doubled:n*2};},success:r=>Number.isInteger(r.doubled)&&r.doubled===6,
  creatorAdapterId:'compiled-local-fixture-v1',creatorArtifactSha256:'b'.repeat(64),creatorContractSha256:pin.sha256};
 const manifest={manifestId:'local-reviewed-v1',toolId:product.id,metadataRevision:0,metadataVersion:product.version,sourceCommit:'a'.repeat(40),artifactSha256:handler.creatorArtifactSha256,
  successContractSha256:pin.sha256,productVersion:product.version,adapterId:handler.creatorAdapterId,product,handler};
 const registry=await createReviewedCreatorRegistry([manifest]),compiled=await createCompiledRuntime({registry}),model=await createModel({catalog:compiled.catalog});
 const admission={service:0,client:0};
 const env={METRICS_DB:db,PUBLIC_ORIGIN:origin,CLIENT_LIMIT:{limit:async()=>{admission.client++;return {success:true};}},SERVICE_LIMIT:{limit:async()=>{admission.service++;return {success:true};}},FEEDBACK_LIMIT:{limit:async()=>({success:true})},PAYMENTS_MODE:'x402',RECEIVER_CONFIRMED:'true',PAYMENT_NETWORK:BASE_NETWORK,PAYMENT_ASSET:BASE_USDC,PAY_TO_ADDRESS:payTo};
 const paymentAdapterFactory=async({amount})=>{counts.adapter++;return {requirements:paymentRequirements(product,payments,amount),verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;return {success:true,network:BASE_NETWORK,transaction,payer,amount};}};};
 const worker=createAgi({model,compiledRuntime:compiled,platformOptions:{payments,paymentAdapterFactory}});
 const request=(path,init={},current=worker,bindings=env)=>current.fetch(new Request(origin+path,init),bindings);
 const install=(expectedRevision=0)=>registry.install({db,reviewer:'local-owner',requestId:crypto.randomUUID(),manifestId:manifest.manifestId,expectedRevision});
 const suspend=(expectedRevision=1)=>registry.suspend({db,reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:product.id,expectedRevision});
 const invokePath=product.invocation.path,requirements=paymentRequirements(product,payments),seconds=Math.floor(Date.now()/1000);
 const body={version:product.version,input:{n:3},max_charge_usdc_atomic:'10000',success_contract_sha256:pin.sha256,payment_requirements_sha256:(await paymentRequirementsPin(requirements)).sha256};
 const payload={x402Version:2,resource:{url:origin+invokePath,description:'Local synthetic fixture',mimeType:'application/json'},accepted:requirements,
  payload:{signature:'0x'+'0'.repeat(130),authorization:{from:payer,to:payTo,value:'10000',validAfter:String(seconds-1),validBefore:String(seconds+300),nonce:'0x'+crypto.randomUUID().replaceAll('-','').padEnd(64,'a')}}};
 const paid=jsonPost(body,{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'Idempotency-Key':crypto.randomUUID(),'X-AgentToolbox-Sample':'synthetic'});
 return {db,product,pin,counts,admission,registry,compiled,model,worker,env,request,install,suspend,invokePath,body,paid,paymentAdapterFactory};
}

async function assertPublication(f,visible,worker=f.worker){
 const before=financialSnapshot(f.db),changes=f.db.sqlite.prepare('SELECT total_changes() n').get().n;
 for(const path of ['/','/agent.json','/tools','/tools.md','/tools.json','/llms.txt','/AGENTS.md','/index.md','/buy','/buy.md','/sell','/sell.md','/sitemap.xml']){
  const response=await f.request(path,{},worker);assert.equal(response.status,200,path);assert.equal(response.headers.get('cache-control'),'no-store',path);
  const text=await response.text();assert(!text.includes('never-fetch.example'),path);
  if(['/agent.json','/tools','/tools.md','/tools.json','/sitemap.xml'].includes(path))assert.equal(text.includes(f.product.id),visible,path);
 }
 for(const path of ['/','/tools'])for(const Accept of ['application/json','text/markdown']){
  const response=await f.request(path,{headers:{Accept}},worker);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
  const text=await response.text();if(path==='/tools'||Accept==='application/json')assert.equal(text.includes(f.product.id),visible,path+' '+Accept);
 }
 for(const suffix of ['','.md','/contract','/contract.md','/checks','/checks.md'])for(const Accept of ['text/html','text/markdown','application/json']){
  const response=await f.request('/tools/'+f.product.id+suffix,{headers:{Accept}},worker);assert.equal(response.status,visible?200:404,suffix+' '+Accept);assert.equal(response.headers.get('cache-control'),'no-store');
  if(visible){const text=await response.text();assert(text.includes(suffix.startsWith('/checks')?f.pin.sha256:f.product.id));}
 }
 const examples=await f.request('/tools/'+f.product.id+'/examples',{},worker);assert.equal(examples.status,404,'A reviewed creator does not inherit first-party fixtures.');
 const catalog=await responseJson(await f.request('/v1/products',{},worker));assert.equal(catalog.products.some(p=>p.id===f.product.id),visible);
 const history=await responseJson(await f.request('/v1/products?status=all',{},worker));assert.equal(history.products.find(p=>p.id===f.product.id).status,visible?'active':'retired');
 const spec=await responseJson(await f.request('/openapi.json',{},worker));assert.equal(Object.hasOwn(spec.paths,f.invokePath),visible);
 const x402=await responseJson(await f.request('/.well-known/x402',{},worker));assert.equal(x402.resources.includes(origin+f.invokePath),visible);
 const rpc=await responseJson(await f.request('/mcp',jsonPost({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_products',arguments:{}}},{Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'}),worker));
 assert(rpc.result?.structuredContent,JSON.stringify(rpc));assert.equal(rpc.result.structuredContent.products.some(p=>p.id===f.product.id),visible);
 const challenge=await f.request(f.invokePath,{},worker);assert.equal(challenge.status,visible?402:404);
 if(visible){const body=await challenge.json();assert.equal(body.contract_pins.success_contract_sha256,f.pin.sha256);}
 assert.deepEqual(financialSnapshot(f.db),before);assert.equal(f.db.sqlite.prepare('SELECT total_changes() n').get().n,changes,'Discovery must write no rows.');
}

test('production compiled registry remains empty of creators and first-party documents need no D1 reads or admission',async()=>{
 const reviewed=await reviewedCreatorRegistry;assert.deepEqual(reviewed.listManifests(),[]);assert.deepEqual(archivedCreatorProducts,[]);
 const compiled=await getCompiledRuntime();assert.deepEqual(compiled.catalog,products);assert.equal((await createModel()).tools.length,4);
 const forbidden=()=>{throw new Error('Static first-party documents must not read D1 or consume admission.');};
 const worker=createAgi(),env={METRICS_DB:{prepare:forbidden},PUBLIC_ORIGIN:origin,CLIENT_LIMIT:{limit:forbidden},SERVICE_LIMIT:{limit:forbidden}};
 for(const path of ['/tools','/tools.md','/tools.json','/agent.json','/tools/docs-pack/checks','/sitemap.xml']){
  const response=await worker.fetch(new Request(origin+path),env);assert.equal(response.status,200,path);assert.equal(response.headers.get('cache-control'),'public, max-age=60');
 }
});

test('reviewed install, suspension and adapter revocation gate every active discovery surface while preserving exact paid replay',async t=>{
 const f=await fixture(t);
 await assertPublication(f,false);assert.deepEqual(f.counts,{run:0,verify:0,settle:0,adapter:0});
 await f.install();await assertPublication(f,true);
 const first=await f.request(f.invokePath,f.paid),original=await responseJson(first),receipt=first.headers.get('PAYMENT-RESPONSE');
 assert.equal(original.output.doubled,6);assert.deepEqual(f.counts,{run:1,verify:1,settle:1,adapter:1});
 await f.suspend();await assertPublication(f,false);
 const unsigned=await f.request(f.invokePath,jsonPost(f.body));assert.equal(unsigned.status,410);
 const suspendedSnapshot=financialSnapshot(f.db),suspended=await f.request(f.invokePath,f.paid);
 assert.deepEqual(await responseJson(suspended),original);assert.equal(suspended.headers.get('PAYMENT-RESPONSE'),receipt);assert.deepEqual(financialSnapshot(f.db),suspendedSnapshot);
 const empty=await createReviewedCreatorRegistry();
 const archived=await createCompiledRuntime({registry:empty,archivedProducts:[f.product]});
 assert.equal(archived.catalog.find(p=>p.id===f.product.id).status,'retired');assert(!Object.hasOwn(archived.handlers,f.product.id));
 const archivedModel=await createModel({catalog:archived.catalog});assert(!archivedModel.tools.some(p=>p.id===f.product.id));
 // A stale generated snapshot must also fail closed after executable source is removed.
 const revoked=createAgi({model:f.model,compiledRuntime:archived,platformOptions:{payments,paymentAdapterFactory:()=>{throw new Error('Revoked replay cannot construct an adapter.');}}});
 await assertPublication(f,false,revoked);
 const revokedSnapshot=financialSnapshot(f.db),replay=await f.request(f.invokePath,f.paid,revoked);
 assert.deepEqual(await responseJson(replay),original);assert.equal(replay.headers.get('PAYMENT-RESPONSE'),receipt);assert.deepEqual(financialSnapshot(f.db),revokedSnapshot);
 const changed=await f.request(f.invokePath,{...f.paid,body:JSON.stringify({...f.body,input:{n:4}})},revoked);assert.equal(changed.status,409);assert.equal((await changed.json()).error.code,'payment_replay_conflict');
 const expired='2000-01-01T00:00:00.000Z';f.db.sqlite.prepare('UPDATE platform_payments SET result_expires_at=?').run(expired);
 const stale=await f.request(f.invokePath,f.paid,revoked);assert.equal(stale.status,410);assert.equal((await stale.json()).error.code,'paid_result_expired');
 assert.deepEqual(f.counts,{run:1,verify:1,settle:1,adapter:1});assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM platform_payments').get().n,1);
});

test('creator document reads fail closed on missing configuration, exhausted shared limits, unavailable D1 and stale generated pins',async t=>{
 const f=await fixture(t);await f.install();
 for(const env of [{},{...f.env,PUBLIC_ORIGIN:'https://wrong.invalid'}]){
  const response=await f.request('/tools.json',{},f.worker,env);assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 let reads=0;const guardedDb={prepare(){reads++;throw new Error('No D1 access is allowed after admission rejection.');}};
 for(const limit of ['SERVICE_LIMIT','CLIENT_LIMIT']){
  const response=await f.request('/agent.json',{},f.worker,{...f.env,METRICS_DB:guardedDb,[limit]:{limit:async()=>({success:false})}});
  assert.equal(response.status,429);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 assert.equal(reads,0);
 const unavailable=await f.request('/tools/'+f.product.id,{},f.worker,{...f.env,METRICS_DB:guardedDb});assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('cache-control'),'no-store');assert(!(await unavailable.text()).includes('No D1 access'));
 const before={...f.admission};const head=await f.request('/tools.json',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal(f.admission.service,before.service+1);assert.equal(f.admission.client,before.client+1);
 const stale={...f.model,tools:f.model.tools.map(p=>p.id===f.product.id?{...p,success_pin:{...p.success_pin,sha256:'f'.repeat(64)}}:p)};
 const staleWorker=createAgi({model:stale,compiledRuntime:f.compiled,platformOptions:{payments}});
 const catalog=await responseJson(await f.request('/tools.json',{},staleWorker));assert(!catalog.tools.some(p=>p.id===f.product.id));
 assert.equal((await f.request('/tools/'+f.product.id,{},staleWorker)).status,404);assert.deepEqual(f.counts,{run:0,verify:0,settle:0,adapter:0});
});

test('source composition rejects duplicate product identities and snapshots retired tombstones without executable handlers',async t=>{
 const f=await fixture(t);
 await assert.rejects(createCompiledRuntime({registry:f.registry,archivedProducts:[f.product]}),/unique/);
 await assert.rejects(createCompiledRuntime({registry:f.registry,builtinHandlers:{[f.product.id]:{run:()=>{}}}}),/replace first-party/);
 await assert.rejects(createCompiledRuntime({archivedProducts:[products[0]]}),/Archived creator/);
 const input=JSON.parse(JSON.stringify(f.product));
 const archived=await createCompiledRuntime({registry:await createReviewedCreatorRegistry(),archivedProducts:[input]});input.name='Mutated';input.outcome.success_criterion='Mutated';
 const product=archived.catalog.find(p=>p.id===f.product.id);assert.equal(product.name,f.product.name);assert.equal((await successContractPin(product)).sha256,f.pin.sha256);
 assert(Object.isFrozen(product));assert(Object.isFrozen(product.outcome));assert.equal(product.status,'retired');assert(!archived.handlers[product.id]);
});
