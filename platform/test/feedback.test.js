import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {expirePaidResults} from '../src/purchases.js';
const origin='https://example.invalid',version='0.1.0';
const key='feedback_test_abcdefghijklmnopqrstuvwxyz';
const basic={product_id:'docs-pack',version,helpful:true,message:'Useful exact excerpts.'};
function setup(options={}){
 const db=database();let executions=0;
 const handler={input:z.any(),output:z.strictObject({ok:z.boolean()}),run:async()=>{executions++;return {ok:true};},success:r=>r.ok};
 const app=createPlatform({db,origin,handlers:{'docs-pack':handler},...options});
 const request=(path,init={})=>app(new Request(origin+path,init));
 return {db,request,get executions(){return executions;},close:()=>db.close()};
}
const post=(body,k=key,headers={})=>({method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':k,...headers},body:JSON.stringify(body)});
test('feedback validates bounds and sensitive fields, stays private and replays once',async()=>{
 const s=setup();try{
  assert.equal((await s.request('/v1/feedback',post({product_id:'docs-pack'}))).status,400);
  for(const change of [{rating:6},{message:'x'.repeat(2001)},{task_description:'x'.repeat(1001)},{payment_signature:'secret'},{message:'Authorization: Bearer secret-token'},{message:'private_key=secret'}])assert.equal((await s.request('/v1/feedback',post({...basic,...change}))).status,400);
  assert.equal((await s.request('/v1/feedback',post(basic,'short'))).status,400);
  const first=await(await s.request('/v1/feedback',post(basic))).json();
  assert.equal(first.evidence.link,'unverified');assert.equal(first.payment_effect,'none');
  assert.deepEqual(await(await s.request('/v1/feedback',post(basic))).json(),first);
  assert.equal((await s.request('/v1/feedback',post({...basic,message:'Different'}))).status,409);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_feedback').get().n,1);
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_activity WHERE event='feedback_submitted'").get().n,1);
  assert.equal((await s.request('/v1/feedback')).status,404);
  assert.equal((await s.request('/admin/api/overview')).status,404);
 }finally{s.close();}
});
test('real example IDs link feedback and inherit synthetic classification; HEAD and replay do not execute',async()=>{
 const s=setup();try{
  assert.equal((await s.request('/v1/products/docs-pack/example',{method:'HEAD'})).status,200);assert.equal(s.executions,0);
  const init={headers:{'Idempotency-Key':key,'X-AgentToolbox-Sample':'synthetic'}};
  const example=await(await s.request('/v1/products/docs-pack/example',init)).json();
  assert.equal(example.payment.amount_settled_atomic,0);assert(example.example_id);
  assert.deepEqual(await(await s.request('/v1/products/docs-pack/example',init)).json(),example);assert.equal(s.executions,1);
  const ack=await(await s.request('/v1/feedback',post({...basic,reference:example.feedback.reference}))).json();
  assert.equal(ack.evidence.link,'server_record_linked');assert.equal(ack.evidence.execution_state,'completed');
  const row=s.db.sqlite.prepare('SELECT * FROM platform_feedback').get();assert.equal(row.sample_kind,'synthetic');
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_activity WHERE event='example_attempt'").get().n,1);
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_activity WHERE event='example_success'").get().n,1);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_paid_purchases').get().n,0);
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_examples WHERE sample_kind='synthetic'").get().n,1);
 }finally{s.close();}
});
test('concurrent example replay runs once; failed examples remain failed and are observable',async()=>{
 let release,calls=0;const pending=new Promise(resolve=>{release=resolve;});
 const s=setup({handlers:{'docs-pack':{input:z.any(),output:z.any(),run:async()=>{calls++;await pending;throw new Error('untrusted failure');},success:()=>true}}});
 try{
  const init={headers:{'Idempotency-Key':key}},first=s.request('/v1/products/docs-pack/example',init);
  while(!calls)await new Promise(resolve=>setTimeout(resolve,1));
  assert.equal((await s.request('/v1/products/docs-pack/example',init)).status,409);release();
  const failed=await first;assert.equal(failed.status,422);const result=await failed.json();assert(!JSON.stringify(result).includes('untrusted failure'));
  const id=result.error.details.example_id;assert(id);
  assert.equal((await s.request('/v1/products/docs-pack/example',init)).status,422);assert.equal(calls,1);
  const ack=await(await s.request('/v1/feedback',post({...basic,reference:{kind:'example',id}}))).json();assert.equal(ack.evidence.execution_state,'failed');
  assert.equal(s.db.sqlite.prepare("SELECT COUNT(*) AS n FROM platform_examples WHERE state='failed'").get().n,1);
 }finally{release();s.close();}
});
test('unknown and mismatched references are unverified; client flags cannot claim execution or payment',async()=>{
 const s=setup();try{
  const ack=await(await s.request('/v1/feedback',post({...basic,reference:{kind:'purchase',id:crypto.randomUUID()}}))).json();assert.equal(ack.evidence.link,'unverified');
  assert.equal(s.db.sqlite.prepare('SELECT reference_id FROM platform_feedback').get().reference_id,null);
  for(const extra of [{verified:true},{sample_kind:'live'},{payment:{status:'settled'}},{owner:true}])assert.equal((await s.request('/v1/feedback',post({...basic,...extra},key+'new'))).status,400);
  assert.equal((await s.request('/v1/feedback',post({...basic,version:'9.9.9'},key+'old'))).status,409);
 }finally{s.close();}
});
test('feedback rate gate applies before storing HTTP and MCP submissions',async()=>{
 const s=setup({feedbackLimit:async()=>false});try{
  const r=await s.request('/v1/feedback',post(basic));assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'60');
  const rpc=await s.request('/mcp',post({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'leave_feedback',arguments:{...basic,idempotency_key:key}}},key,{Accept:'application/json, text/event-stream'}));
  const data=await rpc.json();assert.equal(data.result.isError,true);assert.match(data.result.content[0].text,/rate_limited/);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_feedback').get().n,0);
 }finally{s.close();}
});
// These are in-memory storage fixtures, not signed authorizations or facilitator calls.
function paymentFixture(db,{kind='live',amount='10000',state='settled',payer='customer-wallet'}={}){
 const id=crypto.randomUUID(),date=new Date().toISOString(),receiver='owner-wallet';
 db.sqlite.prepare(`INSERT INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,is_live) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'executing',?,?,?,?)`)
  .run(id,'docs-pack',version,id,'fixture','fixture','eip155:8453','usdc',kind==='owner'?receiver:payer,id,amount,receiver,date,date,kind==='synthetic'?'synthetic':'unclassified',kind==='mock'?0:1);
 if(state==='settled')db.sqlite.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,'docs-pack',version,'settlement_reported','eip155:8453','usdc',amount,'fixture-transaction',kind==='synthetic'?'synthetic':'unclassified',date);
 db.sqlite.prepare('UPDATE platform_payments SET state=? WHERE operation_id=?').run(state,id);
 return id;
}
test('additive migration preserves legacy daily records and has no example backfill',async()=>{
 const s=setup();try{
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_examples').get().n,0);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_tracking').get().n,1);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n,4);
  await s.request('/v1/products');await s.request('/v1/products');
  assert.equal(s.db.sqlite.prepare("SELECT SUM(count) AS n FROM platform_daily WHERE event='catalog_view'").get().n,2);
  assert.equal(s.db.sqlite.prepare("SELECT SUM(count) AS n FROM platform_activity WHERE event='catalog_view'").get().n,2);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) AS n FROM platform_paid_purchases').get().n,0);
 }finally{s.close();}
});
test('upgrade from all three old migrations preserves every legacy record and counter without backfill',()=>{
 const sqlite=new DatabaseSync(':memory:');
 try{
  for(const file of ['0001_platform.sql','0002_payments.sql','0003_paid_launch.sql'])sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO platform_daily VALUES(?,?,?,?,?,?,?,?)').run('2026-09-30','docs-pack',version,'http','product_view','unclassified',17,0);
  paymentFixture({sqlite},{amount:'10000'});
  const tables=['platform_daily','platform_runs','platform_callers','platform_payments','platform_payment_ledger','platform_paid_purchases','platform_public_totals'];
  const snapshot=()=>Object.fromEntries(tables.map(name=>[name,JSON.stringify(sqlite.prepare('SELECT * FROM '+name+' ORDER BY rowid').all())]));
  const before=snapshot();sqlite.exec(readFileSync(new URL('../migrations/0004_feedback_analytics.sql',import.meta.url),'utf8'));
  assert.deepEqual(snapshot(),before);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_examples').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM platform_activity').get().n,0);
  assert.equal(sqlite.prepare("SELECT value FROM platform_public_totals WHERE key='paid_purchases'").get().value,1);
 }finally{sqlite.close();}
});
test('example result expiry removes output, preserves the execution link and never re-executes a replay',async()=>{
 const s=setup();try{
  const init={headers:{'Idempotency-Key':key}},example=await(await s.request('/v1/products/docs-pack/example',init)).json();
  s.db.sqlite.prepare('UPDATE platform_examples SET result_expires_at=? WHERE id=?').run('2000-01-01T00:00:00.000Z',example.example_id);
  await expirePaidResults(s.db);assert.equal(s.db.sqlite.prepare('SELECT result_json FROM platform_examples').get().result_json,null);
  assert.equal((await s.request('/v1/products/docs-pack/example',init)).status,410);assert.equal(s.executions,1);
  const ack=await(await s.request('/v1/feedback',post({...basic,reference:{kind:'example',id:example.example_id}}))).json();assert.equal(ack.evidence.link,'server_record_linked');
 }finally{s.close();}
});
