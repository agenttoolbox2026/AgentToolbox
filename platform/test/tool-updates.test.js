import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
import {submitTool,CREATOR_TERMS} from '../src/submissions.js';
import {submitToolUpdate,getCreatorTool,getToolUpdate} from '../src/tool-updates.js';
import {hash} from '../src/telemetry.js';
const capability='atbc_'+Buffer.alloc(32,21).toString('base64url'),other='atbc_'+Buffer.alloc(32,22).toString('base64url'),date='2026-10-07T10:00:00.000Z',origin='https://example.invalid';
const proposal={name:'LOCAL <script>alert(1)</script>',summary:'Local private fixture only',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}};
async function initial(db,{approved=true,secret=capability,client='initial'}={}){
 const data={request_id:crypto.randomUUID(),creator_secret_hash:await hash(secret),terms_version:CREATOR_TERMS.terms_version,proposal};
 const s=await submitTool({db,body:data,capability:secret,client,now:()=>new Date(date)});
 if(approved)await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),s.submission_id,'fixture-owner',await hash(crypto.randomUUID()),await hash(JSON.stringify(s)),0,1,'approved','Local only',date).run();
 return s;
}
async function body(extra={}){return {request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,base_version:'0.1.0',expected_head_revision:0,proposed_version:'0.2.0',proposal:{...proposal,summary:'Private proposed update'},...extra};}
const submit=(db,tool,data,secret=capability,client='updates')=>submitToolUpdate({db,tool,body:data,capability:secret,client,now:()=>new Date(date)});
async function decide(db,p,{decision='approved',revision=0,headRevision=p.expected_head_revision}={}){
 const value={update_id:p.update_id,decision,expected_revision:revision,expected_head_revision:headRevision,reason:'LOCAL <img src=x onerror=alert(1)>'};
 return db.prepare('INSERT INTO platform_tool_update_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),p.update_id,'private-owner',await hash(crypto.randomUUID()),await hash(JSON.stringify(value)),revision,revision+1,headRevision,decision,value.reason,date).run();
}
test('approved metadata starts at 0.1.0; original capability and entitlement bind all private update reads/writes',async()=>{
 const db=database();try{
  db.sqlite.exec('PRAGMA foreign_keys=ON');const s=await initial(db),head=await getCreatorTool({db,tool:s.tool_id,capability});
  assert.equal(head.current_version,'0.1.0');assert.equal(head.head_revision,0);assert.deepEqual(head.terms,CREATOR_TERMS);assert.equal(head.history.length,1);
  for(const tool of [s.tool_id,'creator-'+crypto.randomUUID()])await assert.rejects(getCreatorTool({db,tool,capability:other}),e=>e.code==='creator_capability_invalid');
  const pending=await initial(db,{approved:false});await assert.rejects(submit(db,pending.tool_id,await body()),e=>e.status===403);
  const rejected=await initial(db,{approved:false,client:'second'});await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),rejected.submission_id,'fixture-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'rejected','Local',date).run();
  await assert.rejects(getCreatorTool({db,tool:rejected.tool_id,capability}),e=>e.status===403);
  const p=await submit(db,s.tool_id,await body());assert.equal(p.state,'pending');assert.equal((await getCreatorTool({db,tool:s.tool_id,capability})).current_version,'0.1.0');
  await assert.rejects(getToolUpdate({db,id:p.update_id,capability:other}),e=>e.status===403);await assert.rejects(getToolUpdate({db,id:crypto.randomUUID(),capability:other}),e=>e.status===403);
  const data=JSON.stringify(await getToolUpdate({db,id:p.update_id,capability}));assert(!data.includes(capability));assert(!data.includes('creator_id'));assert(!data.includes('request_hash'));assert(!data.includes('capability_hash'));
  const otherTool=await initial(db,{secret:other,client:'other'});await assert.rejects(submit(db,otherTool.tool_id,await body()),e=>e.status===403);
 }finally{db.close();}
});
test('update replay is tool-scoped, concurrent-idempotent and survives approved head changes',async()=>{
 const db=database();try{
  const s=await initial(db),data=await body(),ps=await Promise.all([submit(db,s.tool_id,data),submit(db,s.tool_id,data)]);assert.equal(ps[0].update_id,ps[1].update_id);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_proposals').get().n,1);
  await decide(db,ps[0]);const replay=await submit(db,s.tool_id,data);assert.equal(replay.update_id,ps[0].update_id);assert.equal(replay.state,'approved');assert(!JSON.stringify(replay).includes('private-owner'));
  await assert.rejects(submit(db,s.tool_id,{...data,proposal:{...proposal,name:'Changed'}}),e=>e.code==='tool_update_conflict');
  const another=await initial(db,{client:'another'});const second=await submit(db,another.tool_id,data);assert.notEqual(second.update_id,replay.update_id);
  const head=await getCreatorTool({db,tool:s.tool_id,capability});assert.equal(head.current_version,'0.2.0');assert.equal(head.head_revision,1);assert.equal(head.history.length,2);assert.equal(head.entitlement.share_bps,9000);
  const raw=db.sqlite.prepare('SELECT * FROM platform_creator_entitlements WHERE tool_id=?').get(s.tool_id);assert.equal(raw.installed_adapter,null);assert.equal(raw.share_bps,9000);assert.equal(raw.submission_id,s.submission_id);
 }finally{db.close();}
});
test('competing approvals CAS the metadata head; stale rejection and pending proposals retain the approved version',async()=>{
 const db=database();try{
  const s=await initial(db),a=await submit(db,s.tool_id,await body()),b=await submit(db,s.tool_id,await body({proposed_version:'0.3.0'}));
  await assert.rejects(decide(db,a,{headRevision:1}),/update_revision_conflict/);await assert.rejects(decide(db,a,{revision:1}),/update_revision_conflict/);
  const results=await Promise.allSettled([decide(db,a),decide(db,b)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/tool_head_conflict/);
  const before=await getCreatorTool({db,tool:s.tool_id,capability}),loser=results[0].status==='rejected'?a:b;
  await decide(db,loser,{decision:'rejected'});const after=await getCreatorTool({db,tool:s.tool_id,capability});assert.deepEqual(after,before);
  assert.equal((await getToolUpdate({db,id:loser.update_id,capability})).state,'rejected');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_decisions').get().n,2);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_tool_versions').get().n,2);
  await assert.rejects(submit(db,s.tool_id,await body()),e=>e.code==='tool_head_conflict');
  for(const sql of ["UPDATE platform_tool_update_proposals SET proposal_json='{}'","UPDATE platform_tool_update_proposals SET state='approved'","UPDATE platform_tool_update_decisions SET reason='spoof'","UPDATE platform_creator_tool_versions SET version='9.0.0'","UPDATE platform_creator_tool_heads SET current_version='0.1.0'","DELETE FROM platform_creator_tool_heads","UPDATE platform_creator_entitlements SET share_bps=8000"])assert.throws(()=>db.sqlite.exec(sql));
 }finally{db.close();}
});
test('failed version/head persistence rolls back audit, metadata and proposal together',async()=>{
 for(const table of ['platform_creator_tool_versions','platform_creator_tool_heads']){
  const db=database();try{
   const s=await initial(db),p=await submit(db,s.tool_id,await body());db.sqlite.exec(`CREATE TRIGGER fixture_fail BEFORE ${table.endsWith('heads')?'UPDATE':'INSERT'} ON ${table} BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END;`);
   await assert.rejects(decide(db,p),/fixture_disk_failure/);assert.equal((await getToolUpdate({db,id:p.update_id,capability})).state,'pending');assert.equal((await getCreatorTool({db,tool:s.tool_id,capability})).current_version,'0.1.0');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_decisions').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_tool_versions').get().n,1);
  }finally{db.close();}
 }
});
test('strict bounded versions/terms/fields and private capabilities reject forgeries without fetch or financial changes',async()=>{
 const db=database();try{
  const s=await initial(db),data=await body();
  for(const version of ['0.1.0','0.0.9','01.2.0','0.2.0-beta','0.2.0+build','1000000.0.0','2.0','-1.0.0'])await assert.rejects(submit(db,s.tool_id,{...data,proposed_version:version}),e=>e.status===400);
  for(const extra of [{state:'approved'},{share_bps:10000},{creator_id:'spoof'},{terms_version:'changed'},{expected_head_revision:-1}])await assert.rejects(submit(db,s.tool_id,{...data,...extra}),e=>e.status===400);
  await assert.rejects(submit(db,s.tool_id,{...data,creator_secret_hash:await hash(other)}),e=>e.status===403);
  await assert.rejects(submit(db,s.tool_id,{...data,proposal:{...proposal,summary:capability}}),e=>e.code==='capability_in_proposal');
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Never fetch a proposed endpoint');};try{const p=await submit(db,s.tool_id,data);await decide(db,p);}finally{globalThis.fetch=originalFetch;}
  for(const table of ['platform_payments','platform_payment_ledger','platform_live_receipts','platform_creator_allocations','platform_submission_refund_obligations'])assert.equal(db.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n,0);
  assert(!JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_tool_update_proposals').all()).includes(capability));
 }finally{db.close();}
});
test('initial submissions and updates share atomic daily admission; exhausted replay works and creates no orphan creator',async()=>{
 const db=database();try{
  const s=await initial(db,{client:'combined'}),data=await body();await submit(db,s.tool_id,data,capability,'combined');
  await Promise.all([submit(db,s.tool_id,await body(),capability,'combined'),submit(db,s.tool_id,await body(),capability,'combined')]);
  await assert.rejects(submit(db,s.tool_id,await body(),capability,'combined'),e=>e.status===429);
  await assert.rejects(initial(db,{secret:other,client:'combined'}),e=>e.status===429);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creators').get().n,1);
  assert.equal((await submit(db,s.tool_id,data,capability,'combined')).state,'pending');
  for(let i=4;i<40;i++)await submit(db,s.tool_id,await body(),capability,'client-'+i);
  await assert.rejects(submit(db,s.tool_id,await body(),capability,'new'),e=>e.status===429);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_proposals').get().n,39);
 }finally{db.close();}
});
test('approved history uses bounded keyset pages and rejects cross-tool cursors',async()=>{
 const db=database();try{
  const s=await initial(db);for(let i=2;i<=5;i++){const p=await submit(db,s.tool_id,await body({base_version:`0.${i-1}.0`,expected_head_revision:i-2,proposed_version:`0.${i}.0`}),capability,'page-'+i);await decide(db,p);}
  const first=await getCreatorTool({db,tool:s.tool_id,capability,params:{limit:'2'}});assert.deepEqual(first.history.map(r=>r.version),['0.5.0','0.4.0']);assert(first.next_cursor);
  const second=await getCreatorTool({db,tool:s.tool_id,capability,params:{limit:2,cursor:first.next_cursor}});assert.deepEqual(second.history.map(r=>r.version),['0.3.0','0.2.0']);
  const last=await getCreatorTool({db,tool:s.tool_id,capability,params:{limit:2,cursor:second.next_cursor}});assert.deepEqual(last.history.map(r=>r.version),['0.1.0']);assert.equal(last.next_cursor,null);
  const otherTool=await initial(db,{client:'other'});await assert.rejects(getCreatorTool({db,tool:otherTool.tool_id,capability,params:{cursor:first.next_cursor}}),e=>e.code==='invalid_cursor');
  for(const params of [{limit:21},{limit:0},{cursor:'a'.repeat(257)},{extra:'x'},{cursor:'bad'}])await assert.rejects(getCreatorTool({db,tool:s.tool_id,capability,params}),e=>e.status===400);
 }finally{db.close();}
});
test('HTTP/MCP update gates, shared rate and body limits keep proposal text private and inert',async()=>{
 const db=database(),app=createPlatform({db,origin}),request=(path,init={})=>app(new Request(origin+path,init),'http');try{
  const s=await initial(db),data=await body(),post=body=>({method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':capability},body:JSON.stringify(body)});
  const saved=await(await request('/v1/creator-tools/'+s.tool_id+'/updates',post(data))).json();assert.equal(saved.state,'pending');
  for(const path of ['/v1/creator-tools/'+s.tool_id,'/v1/tool-updates/'+saved.update_id]){assert.equal((await request(path)).status,403);assert.equal((await request(path+'?capability='+capability)).status,403);const response=await request(path,{headers:{'X-Creator-Capability':capability}});assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');}
  assert.equal((await request('/v1/tool-updates')).status,404);assert.equal((await request('/v1/creator-tools/'+s.tool_id+'/updates',post({...data,extra:'x'.repeat(17000)}))).status,413);
  const blocked=createPlatform({db,origin,feedbackLimit:async()=>false});assert.equal((await blocked(new Request(origin+'/v1/creator-tools/'+s.tool_id+'/updates',post(data)),'http')).status,429);
  const rpc=async(name,args)=>{const response=await request('/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});return (await response.json()).result;};
  assert.equal((await rpc('get_creator_tool',{tool_id:s.tool_id,creator_capability:capability})).structuredContent.current_version,'0.1.0');
  assert.equal((await rpc('submit_tool_update',{tool_id:s.tool_id,creator_capability:capability,...data})).structuredContent.update_id,saved.update_id);
  assert.equal((await rpc('get_tool_update',{update_id:saved.update_id,creator_capability:capability})).structuredContent.state,'pending');
  assert.equal((await rpc('get_tool_update',{update_id:saved.update_id,creator_capability:other})).isError,true);
  for(const path of ['/','/update-tool','/v1/products','/llms.txt','/openapi.json']){const response=await request(path),text=await response.text();assert(!text.includes(proposal.name));assert(!text.includes(capability));if(path==='/update-tool'){assert(text.includes('<title>AgentToolbox</title>'));assert(text.includes('data-update-fields hidden'));}}
  const schema=await(await request('/openapi.json')).json();assert(schema.paths['/v1/creator-tools/{tool_id}/updates']);
 }finally{db.close();}
});

test('0008 initializes only durable existing metadata approvals while preserving every legacy and financial row',()=>{
 const sqlite=new DatabaseSync(':memory:');try{
  sqlite.exec('PRAGMA foreign_keys=ON');for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')&&n<'0008').sort())sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  sqlite.prepare('INSERT INTO platform_creators VALUES(?,?,?)').run('local-creator','a'.repeat(64),date);
  sqlite.prepare("INSERT INTO platform_tool_submissions(submission_id,creator_id,tool_id,request_key_hash,request_hash,proposal_json,terms_json,terms_version,list_fee_atomic,discount_bps,charged_fee_atomic,paid_fee_atomic,share_bps,revenue_basis,created_at,client_hash) VALUES(?,?,?,?,?,?,?,?,?,10000,'0','0',9000,'gross',?,?)").run('local-initial','local-creator','creator-'+crypto.randomUUID(),'b'.repeat(64),'c'.repeat(64),JSON.stringify(proposal),JSON.stringify(CREATOR_TERMS),CREATOR_TERMS.terms_version,'500000',date,'d'.repeat(64));
  sqlite.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run('local-decision','local-initial','local-owner','e'.repeat(64),'f'.repeat(64),0,1,'approved','Local prior durable approval',date);
  const tables=['platform_creators','platform_tool_submissions','platform_submission_decisions','platform_creator_entitlements','platform_submission_refund_obligations','platform_payments','platform_payment_ledger','platform_paid_purchases','platform_feedback','platform_reviews','platform_review_replies','platform_live_receipts','platform_creator_allocations'];
  const snapshot=()=>tables.map(table=>({table,rows:sqlite.prepare('SELECT * FROM '+table).all()}));const before=snapshot();
  sqlite.exec(readFileSync(new URL('../migrations/0008_creator_updates.sql',import.meta.url),'utf8'));assert.deepEqual(snapshot(),before);
  const head=sqlite.prepare('SELECT * FROM platform_creator_tool_heads').get(),version=sqlite.prepare('SELECT * FROM platform_creator_tool_versions').get();assert.equal(head.current_version,'0.1.0');assert.equal(head.revision,0);assert.equal(version.source_submission_id,'local-initial');assert.equal(version.source_update_id,null);assert.equal(version.proposal_json,JSON.stringify(proposal));
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_proposals').get().n,0);assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_update_decisions').get().n,0);
 }finally{sqlite.close();}
});
