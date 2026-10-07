import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {encodePaymentSignatureHeader} from '@x402/core/http';
import {database} from '../scripts/local-db.js';
import {REFERRAL_TERMS,REFERRAL_PRODUCT_IDS,referralTerms,referralCodeSchema,registerReferral,getReferral,referralBeneficiary,referralAccrual} from '../src/referrals.js';
import {BASE_NETWORK,BASE_USDC,MAX_UINT256,paymentRequirements} from '../src/payment-config.js';
import {paidInvocation} from '../src/x402.js';
import {createPlatform} from '../src/app.js';
const date='2026-10-07T12:00:00.000Z',capability='atbf_'+Buffer.alloc(32,7).toString('base64url');
const provider={id:'agenttoolbox',type:'first_party'},product={id:'docs-pack',provider},handler={};
const register=(db,secret=capability,client='fixture',body={terms_version:REFERRAL_TERMS.terms_version})=>registerReferral({db,body,capability:secret,client,now:()=>new Date(date)});
const count=(db,table)=>db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n;
function payment(db,code,extra={}){
 const id=crypto.randomUUID(),row={operation_id:id,product_id:'docs-pack',version:'0.1.0',key_hash:id,fingerprint:'fixture',payment_digest:id,network:BASE_NETWORK,asset:BASE_USDC.toLowerCase(),payer:'0x'+'2'.repeat(40),nonce:id,amount_atomic:'10001',receiver:'0x'+'1'.repeat(40),state:'settling',created_at:date,updated_at:date,sample_kind:'unclassified',is_live:1,referral_code:code,referral_terms_version:REFERRAL_TERMS.terms_version,referral_share_bps:100,...extra};
 const columns=Object.keys(row);db.sqlite.prepare('INSERT INTO platform_payments('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));return id;
}
function settle(db,id,{outcome=true,receipt=true,amount}={}){
 const p=db.sqlite.prepare('SELECT * FROM platform_payments WHERE operation_id=?').get(id);
 const event=(name,value='0',tx=null)=>db.sqlite.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),id,p.product_id,p.version,name,p.network,p.asset,value,tx,p.sample_kind,date);
 if(outcome)event('outcome_validated');if(receipt)event('settlement_reported',amount??p.amount_atomic,'0x'+'a'.repeat(64));
 db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(id);
}
function creatorEntitlement(db,toolId){
 const creator=crypto.randomUUID(),submission=crypto.randomUUID();
 db.sqlite.prepare('INSERT INTO platform_creators VALUES(?,?,?)').run(creator,'b'.repeat(64),date);
 db.sqlite.prepare(`INSERT INTO platform_tool_submissions(submission_id,creator_id,tool_id,request_key_hash,request_hash,proposal_json,terms_json,terms_version,list_fee_atomic,discount_bps,charged_fee_atomic,paid_fee_atomic,share_bps,revenue_basis,created_at,client_hash) VALUES(?,?,?,?,?,?,?,'creator-promo-2026-10-07.v1','500000',10000,'0','0',9000,'gross',?,?)`).run(submission,creator,toolId,'c'.repeat(64),'d'.repeat(64),'{}','{}',date,'fixture');
 db.sqlite.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').run(crypto.randomUUID(),submission,'fixture-owner','e'.repeat(64),'f'.repeat(64),0,1,'approved','Test only',date);
 return {tool_id:toolId,creator_id:creator,share_bps:9000};
}

test('registration is capability-scoped, concurrent replay safe, hash-only and no payment or wallet effect',async()=>{
 const db=database();try{
  assert(db.sqlite.prepare("SELECT name FROM schema_migrations WHERE name='0010_referrals.sql'").get());
  const [a,b]=await Promise.all([register(db),register(db)]);assert.equal(a.referral_code,b.referral_code);assert(referralCodeSchema.safeParse(a.referral_code).success);assert.equal(count(db,'platform_referrers'),1);
  assert.equal(a.terms.share_bps,100);assert.equal(a.terms.creator_tools_eligible,false);assert.equal(a.transfers_enabled,false);
  const stored=JSON.stringify(db.sqlite.prepare('SELECT * FROM platform_referrers').all());assert(!stored.includes(capability));assert(!JSON.stringify(a).includes('capability_hash'));assert.equal(count(db,'platform_payments'),0);
  assert.equal((await getReferral({db,capability})).accrual.accrued_atomic,'0');
  for(const secret of [a.referral_code,undefined,'atbf_'+Buffer.alloc(32,9).toString('base64url')])await assert.rejects(getReferral({db,capability:secret}),e=>e.status===403&&e.code==='referral_capability_invalid');
  for(const body of [{terms_version:'invented'},{terms_version:REFERRAL_TERMS.terms_version,share_bps:200},{terms_version:REFERRAL_TERMS.terms_version,wallet:'0x'+'1'.repeat(40)}])await assert.rejects(register(db,capability,'fixture',body),e=>e.status===400);
  assert.equal(referralTerms().status_path,'/v1/referrals/me');
 }finally{db.close();}
});

