import {recordCreatorInstallation,readCreatorInstallation} from '../src/creator-installations.js';
import {successContractPin} from '../src/contract-pins.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {database} from '../scripts/local-db.js';
import {createPlatform} from '../src/app.js';
import {CREATOR_TERMS,submitTool,getSubmission,creatorAccrual,creatorBeneficiary} from '../src/submissions.js';
import {hash} from '../src/telemetry.js';
import {submitToolUpdate,getCreatorTool} from '../src/tool-updates.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC,MAX_UINT256} from '../src/payment-config.js';
import {paidInvocation,quotedPayment} from '../src/x402.js';
import {encodePaymentSignatureHeader} from '@x402/core/http';
import {creatorFinancialFacts} from '../src/creator-accounting.js';
const capability='atbc_'+Buffer.alloc(32,7).toString('base64url'),otherCapability='atbc_'+Buffer.alloc(32,8).toString('base64url'),origin='https://example.invalid';
const date='2026-10-07T08:00:00.000Z';
const proposal={name:'LOCAL TEST <script>alert(1)</script>',summary:'Private fixture, never a public tool',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}};
async function body(extra={}){return {request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal,...extra};}
const submit=(db,data,secret=capability,client='fixture')=>submitTool({db,body:data,capability:secret,client,now:()=>new Date(date)});
async function decision(db,submission,{state='approved',revision=0,key=crypto.randomUUID(),actor='fixture-owner',reason='Local test decision'}={}){
 const request={submission_id:submission.submission_id,decision:state,expected_revision:revision,reason};
 return db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),submission.submission_id,actor,await hash(key),await hash(JSON.stringify(request)),revision,revision+1,state,reason,date).run();
}
test('capability binds private creator/request idempotency; concurrent replay saves one inert proposal and hash only',async()=>{
 const db=database();try{
  const data=await body(),results=await Promise.all([submit(db,data),submit(db,data)]);assert.equal(results[0].submission_id,results[1].submission_id);
  assert.equal(results[0].state,'pending');assert.equal(results[0].terms.paid_fee_atomic,'0');assert.equal(results[0].refund_due_atomic,null);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_submissions').get().n,1);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_entitlements').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_payments').get().n,0);
  const stored=JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_tool_submissions').all())+JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_creators').all());assert(!stored.includes(capability));
  assert(!JSON.stringify(results).includes(data.creator_secret_hash));assert(!JSON.stringify(results).includes('creator_id'));
  await assert.rejects(submit(db,{...data,proposal:{...proposal,name:'Changed'}}),e=>e.code==='submission_conflict');
  // A different capability scopes the same request ID to a distinct creator, not another creator's replay.
  const another=await submit(db,{...data,creator_secret_hash:await hash(otherCapability)},otherCapability);assert.notEqual(another.submission_id,results[0].submission_id);
  await assert.rejects(getSubmission({db,id:results[0].submission_id,capability:otherCapability}),e=>e.status===403);
  await assert.rejects(getSubmission({db,id:crypto.randomUUID(),capability:otherCapability}),e=>e.code==='creator_capability_invalid');
  assert.equal((await getSubmission({db,id:results[0].submission_id,capability})).proposal.name,proposal.name);
 }finally{db.close();}
});
test('forged decisions, money terms, malformed commitments, local URLs and secrets fail without records or fetches',async()=>{
 const db=database();try{
  const data=await body();
  for(const extra of [{state:'approved'},{paid_fee_atomic:'500000'},{terms_version:'invented'},{creator_secret_hash:'bad'}])await assert.rejects(submit(db,{...data,...extra}),e=>e.status===400);
  await assert.rejects(submit(db,data,otherCapability),e=>e.status===403);
  await assert.rejects(submit(db,{...data,proposal:{...proposal,summary:capability}}),e=>e.code==='capability_in_proposal');
  for(const url of ['http://tool.example','https://127.0.0.1/api','https://[::1]/','https://localhost/','https://host.internal/','https://user:secret@tool.example/','https://tool.example:8443/','https://tool.example/?secret=a','https://tool.example/#a'])await assert.rejects(submit(db,{...data,proposal:{...proposal,endpoint_url:url}}),e=>e.status===400);
  await assert.rejects(submit(db,{...data,proposal:{...proposal,input_schema:{description:'x'.repeat(4001)}}}),e=>e.status===400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creators').get().n,0);
  const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Submission must never fetch URLs');};try{await submit(db,data);}finally{globalThis.fetch=originalFetch;}
 }finally{db.close();}
});
test('client/global atomic budgets have no orphan creators and replay remains possible after exhaustion',async()=>{
 const db=database();try{
  const first=await body();await submit(db,first);for(let i=0;i<3;i++)await submit(db,await body());
  await assert.rejects(submit(db,await body({creator_secret_hash:await hash(otherCapability)}),otherCapability),e=>e.status===429);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creators').get().n,1);assert.equal((await submit(db,first)).state,'pending');
  for(let i=4;i<40;i++)await submit(db,await body(),capability,'client-'+i);
  await assert.rejects(submit(db,await body({creator_secret_hash:await hash(otherCapability)}),otherCapability,'new-client'),e=>e.status===429);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_submissions').get().n,40);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creators').get().n,1);
 }finally{db.close();}
});
test('owner decisions atomically freeze stable entitlement or exact zero refund, with revision CAS and immutable audit',async()=>{
 const db=database();try{
  const submitted=await submit(db,await body());await assert.rejects(decision(db,submitted,{revision:1}),/submission_revision_conflict/);
  const decisions=await Promise.allSettled([decision(db,submitted),decision(db,submitted,{state:'rejected'})]);assert.equal(decisions.filter(r=>r.status==='fulfilled').length,1);
  const raced=db.sqlite.prepare('SELECT * FROM platform_tool_submissions WHERE submission_id=?').get(submitted.submission_id);assert(['approved','rejected'].includes(raced.state));assert.equal(raced.revision,1);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_submission_decisions').get().n,1);
  const accepted=await submit(db,await body());await decision(db,accepted);
  const row=db.sqlite.prepare('SELECT * FROM platform_tool_submissions WHERE submission_id=?').get(accepted.submission_id),entitlement=db.sqlite.prepare('SELECT * FROM platform_creator_entitlements WHERE submission_id=?').get(accepted.submission_id);
  assert.equal(row.state,'approved');assert.equal(row.revision,1);assert.equal(entitlement.tool_id,row.tool_id);assert.equal(entitlement.share_bps,9000);assert.equal(entitlement.installed_adapter,null);
  await assert.rejects(decision(db,accepted,{state:'rejected'}));
  for(const query of ["UPDATE platform_tool_submissions SET state='rejected'","UPDATE platform_tool_submissions SET paid_fee_atomic='500000'","UPDATE platform_creator_entitlements SET creator_id='spoof'","UPDATE platform_submission_decisions SET reason='Changed'","DELETE FROM platform_submission_decisions"])assert.throws(()=>db.sqlite.exec(query));
  const rejected=await submit(db,await body());await decision(db,rejected,{state:'rejected'});const refund=db.sqlite.prepare('SELECT * FROM platform_submission_refund_obligations WHERE submission_id=?').get(rejected.submission_id);assert.equal(refund.refund_due_atomic,'0');assert.equal(refund.paid_fee_atomic,'0');assert.equal(refund.status,'no_fee_paid');
  const status=await getSubmission({db,id:rejected.submission_id,capability});assert.equal(status.refund_due_atomic,'0');assert.equal(status.decision.decision,'rejected');assert(!JSON.stringify(status).includes('fixture-owner'));
 }finally{db.close();}
});
test('decision-side persistence failure rolls back approval and audit together',async()=>{
 const db=database();try{
  const submitted=await submit(db,await body());db.sqlite.exec("CREATE TRIGGER fixture_fail_entitlement BEFORE INSERT ON platform_creator_entitlements BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END;");
  await assert.rejects(decision(db,submitted),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT state FROM platform_tool_submissions').get().state,'pending');assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_submission_decisions').get().n,0);
 }finally{db.close();}
});
test('HTTP privacy, bounds, shared write rate, title, safe forms and discovery work without public proposal leakage',async()=>{
 const db=database(),app=createPlatform({db,origin}),request=(path,init={})=>app(new Request(origin+path,init),'fixture');try{
  const data=await body(),post=body=>({method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':capability},body:JSON.stringify(body)});
  const saved=await(await request('/v1/tool-submissions',post(data))).json();assert.equal(saved.state,'pending');
  assert.equal((await request('/v1/tool-submissions/'+saved.submission_id)).status,403);
  assert.equal((await request('/v1/tool-submissions/'+saved.submission_id+'?capability='+capability)).status,403);
  assert.equal((await request('/v1/tool-submissions/'+saved.submission_id,{headers:{'X-Creator-Capability':capability}})).status,200);
  assert.equal((await request('/v1/tool-submissions')).status,404);
  assert.equal((await request('/v1/tool-submissions',post({...data,extra:'x'.repeat(17000)}))).status,413);
  const blocked=createPlatform({db,origin,feedbackLimit:async()=>false});assert.equal((await blocked(new Request(origin+'/v1/tool-submissions',post(await body())),'fixture')).status,429);
  for(const path of ['/submit-tool','/products/docs-pack/preview','/products/contract-cases/preview']){const html=await(await request(path)).text();assert(html.includes('<title>AgentToolbox</title>'));assert(!html.includes(proposal.name));assert(html.includes('hidden'));}
  const catalog=await(await request('/v1/products')).json();assert(!JSON.stringify(catalog).includes(proposal.name));assert(catalog.products.find(p=>p.id==='docs-pack').preview.page);
  const criteria=await(await request('/v1/products/contract-cases/criteria')).json();assert.equal(criteria.criteria.criteria_version,'1');assert.equal(criteria.limits.cases,24);
  const schema=await(await request('/openapi.json')).json();assert(schema.paths['/v1/tool-submissions']);assert(schema.paths['/v1/products/{id}/criteria']);assert(!JSON.stringify(schema).includes(capability));
  assert.equal((await request('/v1/creator-terms')).headers.get('Cache-Control'),'no-store');
 }finally{db.close();}
});
test('MCP terms/submit/private status share HTTP capability, schema and rate protections',async()=>{
 const db=database(),app=createPlatform({db,origin}),rpc=async(name,args={})=>{
  const response=await app(new Request(origin+'/mcp',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),'fixture');return (await response.json()).result;
 };try{
  assert.equal((await rpc('get_creator_terms')).structuredContent.terms.charged_fee_atomic,'0');
  const data=await body(),saved=await rpc('submit_tool',{...data,creator_capability:capability});assert.equal(saved.isError,undefined);const id=saved.structuredContent.submission_id;
  assert.equal((await rpc('get_tool_submission',{submission_id:id,creator_capability:capability})).structuredContent.state,'pending');
  assert.equal((await rpc('get_tool_submission',{submission_id:id,creator_capability:otherCapability})).isError,true);
  assert.equal((await rpc('submit_tool',{...data,state:'approved',creator_capability:capability})).isError,true);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_submissions').get().n,1);
 }finally{db.close();}
});

async function paidFixture({live=true}={}){
 const db=database(),submitted=await submit(db,await body());await decision(db,submitted);
 const product={id:submitted.tool_id,version:'0.1.0',status:'validation',pricing:{payments_enabled:true,minimum_amount_atomic:'10000'}},payTo='0x'+'1'.repeat(40),payer='0x'+'2'.repeat(40),transaction='0x'+'c'.repeat(64);
 const config={enabled:true,live,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo},counts={verify:0,settle:0,run:0};
 const handler={creatorAdapterId:'local-fixture-only',creatorArtifactSha256:'a'.repeat(64),input:z.strictObject({n:z.number().int()}),output:z.strictObject({n:z.number().int()}),run:async input=>{counts.run++;return input;},success:output=>output.n>=0};
 const run=async({n=1,amount='10001',version='0.1.0',key=crypto.randomUUID(),nonce=crypto.randomUUID().replaceAll('-',''),unknown=false,bodyExtra={},beforeSettle}={})=>{
  const p={...product,version},url=origin+'/v1/products/'+product.id+'/invoke',terms=paymentRequirements(p,config,amount);
  const quote=await quotedPayment({db,request:new Request(url),body:{version,input:{n},payment_amount_atomic:amount},product:p,handler,config,origin});
  const now=Math.floor(Date.now()/1000),payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'00'.repeat(65),authorization:{from:payer,to:payTo,value:amount,nonce:'0x'+nonce.padEnd(64,'a'),validAfter:String(now-1),validBefore:String(now+300)}}};
  const body={version,input:{n},payment_amount_atomic:amount,max_charge_usdc_atomic:amount,quote_id:quote.quote_id,...bodyExtra};
  const request=new Request(url,{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'X-AgentToolbox-Sample':'synthetic'}});
  const invoke=()=>paidInvocation({db,request,body,key,product:p,handler,config,origin,adapterFactory:async()=>({requirements:terms,verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;if(beforeSettle)await beforeSettle();if(unknown)throw new Error('local unknown');return {success:true,network:BASE_NETWORK,transaction,payer,amount};}})});
  return {invoke,body,request,key,terms};
 };
 const install=async(version='0.1.0',adapterId=handler.creatorAdapterId)=>{
  const head=await readCreatorInstallation({db,toolId:product.id}),metadata=db.sqlite.prepare('SELECT * FROM platform_creator_tool_heads WHERE tool_id=?').get(product.id);
  handler.creatorAdapterId=adapterId;handler.creatorContractSha256=(await successContractPin({...product,version})).sha256;
  return recordCreatorInstallation({db,reviewer:'fixture-owner',requestId:crypto.randomUUID(),toolId:product.id,expectedRevision:head?.installation_revision??0,action:'install',metadataRevision:metadata.revision,metadataVersion:metadata.current_version,adapterId,artifactSha256:handler.creatorArtifactSha256,successContractSha256:handler.creatorContractSha256,productVersion:version});
 };
 const suspend=async()=>{const head=await readCreatorInstallation({db,toolId:product.id});return recordCreatorInstallation({db,reviewer:'fixture-owner',requestId:crypto.randomUUID(),toolId:product.id,expectedRevision:head.installation_revision,action:'suspend'});};
 return {db,submitted,product,handler,config,counts,run,install,suspend};
}
test('approval is non-executable; only reviewed server adapter freezes beneficiary, full chosen gross ignores sample header and carries atoms',async()=>{
 const s=await paidFixture();try{
  await assert.rejects(creatorBeneficiary(s.db,s.product,s.handler),e=>e.code==='creator_adapter_unavailable');await assert.rejects(creatorBeneficiary(s.db,s.product,{}),e=>e.code==='creator_adapter_unavailable');
  await s.install();const a=await s.run(),result=await(await a.invoke()).json();assert.equal(result.payment.amount_settled_atomic,'10001');await a.invoke();
  await s.install('0.2.0');const b=await s.run({version:'0.2.0'});await b.invoke();assert.equal(s.counts.settle,2);
  const rows=s.db.sqlite.prepare('SELECT * FROM platform_creator_allocations').all(),total=creatorAccrual(rows);assert.equal(total.gross_atomic,'20002');assert.equal(total.accrued_atomic,'18001');assert.equal(total.fractional_atom_numerator,'8');assert.equal(rows.length,2);assert.equal(rows[0].tool_id,rows[1].tool_id);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_paid_purchases').get().n,0);assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_live_receipts').get().n,2);
  const receipts=s.db.sqlite.prepare('SELECT * FROM platform_live_receipts').all(),facts=creatorFinancialFacts(receipts,rows);assert.equal(facts.creator_accruals[0].accrued_atomic,'18001');assert.equal(facts.gross_totals.map(r=>r.gross_atomic).join(','),'10001,10001');assert.throws(()=>creatorFinancialFacts(receipts,rows.slice(0,1)),/Missing creator allocation/);
  assert.throws(()=>s.db.sqlite.exec("UPDATE platform_payments SET creator_id='spoof'"),/immutable_creator_beneficiary/);assert.throws(()=>s.db.sqlite.exec('DELETE FROM platform_creator_allocations'),/append_only/);
  assert.throws(()=>creatorAccrual([...rows,rows[0]]));assert.throws(()=>creatorAccrual([rows[0],{...rows[1],tool_id:'other'}]));
  const huge=creatorAccrual([{...rows[0],gross_atomic:MAX_UINT256},{...rows[1],gross_atomic:MAX_UINT256}]);assert.equal(huge.accrued_atomic,(BigInt(MAX_UINT256)*18n/10n).toString());
 }finally{s.db.close();}
});
test('failed/unknown/non-live operations never accrue; forged client beneficiaries cannot settle; server freeze survives adapter removal',async()=>{
 const s=await paidFixture();try{
  await s.install();const failed=await s.run({n:-1});await assert.rejects(failed.invoke(),e=>e.code==='outcome_not_met');assert.equal(s.counts.settle,0);
  const forged=await s.run({bodyExtra:{creator_id:'spoof'}});await assert.rejects(forged.invoke(),e=>e.code==='invalid_input');assert.equal(s.counts.settle,0);
  const unknown=await s.run({unknown:true});await assert.rejects(unknown.invoke(),e=>e.code==='settlement_unresolved');await assert.rejects(unknown.invoke(),e=>e.code==='settlement_unresolved');assert.equal(s.counts.settle,1);
  assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_live_receipts').get().n,0);
  const frozen=await s.run({beforeSettle:s.suspend});await frozen.invoke();assert.equal(s.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_allocations').get().n,1);
 }finally{s.db.close();}
 const mock=await paidFixture({live:false});try{await mock.install();await(await mock.run()).invoke();assert.equal(mock.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_live_receipts').get().n,0);}finally{mock.db.close();}
});

test('metadata approval leaves outstanding installed quotes unchanged; separate adapter change fails before settlement and replay stays frozen',async()=>{
 const s=await paidFixture();try{
  await s.install();const outstanding=await s.run();
  const p=await submitToolUpdate({db:s.db,tool:s.product.id,body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,base_version:'0.1.0',expected_head_revision:0,proposed_version:'0.2.0',proposal:{...proposal,name:'LOCAL new metadata'}},capability,client:'updates'});
  await s.db.prepare('INSERT INTO platform_tool_update_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),p.update_id,'fixture-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,0,'approved','Local test',date).run();
  assert.equal((await getCreatorTool({db:s.db,tool:s.product.id,capability})).current_version,'0.2.0');assert.equal(s.product.version,'0.1.0');assert.equal(s.handler.creatorAdapterId,'local-fixture-only');
  const result=await(await outstanding.invoke()).json();assert.equal(result.version,'0.1.0');assert.equal(s.counts.settle,1);
  const unused=await s.run();await s.install('0.1.0','separately-reviewed-new-revision');const changed={...s.handler};
  let adapterCalls=0;await assert.rejects(paidInvocation({db:s.db,request:unused.request,body:unused.body,key:unused.key,product:s.product,handler:changed,config:s.config,origin,adapterFactory:async()=>{adapterCalls++;throw new Error('Must fail before payment adapter');}}),e=>e.code==='quote_terms_changed');assert.equal(adapterCalls,0);assert.equal(s.counts.settle,1);
  const replay=await paidInvocation({db:s.db,request:outstanding.request,body:outstanding.body,key:outstanding.key,product:{...s.product,version:'0.9.0'},handler:changed,config:s.config,origin,adapterFactory:async()=>{throw new Error('Replay must not verify or settle');}});assert.deepEqual(await replay.json(),result);
  const saved=s.db.sqlite.prepare('SELECT * FROM platform_payments WHERE operation_id=?').get(result.operation_id);assert.equal(saved.version,'0.1.0');assert(saved.minimum_policy.includes(':adapter:local-fixture-only:artifact:'));assert.equal(saved.creator_tool_id,s.product.id);assert.equal(saved.creator_share_bps,9000);
 }finally{s.db.close();}
});
