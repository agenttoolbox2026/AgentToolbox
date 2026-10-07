import test from 'node:test';
import assert from 'node:assert/strict';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
import {hash} from '../src/telemetry.js';
import {CREATOR_TERMS,submitTool} from '../src/submissions.js';
const origin='https://example.invalid',capability='atbc_'+Buffer.alloc(32,44).toString('base64url'),address='0x'+'1234'.repeat(10);
async function setup(){const db=database();await submitTool({db,capability,client:'local-wallet-api',body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal:{name:'LOCAL PRIVATE',summary:'Fixture never deployed',endpoint_url:'https://fixture.invalid.example/api',input_schema:{},output_schema:{}}}});return db;}
const body=()=>({request_id:crypto.randomUUID(),expected_revision:0,network:'eip155:8453',address});
const post=data=>({method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':capability},body:JSON.stringify(data)});
test('wallet HTTP is private, bounded, rate-limited and inert; owner financial actions have no routes',async()=>{
 const db=await setup(),app=createPlatform({db,origin}),call=(path,init={})=>app(new Request(origin+path,init),'local-client');try{
  const path='/v1/creators/me/payout-wallet';assert.equal((await call(path)).status,403);assert.equal((await call(path+'?creator_capability='+capability)).status,403);
  const saved=await call(path,post(body()));assert.equal(saved.status,200);assert.equal(saved.headers.get('Cache-Control'),'no-store');assert.equal((await saved.json()).ownership_status,'unverified');
  const privateView=await(await call(path,{headers:{'X-Creator-Capability':capability}})).json();assert.equal(privateView.wallet.revision,1);assert(!JSON.stringify(privateView).includes(capability));assert(!JSON.stringify(privateView).includes('capability_hash'));
  const forgery={...body(),expected_revision:1,ownership_status:'eoa_signature_verified',owner_approval:'approved'};assert.equal((await call(path,post(forgery))).status,400);
  assert.equal((await call(path,post({...body(),padding:'x'.repeat(17000)}))).status,413);
  assert.equal((await call(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'address='+address})).status,415);
  const limited=createPlatform({db,origin,feedbackLimit:async()=>false});assert.equal((await limited(new Request(origin+path+'/challenge',post({request_id:crypto.randomUUID(),claim_revision:1})),'client')).status,429);
  for(const p of ['/v1/payouts','/v1/payouts/approve','/v1/payouts/reconcile','/v1/creators/me/payout-wallet/approve'])assert.equal((await call(p,post({}))).status,404);
  for(const p of ['/v1/products','/openapi.json','/llms.txt']){const publicText=await(await call(p)).text();assert(!publicText.includes(address));assert(!publicText.includes(capability));}
  for(const table of ['platform_payments','platform_creator_payout_batches','platform_creator_payouts','platform_creator_payout_evidence'])assert.equal(db.sqlite.prepare('SELECT count(*) n FROM '+table).get().n,0);
 }finally{db.close();}
});
test('MCP wallet shares capability/runtime schemas; public registry contains no owner payout initiation',async()=>{
 const db=await setup(),app=createPlatform({db,origin}),rpc=async(method,params)=>{const r=await app(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}),'client');return (await r.json()).result;};try{
  const listed=await rpc('tools/list',{}),names=listed.tools.map(t=>t.name);for(const name of ['claim_creator_payout_wallet','get_creator_payout_wallet','create_creator_wallet_challenge','verify_creator_wallet','get_creator_earnings'])assert(names.includes(name));assert(!names.some(x=>/authorize_payout|reconcile_payout|propose_payout|approve_wallet/.test(x)));
  const data=body(),saved=await rpc('tools/call',{name:'claim_creator_payout_wallet',arguments:{...data,creator_capability:capability}});assert.equal(saved.structuredContent.ownership_status,'unverified');
  const replay=await rpc('tools/call',{name:'claim_creator_payout_wallet',arguments:{...data,creator_capability:capability}});assert.equal(replay.structuredContent.claim_id,saved.structuredContent.claim_id);
  const challenge=await rpc('tools/call',{name:'create_creator_wallet_challenge',arguments:{creator_capability:capability,request_id:crypto.randomUUID(),claim_revision:1}});assert(challenge.structuredContent.message.startsWith('example.invalid wants you to sign in'));assert.equal(challenge.structuredContent.erc1271_supported,false);
  const wrong=await rpc('tools/call',{name:'get_creator_payout_wallet',arguments:{creator_capability:'atbc_'+Buffer.alloc(32,45).toString('base64url')}});assert(wrong.isError);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_payments').get().n,0);
 }finally{db.close();}
});
test('OpenAPI describes typed destination/proof/earnings contracts without public payout execution',async()=>{
 const db=database(),app=createPlatform({db,origin});try{
  const schema=await(await app(new Request(origin+'/openapi.json'))).json(),path='/v1/creators/me/payout-wallet';
  assert.deepEqual(schema.paths[path].post.requestBody.content['application/json'].schema.required.sort(),['address','expected_revision','network','request_id']);
  assert.equal(schema.paths[path].post.parameters[0].name,'X-Creator-Capability');assert.equal(schema.paths[path].get.responses[200].content['application/json'].schema.properties.history.maxItems,20);
  assert(schema.paths[path+'/verify']);assert(schema.paths['/v1/creator-tools/{tool_id}/earnings']);assert(!schema.paths['/v1/payouts']);
  const terms=await(await app(new Request(origin+'/v1/creator-terms'))).json();assert.deepEqual(terms.terms,CREATOR_TERMS);assert.equal(terms.payout_wallet_path,path);
 }finally{db.close();}
});