test('atomic enrollment budgets bound new records while original-capability replay remains available',async()=>{
 const db=database();try{
  const original=await register(db);for(let i=1;i<4;i++)await register(db,'atbf_'+Buffer.alloc(32,i).toString('base64url'));
  await assert.rejects(register(db,'atbf_'+Buffer.alloc(32,5).toString('base64url')),e=>e.status===429);assert.equal((await register(db)).referral_code,original.referral_code);
  for(let i=4;i<40;i++)await register(db,'atbf_'+Buffer.alloc(32,i+20).toString('base64url'),'client-'+i);
  await assert.rejects(register(db,'atbf_'+Buffer.alloc(32,90).toString('base64url'),'new-client'),e=>e.status===429);assert.equal(count(db,'platform_referrers'),40);
 }finally{db.close();}
});

test('attribution requires exact first-party provider and allowlist, excludes creator fields/adapters/entitlements',async()=>{
 const db=database();try{
  assert.deepEqual(await referralBeneficiary({db:{prepare(){throw new Error('unexpected read');}}}),{referral_code:null,referral_terms_version:null,referral_share_bps:null});
  const registered=await register(db),args={db,code:registered.referral_code,product,handler};
  for(const id of REFERRAL_PRODUCT_IDS)assert.equal((await referralBeneficiary({...args,product:{...product,id}})).referral_share_bps,100);
  for(const override of [{product:{...product,id:'creator-tool'}},{product:{...product,provider:{id:'agenttoolbox',type:'third_party'}}},{product:{...product,provider:{id:'other',type:'first_party'}}},{handler:{creatorAdapterId:'installed'}},{creator:{creator_id:'creator'}},{creator:{tool_id:'docs-pack'}},{creator:{share_bps:9000}}])await assert.rejects(referralBeneficiary({...args,...override}),e=>e.code==='referral_product_ineligible');
  await assert.rejects(referralBeneficiary({...args,code:'ref_'+crypto.randomUUID()}),e=>e.code==='unknown_referral_code');
  await assert.rejects(referralBeneficiary({...args,code:capability}),e=>e.code==='invalid_referral_code');
  creatorEntitlement(db,'docs-pack');await assert.rejects(referralBeneficiary(args),e=>e.code==='referral_product_ineligible');
  assert.throws(()=>payment(db,registered.referral_code),/invalid_referral_beneficiary/);
 }finally{db.close();}
});

test('actual SQL receipt transition accrues exactly once including synthetic-marked live money and later versions',async()=>{
 const db=database();try{
  const {referral_code:code}=await register(db),first=payment(db,code,{sample_kind:'synthetic'});settle(db,first);
  db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(first);
  const second=payment(db,code,{product_id:'quote-proof',version:'0.2.0'});settle(db,second);
  assert.equal(count(db,'platform_referral_allocations'),2);assert.equal(count(db,'platform_live_receipts'),2);
  const status=await getReferral({db,capability});assert.equal(status.accrual.gross_atomic,'20002');assert.equal(status.accrual.accrued_atomic,'200');assert.equal(status.accrual.fractional_atom_numerator,'200');assert.equal(status.accrual.fractional_atom_denominator,'10000');assert.equal(status.accrual.paid_atomic,null);assert.equal(status.accrual.unpaid_atomic,null);assert(!JSON.stringify(status).includes('payer'));
  db.sqlite.prepare("UPDATE platform_payments SET outcome='failure' WHERE operation_id=?").run(first);assert.equal((await getReferral({db,capability})).accrual.accrued_atomic,'200');
 }finally{db.close();}
});

