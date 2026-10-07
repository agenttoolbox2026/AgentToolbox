import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {z} from 'zod';
import {encodePaymentSignatureHeader} from '../../platform/node_modules/@x402/core/dist/esm/http/index.mjs';
import {createAgi} from '../src/worker.js';
import {createPlatform} from '../../platform/src/app.js';
import {database} from '../../platform/scripts/local-db.js';
import {products} from '../../platform/src/registry.js';
import {hash} from '../../platform/src/telemetry.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC} from '../../platform/src/payment-config.js';
import {CREATOR_TERMS} from '../../platform/src/submissions.js';
import {REFERRAL_TERMS} from '../../platform/src/referrals.js';

const OLD='https://agnttoolbx.agenttoolbox2026.workers.dev';
const ORIGIN='https://agi.agenttoolbox2026.workers.dev';
const PAY_TO='0x'+'1'.repeat(40),PAYER='0x'+'2'.repeat(40),TX='0x'+'c'.repeat(64);
const CAPABILITY='atbp_'+Buffer.alloc(32,7).toString('base64url');
const PATH='/v1/products/docs-pack';
const config={enabled:true,live:true,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:PAY_TO};
const jsonPost=(body,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const noNetwork=t=>t.mock.method(globalThis,'fetch',()=>{throw new Error('Migration tests must never call an external service.');});
async function responseJson(response,status=200){const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;}

function fixture(t,{run,settle}={}){
 noNetwork(t);
 const db=database(),counts={run:0,verify:0,settle:0},assetRequests=[];
 t.after(()=>db.close());
 const input=z.strictObject({n:z.number().int().min(1)}),output=z.strictObject({value:z.number().int()});
 const product={...products.find(p=>p.id==='docs-pack'),example_input:{n:7},input_schema:z.toJSONSchema(input),output_schema:z.toJSONSchema(output)};
 const handler={input,output,run:async value=>{counts.run++;return run?run(value):{value:value.n};},success:()=>true,preview:()=>({validated:true})};
 const adapterFactory=async({amount})=>({requirements:paymentRequirements(product,config,amount),verify:async()=>{counts.verify++;return {isValid:true,payer:PAYER};},settle:async()=>{counts.settle++;return settle?settle():{success:true,network:BASE_NETWORK,transaction:TX,payer:PAYER,amount};}});
 const assets={fetch:async request=>{
  assetRequests.push(request);
  const path=new URL(request.url).pathname;
  const files={'/style.css':'style.css','/workflow.css':'workflow.css','/humans.css':'humans.css','/site.js':'site.js','/retry-envelope.js':'retry-envelope.js','/agenttoolbox-icon.png':'agenttoolbox-icon.png'};
  if(!Object.hasOwn(files,path))return new Response(null,{status:404});
  const content=await readFile(new URL('../public/'+files[path],import.meta.url));
  return new Response(request.method==='HEAD'?null:content,{headers:{'Content-Type':path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':'image/png'}});
 }};
 const allow={limit:async()=>({success:true})};
 const env={METRICS_DB:db,PUBLIC_ORIGIN:ORIGIN,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow,ASSETS:assets,
  PAYMENTS_MODE:'x402',PAY_TO_ADDRESS:PAY_TO,PAYMENT_NETWORK:BASE_NETWORK,PAYMENT_ASSET:BASE_USDC,RECEIVER_CONFIRMED:'true'};
 const options={catalog:[product],handlers:{[product.id]:handler},payments:config,paymentAdapterFactory:adapterFactory};
 const worker=createAgi({platformOptions:options});
 const oldApp=createPlatform({db,origin:OLD,...options});
 const old=(path,init={})=>oldApp(new Request(OLD+path,init),'migration-fixture');
 const next=(path,init={})=>worker.fetch(new Request(ORIGIN+path,init),env);
 const authorize=(body,{amount=body.payment_amount_atomic??'10000',nonce=crypto.randomUUID().replaceAll('-','').padEnd(64,'a'),resourceOrigin=OLD,key=crypto.randomUUID(),capability}={})=>{
  const now=Math.floor(Date.now()/1000);
  const payload={x402Version:2,resource:{url:resourceOrigin+PATH+'/invoke',description:'Local migration fixture',mimeType:'application/json'},accepted:paymentRequirements(product,config,amount),payload:{signature:'0x'+'0'.repeat(130),authorization:{from:PAYER,to:PAY_TO,value:amount,validAfter:String(now-1),validBefore:String(now+300),nonce:'0x'+nonce}}};
  return {body,payload,headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'Idempotency-Key':key,...(capability?{'X-Preparation-Capability':capability}:{})}};
 };
 const invoke=(client,operation)=>client(PATH+'/invoke',jsonPost(operation.body,operation.headers));
 const direct=()=>({version:product.version,input:{n:7},max_charge_usdc_atomic:'10000'});
 return {db,counts,product,handler,options,env,worker,old,next,authorize,invoke,direct,assetRequests};
}

function financialSnapshot(db){
 const tables=['platform_payment_ledger','platform_paid_purchases','platform_public_totals','platform_live_receipts','platform_creator_entitlements','platform_creator_allocations','platform_referrers','platform_referral_allocations'];
 return Object.fromEntries(tables.map(name=>[name,db.sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
}

test('old-origin preparation and quote complete through AGI with original pins and capability, without rerunning work',async t=>{
 const s=fixture(t),headers={'X-Preparation-Capability':CAPABILITY};
 const prepareBody={version:s.product.version,input:{n:7},request_id:crypto.randomUUID(),prepare_secret_hash:await hash(CAPABILITY)};
 const prepared=await responseJson(await s.old(PATH+'/prepare',jsonPost(prepareBody,headers)));
 assert.deepEqual(await responseJson(await s.next(PATH+'/prepare',jsonPost(prepareBody,headers))),prepared);
 const quote=await responseJson(await s.old(PATH+'/quote',jsonPost({version:s.product.version,prepared_id:prepared.prepared_id,payment_amount_atomic:'10001'},headers)));
 assert.equal(quote.payment.resource.url,OLD+PATH+'/invoke');
 const body={version:s.product.version,prepared_id:prepared.prepared_id,quote_id:quote.quote_id,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001',success_contract_sha256:quote.contract_pins.success_contract_sha256,payment_requirements_sha256:quote.contract_pins.payment_requirements_sha256};
 const operation=s.authorize(body,{capability:CAPABILITY});
 const result=await responseJson(await s.invoke(s.next,operation));
 assert.equal(result.output.value,7);assert.deepEqual(result.contract_pins,quote.contract_pins);
 assert.deepEqual(s.counts,{run:1,verify:1,settle:1});
 assert.deepEqual(await responseJson(await s.invoke(s.old,operation)),result);
 assert.deepEqual(await responseJson(await s.invoke(s.next,operation)),result);
 for(const capability of ['', 'atbp_'+Buffer.alloc(32,8).toString('base64url')]){
  const rejected=await responseJson(await s.invoke(s.next,{...operation,headers:{...operation.headers,'X-Preparation-Capability':capability}}),403);
  assert.match(rejected.error.code,/preparation_capability/);
 }
 const changed=structuredClone(operation.payload);changed.resource.url=ORIGIN+PATH+'/invoke';
 assert.equal((await responseJson(await s.invoke(s.next,{...operation,headers:{...operation.headers,'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(changed)}}),409)).error.code,'payment_replay_conflict');
 assert.deepEqual(s.counts,{run:1,verify:1,settle:1});
 assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,1);
 assert.equal(s.db.sqlite.prepare('SELECT state FROM platform_preparations').get().state,'claimed');
});

test('old settled purchase replays through AGI even after current contract/version/config changes and preserves financial history',async t=>{
 const s=fixture(t),operation=s.authorize(s.direct());
 const response=await s.invoke(s.old,operation),receipt=response.headers.get('PAYMENT-RESPONSE'),result=await responseJson(response);
 const before=financialSnapshot(s.db);
 // Expire the original authorization while remaining inside paid output retention.
 t.mock.timers.enable({apis:['Date'],now:Date.now()+3600000});
 const changed=createAgi({platformOptions:{...s.options,catalog:[{...s.product,version:'9.0.0',status:'retired'}],handlers:{},payments:{enabled:false},paymentAdapterFactory:()=>{throw new Error('Frozen replay must not construct a payment adapter.');}}});
 const replay=await changed.fetch(new Request(ORIGIN+PATH+'/invoke',jsonPost(operation.body,operation.headers)),s.env);
 assert.equal(replay.headers.get('PAYMENT-RESPONSE'),receipt);assert.deepEqual(await responseJson(replay),result);
 assert.deepEqual(financialSnapshot(s.db),before);assert.deepEqual(s.counts,{run:1,verify:1,settle:1});
 assert.equal((await responseJson(await s.next('/v1/stats'))).lifetime_paid_purchases,1);
 s.db.sqlite.prepare('UPDATE platform_payments SET result_expires_at=?').run('2000-01-01T00:00:00.000Z');
 const expired=await responseJson(await s.invoke(s.next,operation),410);
 assert.equal(expired.error.code,'paid_result_expired');assert.deepEqual(s.counts,{run:1,verify:1,settle:1});
 assert.deepEqual(financialSnapshot(s.db),before);
});

test('old unresolved states never release output, rerun work or settle again through the AGI wrapper',async t=>{
 const s=fixture(t,{settle:()=>{throw new Error('Local simulated settlement timeout');}}),operation=s.authorize(s.direct());
 assert.equal((await responseJson(await s.invoke(s.old,operation),503)).error.code,'settlement_unresolved');
 const before=financialSnapshot(s.db);
 for(const state of ['executing','outcome_ready','settling','unknown']){
  s.db.sqlite.prepare('UPDATE platform_payments SET state=?').run(state);
  const result=await responseJson(await s.invoke(s.next,operation),503);
  assert.equal(result.error.code,'settlement_unresolved');assert.equal(result.output,undefined);
  assert.deepEqual(s.counts,{run:1,verify:1,settle:1});
 }
 assert.deepEqual(financialSnapshot(s.db),before);
 assert.equal((await responseJson(await s.next('/v1/stats'))).lifetime_paid_purchases,0);
});

test('concurrent old and AGI requests share one admission, and a new key cannot reuse the old nonce',async t=>{
 let release,started;
 const gate=new Promise(resolve=>{release=resolve;}),running=new Promise(resolve=>{started=resolve;});
 const s=fixture(t,{run:async input=>{started();await gate;return {value:input.n};}}),operation=s.authorize(s.direct());
 t.after(()=>release());
 const first=s.invoke(s.old,operation);await running;
 assert.equal((await responseJson(await s.invoke(s.next,operation),503)).error.code,'settlement_unresolved');
 assert.deepEqual(s.counts,{run:1,verify:1,settle:0});release();
 const completed=await responseJson(await first);
 assert.deepEqual(await responseJson(await s.invoke(s.next,operation)),completed);
 const reused={...operation,headers:{...operation.headers,'Idempotency-Key':crypto.randomUUID()}};
 assert.equal((await responseJson(await s.invoke(s.next,reused),409)).error.code,'authorization_already_used');
 assert.equal(s.counts.run,1);assert.equal(s.counts.settle,1);
 assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,1);
 assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) n FROM platform_payment_ledger WHERE event='settlement_reported'").get().n,1);
 assert.equal(s.db.sqlite.prepare('SELECT value FROM platform_public_totals').get().value,1);
});

test('creator approval/history and referral capabilities created on the old host remain usable through AGI',async t=>{
 const s=fixture(t),creator='atbc_'+Buffer.alloc(32,11).toString('base64url'),referral='atbf_'+Buffer.alloc(32,12).toString('base64url');
 const body={terms_version:CREATOR_TERMS.terms_version,creator_secret_hash:await hash(creator),request_id:crypto.randomUUID(),proposal:{name:'Local migration fixture',summary:'Read-only continuity fixture',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}};
 const headers={'X-Creator-Capability':creator};
 const saved=await responseJson(await s.old('/v1/tool-submissions',jsonPost(body,headers)));
 assert.deepEqual(await responseJson(await s.next('/v1/tool-submissions',jsonPost(body,headers))),saved);
 await s.db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),saved.submission_id,'local-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'approved','Local test only',new Date().toISOString()).run();
 const oldTool=await responseJson(await s.old('/v1/creator-tools/'+saved.tool_id,{headers}));
 const before=financialSnapshot(s.db);
 assert.deepEqual(await responseJson(await s.next('/v1/creator-tools/'+saved.tool_id,{headers})),oldTool);
 assert.equal((await responseJson(await s.next('/v1/tool-submissions/'+saved.submission_id,{headers}))).state,'approved');
 assert.equal((await s.next('/v1/creator-tools/'+saved.tool_id)).status,403);
 assert.deepEqual(financialSnapshot(s.db),before);
 const refHeaders={'X-Referral-Capability':referral},refBody={terms_version:REFERRAL_TERMS.terms_version};
 const account=await responseJson(await s.old('/v1/referrals',jsonPost(refBody,refHeaders)));
 assert.deepEqual(await responseJson(await s.next('/v1/referrals',jsonPost(refBody,refHeaders))),account);
 assert.deepEqual(await responseJson(await s.next('/v1/referrals/me',{headers:refHeaders})),await responseJson(await s.old('/v1/referrals/me',{headers:refHeaders})));
 assert.equal((await s.next('/v1/referrals/me')).status,403);
 assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creators').get().n,1);
 assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_referrers').get().n,1);
 assert.equal(s.counts.settle,0);
});

test('AGI discovery is local, has the new resource origin, preserves payment pins and never redirects or reflects credentials',async t=>{
 const s=fixture(t),secrets={'Authorization':'Bearer private-authorization','Cookie':'private-cookie','PAYMENT-SIGNATURE':'private-payment','X-Creator-Capability':'private-creator','X-Preparation-Capability':'private-preparation','X-Referral-Capability':'private-referral'};
 for(const path of ['/openapi.json','/.well-known/x402','/v1/products','/v1/creator-terms','/v1/referral-terms']){
  const response=await s.next(path+(path==='/v1/products'?'':'?private=private-query'),{headers:secrets});
  assert.equal(response.status,200,path);assert.equal(response.headers.has('location'),false,path);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const text=await response.text();assert.doesNotMatch(text,/private-(?:authorization|cookie|payment|creator|preparation|referral|query)/);
  if(['/openapi.json','/.well-known/x402'].includes(path)){assert(text.includes(ORIGIN));assert(!text.includes(OLD));}
 }
 const old=await responseJson(await s.old(PATH+'/invoke'),402),next=await responseJson(await s.next(PATH+'/invoke'),402);
 assert.equal(next.payment.resource.url,ORIGIN+PATH+'/invoke');
 assert.deepEqual(next.payment.accepts,old.payment.accepts);assert.deepEqual(next.contract_pins,old.contract_pins);
 assert.deepEqual(s.counts,{run:0,verify:0,settle:0});assert.equal(s.assetRequests.length,0);
});

test('AGI keeps HTTP capability CORS and enforces the new exact MCP Origin policy',async t=>{
 const s=fixture(t);
 const preflight=await s.next(PATH+'/prepare',{method:'OPTIONS',headers:{Origin:'https://caller.example','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'X-Preparation-Capability,PAYMENT-SIGNATURE,Idempotency-Key'}});
 assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),'*');
 for(const name of ['X-Preparation-Capability','X-Creator-Capability','X-Referral-Capability','PAYMENT-SIGNATURE','Idempotency-Key'])assert(preflight.headers.get('access-control-allow-headers').includes(name));
 assert(preflight.headers.get('access-control-expose-headers').includes('PAYMENT-RESPONSE'));
 const rpc={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'local-migration-test',version:'1'}}};
 for(const origin of [undefined,ORIGIN,OLD,'https://unrelated.example','null']){
  const headers={Accept:'application/json, text/event-stream',...(origin?{Origin:origin}:{})};
  const expected=origin===undefined||origin===ORIGIN?200:403;
  const result=await responseJson(await s.next('/mcp',jsonPost(rpc,headers)),expected);
  if(expected===403)assert.equal(result.error.code,'origin_not_allowed');else assert.equal(result.result.serverInfo.name,'agenttoolbox');
 }
 assert.equal(s.counts.settle,0);
});

test('operational pages retain working CSP and load actual workflow CSS and both script modules through sanitized assets',async t=>{
 const s=fixture(t);
 for(const path of ['/submit-tool','/update-tool','/products/docs-pack/preview','/products/docs-pack/reviews']){
  const response=await s.next(path);assert.equal(response.status,200,path);
  const html=await response.text(),policy=response.headers.get('content-security-policy');
  assert.match(html,/href="\/workflow\.css(?:\?[^\"]*)?"/,path);assert.match(html,/src="\/site\.js(?:\?[^\"]*)?"/,path);
  assert.doesNotMatch(html,/href="\/style\.css(?:\?|\")/,path);
  assert(policy.includes("script-src 'self'"),path);assert(policy.includes("form-action 'self'"),path);
  assert(!policy.includes("connect-src 'none'"),path);assert.equal(response.headers.get('cache-control'),'no-store');
 }
 const secrets={Authorization:'Bearer private-sentinel',Cookie:'private-sentinel','PAYMENT-SIGNATURE':'private-sentinel','X-Preparation-Capability':'private-sentinel','X-Creator-Capability':'private-sentinel','X-Referral-Capability':'private-sentinel'};
 for(const path of ['/workflow.css','/site.js','/retry-envelope.js'])for(const method of ['GET','HEAD']){
  const response=await s.next(path+'?private=private-query',{method,headers:secrets});assert.equal(response.status,200,path);
  const body=await response.text(),sent=s.assetRequests.at(-1);
  assert.equal(sent.url,ORIGIN+path);assert.equal(sent.method,method);assert.equal(sent.body,null);
  for(const name of Object.keys(secrets))assert.equal(sent.headers.has(name),false,path+': '+name);
  if(method==='HEAD')assert.equal(body,'');else assert.equal(body,await readFile(new URL('../public'+path,import.meta.url),'utf8'));
 }
 assert.match(await readFile(new URL('../public/site.js',import.meta.url),'utf8'),/from ['"]\.\/retry-envelope\.js['"]/);
 const before=s.assetRequests.length;
 assert.equal((await s.next('/site.js',jsonPost({private:'sentinel'},secrets))).status,405);
 assert.equal((await s.next('/private-unlisted.js',{headers:secrets})).status,404);
 assert.equal(s.assetRequests.length,before);
});

test('AGI scheduled cleanup expires retained output but keeps unresolved prepared results and all financial tombstones',async t=>{
 let uncertain=false;
 const s=fixture(t,{settle:()=>{if(uncertain)throw new Error('Local timeout');return {success:true,network:BASE_NETWORK,transaction:TX,payer:PAYER,amount:'10000'};}});
 const purchase=async()=>{
  const headers={'X-Preparation-Capability':CAPABILITY};
  const prepared=await responseJson(await s.old(PATH+'/prepare',jsonPost({version:s.product.version,input:{n:7},request_id:crypto.randomUUID(),prepare_secret_hash:await hash(CAPABILITY)},headers)));
  const quote=await responseJson(await s.old(PATH+'/quote',jsonPost({version:s.product.version,prepared_id:prepared.prepared_id,payment_amount_atomic:'10000'},headers)));
  const operation=s.authorize({version:s.product.version,prepared_id:prepared.prepared_id,quote_id:quote.quote_id,payment_amount_atomic:'10000',max_charge_usdc_atomic:'10000'},{capability:CAPABILITY});
  await responseJson(await s.invoke(s.old,operation),uncertain?503:200);return prepared.prepared_id;
 };
 const settled=await purchase();uncertain=true;const unknown=await purchase();
 s.db.sqlite.prepare('UPDATE platform_payments SET result_expires_at=?').run('2000-01-01T00:00:00.000Z');
 const before=financialSnapshot(s.db),states=s.db.sqlite.prepare('SELECT operation_id,state FROM platform_payments ORDER BY operation_id').all();
 const clean=async()=>{const pending=[];await s.worker.scheduled({},s.env,{waitUntil:promise=>pending.push(promise)});assert(pending.length>0);await Promise.all(pending);};
 await clean();
 const prepared=id=>s.db.sqlite.prepare('SELECT result_json,preview_json FROM platform_preparations WHERE prepared_id=?').get(id);
 assert.deepEqual({...prepared(settled)},{result_json:null,preview_json:null});assert(prepared(unknown).result_json);assert(prepared(unknown).preview_json);
 assert.equal(s.db.sqlite.prepare("SELECT result_json FROM platform_payments WHERE state='settled'").get().result_json,null);
 assert(s.db.sqlite.prepare("SELECT result_json FROM platform_payments WHERE state='unknown'").get().result_json);
 assert.deepEqual(financialSnapshot(s.db),before);assert.deepEqual(s.db.sqlite.prepare('SELECT operation_id,state FROM platform_payments ORDER BY operation_id').all(),states);
 await clean();assert.deepEqual(financialSnapshot(s.db),before);assert.equal(s.counts.settle,2);
});
