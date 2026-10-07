import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {database} from '../scripts/local-db.js';
import {submitTool,CREATOR_TERMS} from '../src/submissions.js';
import {submitToolUpdate} from '../src/tool-updates.js';
import {hash} from '../src/telemetry.js';
import {successContractPin} from '../src/contract-pins.js';
import {getCreatorEarnings} from '../src/creator-payouts.js';
import {recordCreatorInstallation,resolveCreatorInstallation,readCreatorInstallation,requiresCreatorBinding} from '../src/creator-installations.js';
const date='2026-10-07T10:00:00.000Z',capability='atbc_'+Buffer.alloc(32,37).toString('base64url');
const proposal={name:'Local installation fixture',summary:'Local test only',endpoint_url:'https://fixture.example/api',input_schema:{type:'object'},output_schema:{type:'object'}};
async function fixture(db){
 db.sqlite.exec('PRAGMA foreign_keys=ON');
 const s=await submitTool({db,body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal},capability,client:'installation-fixture',now:()=>new Date(date)});
 await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),s.submission_id,'local-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'approved','Local test',date).run();
 const product={id:s.tool_id,version:'0.1.0',outcome:{success_criterion:'Local fixture success'}};
 return {tool:s.tool_id,product,handler:{creatorAdapterId:'compiled-local-v1',creatorArtifactSha256:'a'.repeat(64),creatorContractSha256:(await successContractPin(product)).sha256}};
}
const install=(f,overrides={})=>({reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:f.tool,expectedRevision:0,action:'install',metadataRevision:0,metadataVersion:'0.1.0',adapterId:f.handler.creatorAdapterId,artifactSha256:f.handler.creatorArtifactSha256,successContractSha256:f.handler.creatorContractSha256,productVersion:f.product.version,...overrides});
const record=(db,d)=>recordCreatorInstallation({db,...d,now:()=>new Date(date)});
const denied=e=>e.code==='creator_adapter_unavailable';
test('installation fails closed, binds exact compiled artifacts and permits only strict owner audit requests',async()=>{
 const db=database();try{const f=await fixture(db),d=install(f);
 await assert.rejects(resolveCreatorInstallation({db,...f}),denied);
 await assert.rejects(record(db,{...d,url:'https://fixture.invalid'}),e=>e.code==='invalid_creator_installation');
 for(const artifactSha256 of ['A'.repeat(64),'abc','x'.repeat(64)])await assert.rejects(record(db,{...d,artifactSha256}),e=>e.code==='invalid_creator_installation');
 await assert.rejects(record(db,{...d,metadataRevision:1}),e=>e.code==='creator_installation_conflict');
 const r=await record(db,d),beneficiary=await resolveCreatorInstallation({db,...f});assert.equal(beneficiary.installation_id,r.installation_id);assert.equal(beneficiary.installation_revision,1);
 for(const field of ['creatorAdapterId','creatorArtifactSha256','creatorContractSha256'])await assert.rejects(resolveCreatorInstallation({db,product:f.product,handler:{...f.handler,[field]:'c'.repeat(64)}}),denied);
 for(const product of [{...f.product,version:'0.2.0'},{...f.product,outcome:{success_criterion:'Changed'}}])await assert.rejects(resolveCreatorInstallation({db,product,handler:f.handler}),denied);
 assert.throws(()=>db.sqlite.prepare('UPDATE platform_creator_entitlements SET installed_adapter=? WHERE tool_id=?').run('raw',f.tool),/installation_event_required/);
 assert.throws(()=>db.sqlite.exec("UPDATE platform_creator_installation_heads SET state='suspended'"),/installation_event_required/);
 assert.throws(()=>db.sqlite.exec("UPDATE platform_creator_installation_events SET adapter_id='raw'"),/append_only/);
 assert.throws(()=>db.sqlite.exec('DELETE FROM platform_creator_installation_events'),/append_only/);
 }finally{db.close();}
});
test('owner scoped idempotence, immutable replay and competing installation CAS',async()=>{
 const db=database();try{const f=await fixture(db),d=install(f),rs=await Promise.all([record(db,d),record(db,d)]);assert.equal(rs[0].installation_id,rs[1].installation_id);
 await assert.rejects(record(db,{...d,adapterId:'different'}),e=>e.code==='creator_installation_conflict');
 const races=await Promise.allSettled([record(db,install(f,{expectedRevision:1})),record(db,install(f,{expectedRevision:1,adapterId:'compiled-local-v2'}))]);assert.equal(races.filter(x=>x.status==='fulfilled').length,1);
 const h=await readCreatorInstallation({db,toolId:f.tool});assert.equal(h.installation_revision,2);
 const suspend={reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:f.tool,expectedRevision:2,action:'suspend'};
 await assert.rejects(record(db,{...suspend,artifactSha256:'a'.repeat(64)}),e=>e.code==='invalid_creator_installation');
 const s=await record(db,suspend);assert.equal(s.state,'suspended');assert.equal(s.previous_installation_id,h.installation_id);assert.equal(s.artifact_sha256,h.artifact_sha256);
 assert.deepEqual(await record(db,d),rs[0]);assert.deepEqual(await record(db,suspend),s);
 await assert.rejects(resolveCreatorInstallation({db,...f}),denied);assert.equal(db.sqlite.prepare('SELECT installed_adapter FROM platform_creator_entitlements').get().installed_adapter,null);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_tool_versions').get().n,1);
 }finally{db.close();}
});
test('metadata updates retain already reviewed execution; installation of old metadata is rejected',async()=>{
 const db=database();try{const f=await fixture(db);await record(db,install(f));
 const u=await submitToolUpdate({db,tool:f.tool,capability,client:'installation-update',body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,base_version:'0.1.0',expected_head_revision:0,proposed_version:'0.2.0',proposal}});
 await db.prepare('INSERT INTO platform_tool_update_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),u.update_id,'local-owner',await hash(crypto.randomUUID()),'c'.repeat(64),0,1,0,'approved','Local test',date).run();
 assert.equal((await resolveCreatorInstallation({db,...f})).installation_revision,1);
 await assert.rejects(record(db,install(f,{expectedRevision:1})),e=>e.code==='creator_installation_conflict');
 const next=await record(db,install(f,{expectedRevision:1,metadataRevision:1,metadataVersion:'0.2.0'}));assert.equal(next.revision,2);
 }finally{db.close();}
});
function payment(db,f,b,overrides={}){
 const p={operation_id:crypto.randomUUID(),product_id:f.product.id,version:f.product.version,key_hash:crypto.randomUUID(),fingerprint:'f',payment_digest:'p',network:'eip155:8453',asset:'USDC',payer:'payer',nonce:crypto.randomUUID(),amount_atomic:'10000',receiver:'receiver',state:'executing',created_at:date,updated_at:date,sample_kind:'synthetic',creator_tool_id:b?.tool_id??null,creator_id:b?.creator_id??null,creator_share_bps:b?.share_bps??null,creator_installation_id:b?.installation_id??null,creator_install_revision:b?.installation_revision??null,...overrides};
 db.sqlite.prepare(`INSERT INTO platform_payments (${Object.keys(p).join(',')}) VALUES (${Object.keys(p).map(()=>'?').join(',')})`).run(...Object.values(p));return p.operation_id;
}
test('payment admission freezes the active installation and old payments remain mutable only in settlement fields',async()=>{
 const db=database();try{const f=await fixture(db);await record(db,install(f));const b=await resolveCreatorInstallation({db,...f});
 assert.throws(()=>payment(db,f,null),/invalid_creator_installation/);
 assert.throws(()=>payment(db,f,b,{creator_install_revision:2}),/invalid_creator_installation/);
 assert.throws(()=>payment(db,f,b,{version:'wrong'}),/invalid_creator_installation/);
 const id=payment(db,f,b);assert.throws(()=>db.sqlite.prepare('UPDATE platform_payments SET creator_install_revision=2 WHERE operation_id=?').run(id),/immutable_creator_installation/);
 await record(db,{reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:f.tool,expectedRevision:1,action:'suspend'});
 assert.throws(()=>payment(db,f,b),/invalid_creator_installation|invalid_creator_beneficiary/);
 db.sqlite.prepare("UPDATE platform_payments SET state='failed',updated_at=? WHERE operation_id=?").run(date,id);
 assert.equal(db.sqlite.prepare('SELECT creator_installation_id,state FROM platform_payments WHERE operation_id=?').get(id).creator_installation_id,b.installation_id);
 }finally{db.close();}
});
test('creator binding detects seller providers and explicit inherited adapter markers',()=>{
 assert.equal(requiresCreatorBinding({id:'creator-any'},{}),true);
 for(const provider of ['bad',{}, {id:'seller',type:'first_party'},{id:'agenttoolbox',type:'creator'}])assert.equal(requiresCreatorBinding({id:'x',provider},{}),true);
 for(const handler of [{creatorAdapterId:undefined},{creatorAdapterId:null},Object.create({creatorAdapterId:'x'})])assert.equal(requiresCreatorBinding({id:'x'},handler),true);
 for(const provider of [undefined,null,{id:'agenttoolbox',type:'first_party',name:'AGI'}])assert.equal(requiresCreatorBinding({id:'x',provider},{}),false);
});