test('unconfirmed, failed and nonlive operations do not accrue; incomplete evidence aborts settled transition',async()=>{
 const db=database();try{
  const {referral_code:code}=await register(db);
  for(const state of ['executing','failed','unknown','outcome_ready','settling'])payment(db,code,{state});
  const mock=payment(db,code,{is_live:0});settle(db,mock);assert.equal(count(db,'platform_referral_allocations'),0);
  for(const options of [{outcome:false},{receipt:false},{amount:'9999'}]){const id=payment(db,code);assert.throws(()=>settle(db,id,options),/referral_receipt_missing/);assert.equal(db.sqlite.prepare('SELECT state FROM platform_payments WHERE operation_id=?').get(id).state,'settling');}
  assert.equal(count(db,'platform_referral_allocations'),0);
 }finally{db.close();}
});

test('allocation persistence failure rolls back receipt and settled state instead of losing the obligation',async()=>{
 const db=database();try{
  const {referral_code:code}=await register(db),id=payment(db,code);
  db.sqlite.exec("CREATE TRIGGER fixture_referral_failure BEFORE INSERT ON platform_referral_allocations BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END;");
  assert.throws(()=>settle(db,id),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT state FROM platform_payments WHERE operation_id=?').get(id).state,'settling');assert.equal(count(db,'platform_live_receipts'),0);assert.equal(count(db,'platform_referral_allocations'),0);
  db.sqlite.exec('DROP TRIGGER fixture_referral_failure');
  // Operator reconciliation using the already durable receipt, not a new charge.
  db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(id);assert.equal(count(db,'platform_referral_allocations'),1);
 }finally{db.close();}
});

test('SQL freezes attribution and prevents fabricated allocations, forged rates and creator-owned products',async()=>{
 const db=database();try{
  const {referral_code:code}=await register(db);
  for(const extra of [{referral_code:'ref_'+crypto.randomUUID()},{referral_share_bps:200},{referral_terms_version:null},{referral_code:null},{product_id:'creator-fixture'},{creator_id:'forged'}])assert.throws(()=>payment(db,code,extra),/invalid_referral_beneficiary/);
  const id=payment(db,code);settle(db,id);
  for(const sql of ["UPDATE platform_referrers SET share_bps=200","DELETE FROM platform_referrers","UPDATE platform_payments SET referral_code=NULL","UPDATE platform_payments SET amount_atomic='100000000'","UPDATE platform_referral_allocations SET gross_atomic='999999'","DELETE FROM platform_referral_allocations"])assert.throws(()=>db.sqlite.exec(sql));
  const allocation=db.sqlite.prepare('SELECT * FROM platform_referral_allocations').get();
  const fake={...allocation,operation_id:crypto.randomUUID()},columns=Object.keys(fake);assert.throws(()=>db.sqlite.prepare('INSERT INTO platform_referral_allocations('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')').run(...Object.values(fake)),/authoritative_referral_receipt_required/);
 }finally{db.close();}
});

test('lifetime aggregation retains fractional atoms exactly and rejects rounded, duplicated or mixed facts',async()=>{
 const base={operation_id:'one',referral_code:'ref_'+crypto.randomUUID(),terms_version:REFERRAL_TERMS.terms_version,share_bps:100,network:BASE_NETWORK,asset:BASE_USDC.toLowerCase(),gross_atomic:'10001'};
 const huge=referralAccrual([{...base,gross_atomic:MAX_UINT256},{...base,operation_id:'two',gross_atomic:MAX_UINT256}]);assert.equal(huge.accrued_atomic,(BigInt(MAX_UINT256)*2n/100n).toString());assert.equal(huge.fractional_atom_numerator,(BigInt(MAX_UINT256)*200n%10000n).toString());
 const tiny=referralAccrual(Array.from({length:100},(_,i)=>({...base,operation_id:String(i),gross_atomic:'1'})));assert.equal(tiny.accrued_atomic,'1');assert.equal(tiny.fractional_atom_numerator,'0');
 for(const row of [{...base,gross_atomic:10001},{...base,gross_atomic:'01'},{...base,gross_atomic:'0'},{...base,share_bps:200},{...base,network:'eip155:1'}])assert.throws(()=>referralAccrual([row]));assert.throws(()=>referralAccrual([base,base]));assert.throws(()=>referralAccrual([base,{...base,operation_id:'two',referral_code:'ref_'+crypto.randomUUID()}]));
});

async function paidFixture({live=true,unknown=false,n=3,beforeSettle=()=>{}}={}){
 const db=database(),registered=await register(db),counts={adapter:0,verify:0,execute:0,settle:0};
 const product={id:'docs-pack',provider,version:'0.1.0',status:'validation',pricing:{minimum_amount_atomic:'10001',payments_enabled:true},outcome:{success_criterion:'Local test fixture only: nonnegative double'}};
 const config={enabled:true,live,receiverConfirmed:true,network:BASE_NETWORK,payTo:'0x'+'1'.repeat(40)};
 const terms=paymentRequirements(product,config),payer='0x'+'2'.repeat(40),url='https://example.invalid/v1/products/docs-pack/invoke',seconds=Math.floor(Date.now()/1000),key=crypto.randomUUID();
 const body={version:product.version,input:{n},max_charge_usdc_atomic:'10001',referral_code:registered.referral_code};
 const payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'00'.repeat(65),authorization:{from:payer,to:config.payTo,value:terms.amount,validAfter:String(seconds-1),validBefore:String(seconds+300),nonce:'0x'+'a'.repeat(64)}}};
 const invoke=(override={})=>paidInvocation({request:new Request(url,{method:'POST',headers:{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'X-AgentToolbox-Sample':'synthetic'}}),body:{...body,...override},key,product,handler:{input:z.strictObject({n:z.number().int()}),output:z.strictObject({n:z.number().int()}),run:async p=>{counts.execute++;return {n:p.n*2};},success:async p=>p.n>=0},db,config,adapterFactory:async()=>{counts.adapter++;return {requirements:terms,verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;await beforeSettle(db);if(unknown)throw new Error('Timeout after possible charge');return {success:true,network:BASE_NETWORK,transaction:'0x'+'b'.repeat(64),payer,amount:terms.amount};}};}});
 return {db,body,counts,product,invoke};
}

test('x402 integration freezes code in request hash and settlement admission; concurrent/later replay never reaccrues',async()=>{
 const s=await paidFixture();try{
  const concurrent=await Promise.allSettled([s.invoke(),s.invoke()]);assert(concurrent.some(r=>r.status==='fulfilled'));assert.equal(s.counts.execute,1);assert.equal(s.counts.settle,1);
  const first=await(await s.invoke()).json();assert.equal(first.payment.amount_settled_atomic,'10001');assert.equal(count(s.db,'platform_referral_allocations'),1);
  const row=s.db.sqlite.prepare('SELECT referral_code,referral_share_bps FROM platform_payments').get();assert.equal(row.referral_code,s.body.referral_code);assert.equal(row.referral_share_bps,100);
  await assert.rejects(s.invoke({referral_code:'ref_'+crypto.randomUUID()}),e=>e.code==='payment_replay_conflict');
  s.product.provider={id:'other',type:'third_party'};assert.deepEqual(await(await s.invoke()).json(),first);assert.equal(s.counts.settle,1);assert.equal(count(s.db,'platform_referral_allocations'),1);
 }finally{s.db.close();}
});

test('x402 rejects unknown codes before facilitator work; failures/unknown and allocation errors never recharge',async()=>{
 const bad=await paidFixture();try{await assert.rejects(bad.invoke({referral_code:'ref_'+crypto.randomUUID()}),e=>e.code==='unknown_referral_code');assert.deepEqual(bad.counts,{adapter:0,verify:0,execute:0,settle:0});assert.equal(count(bad.db,'platform_payments'),0);}finally{bad.db.close();}
 for(const options of [{n:-1},{unknown:true},{live:false}]){
  const s=await paidFixture(options);try{
   if(options.live===false){await s.invoke();await s.invoke();assert.equal(s.counts.settle,1);}
   else {await assert.rejects(s.invoke(),e=>['outcome_not_met','settlement_unresolved'].includes(e.code));await assert.rejects(s.invoke());assert.equal(s.counts.settle,options.unknown?1:0);}
   assert.equal(count(s.db,'platform_referral_allocations'),0);
  }finally{s.db.close();}
 }
 const broken=await paidFixture({beforeSettle:db=>db.sqlite.exec("CREATE TRIGGER fixture_allocation_failure BEFORE INSERT ON platform_referral_allocations BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END;")});try{
  await assert.rejects(broken.invoke(),/fixture_disk_failure/);await assert.rejects(broken.invoke(),e=>e.code==='settlement_unresolved');assert.equal(broken.counts.settle,1);assert.equal(count(broken.db,'platform_referral_allocations'),0);assert.equal(broken.db.sqlite.prepare('SELECT state FROM platform_payments').get().state,'settling');
 }finally{broken.db.close();}
});