test('additive migration preserves unaudited legacy installs and historical null payment freezes',async()=>{

 let db;
 try{
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec('CREATE TABLE schema_migrations(name TEXT PRIMARY KEY)');
  for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>n.endsWith('.sql')&&n<'0013_creator_installations.sql').sort()){
   sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));sqlite.prepare('INSERT INTO schema_migrations VALUES(?)').run(name);
  }
  const legacy={sqlite,async batch(statements){sqlite.exec('BEGIN');try{const out=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}},prepare(sql){return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{sqlite.prepare(sql).run(...args);return {meta:{changes:1}};}};}};}};
  const f=await fixture(legacy);
  sqlite.prepare('UPDATE platform_creator_entitlements SET installed_adapter=? WHERE tool_id=?').run(f.handler.creatorAdapterId,f.tool);
  sqlite.prepare(`INSERT INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,creator_tool_id,creator_id,creator_share_bps) SELECT 'legacy-operation',tool_id,'0.1.0','legacy-key','fingerprint','digest','eip155:8453','USDC','payer','nonce','10000','receiver','executing',?,?,'synthetic',tool_id,creator_id,share_bps FROM platform_creator_entitlements WHERE tool_id=?`).run(date,date,f.tool);
  sqlite.prepare(`INSERT INTO platform_preparations(prepared_id,product_id,version,request_hash,request_key_hash,capability_hash,client_hash,input_hash,state,created_at,expires_at) VALUES('legacy-preparation',?,'0.1.0','request','key','capability','client','input','ready',?,?)`).run(f.tool,date,'2026-10-08T10:00:00.000Z');
  sqlite.prepare(`INSERT INTO platform_quotes(quote_id,product_id,version,input_hash,prepared_id,amount_atomic,minimum_policy,requirements_json,created_at,expires_at) VALUES('legacy-quote',?,'0.1.0','input','legacy-preparation','10000','fixture','{}',?,?)`).run(f.tool,date,'2026-10-08T10:00:00.000Z');
  sqlite.exec(readFileSync(new URL('../migrations/0013_creator_installations.sql',import.meta.url),'utf8'));db={...legacy,close:()=>sqlite.close()};
  assert.equal(db.sqlite.prepare('SELECT installed_adapter FROM platform_creator_entitlements').get().installed_adapter,f.handler.creatorAdapterId);
  assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_installation_events').get().n,0);
  await assert.rejects(resolveCreatorInstallation({db,...f}),denied);
  assert.equal((await getCreatorEarnings({db,tool:f.tool,capability})).execution_status,'metadata_only_not_earning');
  for(const table of ['platform_preparations','platform_quotes']){const row=db.sqlite.prepare('SELECT * FROM '+table).get();assert.equal(row.creator_installation_id,null);assert.equal(row.creator_install_revision,null);}
  const historical=db.sqlite.prepare('SELECT * FROM platform_payments').get();assert.equal(historical.creator_installation_id,null);assert.equal(historical.creator_install_revision,null);
  db.sqlite.prepare("UPDATE platform_payments SET state='failed' WHERE operation_id='legacy-operation'").run();
  assert.equal(db.sqlite.prepare('SELECT state FROM platform_payments').get().state,'failed');
 }finally{db?.close();}
});
function insertObject(db,table,row){db.sqlite.prepare(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));}
function preparation(db,f,b,overrides={}){
 const row={prepared_id:crypto.randomUUID(),product_id:f.product.id,version:f.product.version,request_hash:'request',request_key_hash:crypto.randomUUID(),capability_hash:'capability',client_hash:'client',input_hash:'input',state:'ready',created_at:date,expires_at:'2026-10-08T10:00:00.000Z',creator_installation_id:b?.installation_id??null,creator_install_revision:b?.installation_revision??null,...overrides};insertObject(db,'platform_preparations',row);return row.prepared_id;
}
function quote(db,f,b,overrides={}){
 const row={quote_id:crypto.randomUUID(),product_id:f.product.id,version:f.product.version,input_hash:'input',amount_atomic:'10000',minimum_policy:'fixture',requirements_json:'{}',created_at:date,expires_at:'2026-10-08T10:00:00.000Z',creator_installation_id:b?.installation_id??null,creator_install_revision:b?.installation_revision??null,...overrides};insertObject(db,'platform_quotes',row);return row.quote_id;
}
test('quote and preparation admission freeze exact active installation; reinstall cannot reuse old freezes',async()=>{
 const db=database();try{const f=await fixture(db);await record(db,install(f));const old=await resolveCreatorInstallation({db,...f});
 for(const create of [preparation,quote]){
  assert.throws(()=>create(db,f,null),/invalid_creator_installation/);
  assert.throws(()=>create(db,f,old,{creator_install_revision:null}),/invalid_creator_installation/);
  assert.throws(()=>create(db,f,old,{version:'wrong'}),/invalid_creator_installation/);
 }
 const preparedId=preparation(db,f,old),quoteId=quote(db,f,old,{prepared_id:preparedId});
 assert.throws(()=>db.sqlite.prepare('UPDATE platform_preparations SET creator_install_revision=3 WHERE prepared_id=?').run(preparedId),/immutable_creator_installation/);
 assert.throws(()=>db.sqlite.prepare('UPDATE platform_quotes SET creator_installation_id=NULL WHERE quote_id=?').run(quoteId),/immutable_creator_installation/);
 await record(db,{reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:f.tool,expectedRevision:1,action:'suspend'});
 for(const create of [preparation,quote])assert.throws(()=>create(db,f,old),/invalid_creator_installation/);
 await record(db,install(f,{expectedRevision:2}));const current=await resolveCreatorInstallation({db,...f});assert.equal(current.installation_revision,3);
 for(const create of [preparation,quote])assert.throws(()=>create(db,f,old),/invalid_creator_installation/);
 assert.throws(()=>quote(db,f,current,{prepared_id:preparedId}),/invalid_creator_installation/);
 assert.throws(()=>payment(db,f,current,{quote_id:quoteId,prepared_id:preparedId,minimum_policy:'fixture',requirements_json:'{}'}),/invalid_creator_installation/);
 assert.throws(()=>payment(db,f,current,{prepared_id:preparedId}),/invalid_creator_installation/);
 assert.throws(()=>payment(db,f,current,{quote_id:quoteId,minimum_policy:'fixture',requirements_json:'{}'}),/invalid_creator_installation/);
 const freshPreparation=preparation(db,f,current),freshQuote=quote(db,f,current,{prepared_id:freshPreparation});
 const id=payment(db,f,current,{quote_id:freshQuote,prepared_id:freshPreparation,minimum_policy:'fixture',requirements_json:'{}'});
 assert.equal(db.sqlite.prepare('SELECT operation_id FROM platform_quotes WHERE quote_id=?').get(freshQuote).operation_id,id);
 assert.equal(db.sqlite.prepare('SELECT state FROM platform_preparations WHERE prepared_id=?').get(freshPreparation).state,'claimed');
 const builtin={product:{id:'docs-pack',version:'0.1.0'}};
 const builtPreparation=preparation(db,builtin,null);quote(db,builtin,null,{prepared_id:builtPreparation});payment(db,builtin,null);
 assert.throws(()=>preparation(db,builtin,current),/invalid_creator_installation/);
 assert.throws(()=>quote(db,builtin,current),/invalid_creator_installation/);
 }finally{db.close();}
});