test('HTTP referral registration, private reads, CORS and discovery preserve capability privacy and disclose no transfers',async()=>{
 const db=database(),origin='https://example.invalid',app=createPlatform({db,origin}),request=(path,init={})=>app(new Request(origin+path,init),'fixture');
 const post=(secret=capability,body={terms_version:REFERRAL_TERMS.terms_version})=>({method:'POST',headers:{'Content-Type':'application/json','X-Referral-Capability':secret},body:JSON.stringify(body)});
 try{
  const terms=await(await request('/v1/referral-terms')).json();assert.equal(terms.terms.share_bps,100);assert.equal(terms.terms.transfers_enabled,false);assert.match(terms.terms.payouts,/No payout or claim processor/);assert(!terms.instructions.includes('MCP'));
  const enrolled=await request('/v1/referrals',post());assert.equal(enrolled.status,200);assert.equal(enrolled.headers.get('Cache-Control'),'no-store');const saved=await enrolled.json();assert.equal(saved.transfers_enabled,false);assert.equal(saved.payment_effect,'none');assert(!JSON.stringify(saved).includes(capability));
  const again=await(await request('/v1/referrals',post())).json();assert.equal(again.referral_code,saved.referral_code);assert.equal(count(db,'platform_referrers'),1);
  const read=await request('/v1/referrals/me',{headers:{'X-Referral-Capability':capability}});assert.equal(read.status,200);assert.equal(read.headers.get('Cache-Control'),'no-store');const status=await read.json();assert.equal(status.referral_code,saved.referral_code);assert.equal(status.accrual.accrued_atomic,'0');assert.equal(status.accrual.paid_atomic,null);assert.equal(status.accrual.transfer_status,'unavailable_no_payout_processor');assert(!JSON.stringify(status).includes('capability_hash'));
  for(const init of [{},{headers:{'X-Referral-Capability':saved.referral_code}},{headers:{'X-Referral-Capability':'atbf_'+Buffer.alloc(32,9).toString('base64url')}}]){const denied=await request('/v1/referrals/me',init);assert.equal(denied.status,403);assert.equal((await denied.json()).error.code,'referral_capability_invalid');}
  assert.equal((await request('/v1/referrals/me?capability='+capability)).status,403);
  const cors=await request('/v1/referrals',{method:'OPTIONS',headers:{Origin:'https://buyer.example','Access-Control-Request-Headers':'X-Referral-Capability, Content-Type','Access-Control-Request-Method':'POST'}});assert.equal(cors.status,204);assert.equal(cors.headers.get('Access-Control-Allow-Origin'),'*');assert(cors.headers.get('Access-Control-Allow-Headers').includes('X-Referral-Capability'));
  assert.equal((await request('/v1/referrals',post(capability,{terms_version:REFERRAL_TERMS.terms_version,padding:'x'.repeat(17000)}))).status,413);
  for(const path of ['/v1/referrals/payout','/v1/referrals/claim'])assert.equal((await request(path,post())).status,404);
  const spec=await(await request('/openapi.json')).json();assert(spec.paths['/v1/referrals'].post);assert(spec.paths['/v1/referrals/me'].get);assert(spec.paths['/v1/referral-terms'].get);assert((await(await request('/llms.txt')).text()).includes('No payout processor or transfer is enabled'));
  assert.equal(count(db,'platform_payments'),0);
 }finally{db.close();}
});

test('HTTP shared feedback limiter prevents referral writes before admission',async()=>{
 const db=database(),origin='https://example.invalid',app=createPlatform({db,origin,feedbackLimit:async()=>false});try{
  const response=await app(new Request(origin+'/v1/referrals',{method:'POST',headers:{'Content-Type':'application/json','X-Referral-Capability':capability},body:JSON.stringify({terms_version:REFERRAL_TERMS.terms_version})}),'fixture');
  assert.equal(response.status,429);assert.equal((await response.json()).error.code,'rate_limited');assert.equal(count(db,'platform_referrers'),0);assert.equal(count(db,'platform_payments'),0);
 }finally{db.close();}
});
