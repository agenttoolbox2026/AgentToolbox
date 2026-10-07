import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {database} from '../scripts/local-db.js';
import {submitTool,CREATOR_TERMS} from '../src/submissions.js';
import {claimWallet,challengeWallet,verifyWallet,approveWallet} from '../src/creator-wallets.js';
import {getCreatorEarnings,proposePayoutBatch,authorizePayout,cancelPayout,markPayoutUnknown,getPayoutManifest,registerPayoutTransaction,reconcilePayout} from '../src/creator-payouts.js';
import {BASE_NETWORK,BASE_USDC,MAX_UINT256} from '../src/payment-config.js';
import {hash} from '../src/telemetry.js';
const date='2026-10-07T08:00:00.000Z',now=()=>new Date(date),origin='https://example.invalid',reviewer='local-owner',sourceAddress='0x'+'11'.repeat(20),account=privateKeyToAccount('0x'+'01'.repeat(32));
const key=()=>crypto.randomUUID(),conflict=e=>e.status===409;
async function creator(db,{proof=true,approval=true,wallet=true}={}){
 const capability='atbc_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const submission=await submitTool({db,body:{request_id:key(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal:{name:'Local payout fixture',summary:'Local private accounting fixture',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}},capability,client:key(),now});
 await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(key(),submission.submission_id,reviewer,await hash(key()),'a'.repeat(64),0,1,'approved','Local fixture',date).run();
 const tool=submission.tool_id;db.sqlite.prepare('UPDATE platform_creator_entitlements SET installed_adapter=? WHERE tool_id=?').run('local-fixture',tool);
 const creatorId=db.sqlite.prepare('SELECT creator_id FROM platform_creator_entitlements WHERE tool_id=?').get(tool).creator_id;
 if(!wallet)return {db,tool,creatorId,capability};
 const claim=await claimWallet({db,capability,body:{request_id:key(),expected_revision:0,network:BASE_NETWORK,address:account.address},now});
 if(proof){const challenge=await challengeWallet({db,capability,body:{request_id:key(),claim_revision:1},origin,now});await verifyWallet({db,capability,body:{challenge_id:challenge.challenge_id,signature:await account.signMessage({message:challenge.message})},origin,now});}
 if(approval&&proof)await approveWallet({db,claimId:claim.claim_id,reviewer,requestId:key(),now});
 return {db,tool,creatorId,capability,claim};
}
function accrue(f,gross='10001',{network=BASE_NETWORK,asset=BASE_USDC}={}){
 const operation=key(),transaction='0x'+operation.replaceAll('-','').padEnd(64,'a');
 f.db.sqlite.prepare(`INSERT INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,is_live,creator_tool_id,creator_id,creator_share_bps) VALUES(?,?,'0.1.0',?,'fixture','fixture',?,?,?, ?,?,?,'settling',?,?,'synthetic',1,?,?,9000)`).run(operation,f.tool,key(),network,asset,sourceAddress,key(),gross,sourceAddress,date,date,f.tool,f.creatorId);
 const stmt=f.db.sqlite.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)');for(const event of ['outcome_validated','settlement_reported'])stmt.run(key(),operation,f.tool,'0.1.0',event,network,asset,gross,transaction,'synthetic',date);
 f.db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(operation);
}
const earnings=f=>getCreatorEarnings({db:f.db,tool:f.tool,capability:f.capability});
const propose=(f,amount='9000',extra={})=>proposePayoutBatch({db:f.db,reviewer,requestId:key(),sourceAddress,items:[{tool_id:f.tool,amount_atomic:amount}],now,...extra});
const event=(f,p,extra={})=>({db:f.db,payoutId:p.payout_id,reviewer,requestId:key(),expectedRevision:p.revision,now,...extra});
function chain(p,transactionHash='0x'+'33'.repeat(32),nonce='0x7'){
 const blockHash='0x'+'44'.repeat(32),finalHash='0x'+'55'.repeat(32),topic=a=>'0x'+a.slice(2).padStart(64,'0'),data='0x'+BigInt(p.amount_atomic).toString(16).padStart(64,'0');
 const tx={hash:transactionHash,chainId:'0x2105',nonce,from:sourceAddress,to:BASE_USDC,value:'0x0',input:'0xa9059cbb'+topic(account.address).slice(2)+data.slice(2),blockNumber:'0x10',blockHash,transactionIndex:'0x0'};
 const log={address:BASE_USDC,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(sourceAddress),topic(account.address)],data,transactionHash,blockNumber:'0x10',blockHash,transactionIndex:'0x0',logIndex:'0x2',removed:false};
 const receipt={transactionHash,from:sourceAddress,to:BASE_USDC,status:'0x1',blockNumber:'0x10',blockHash,transactionIndex:'0x0',logs:[log]},canonical={number:'0x10',hash:blockHash,timestamp:'0x'+(BigInt(Date.parse(date)/1000)+1n).toString(16)},finalized={number:'0x20',hash:finalHash},calls=[];
 const f={tx,receipt,canonical,calls,transactionHash};f.rpc=async(method,params)=>{calls.push(method);if(method==='eth_chainId')return '0x2105';if(method==='eth_getTransactionByHash')return tx;if(method==='eth_getTransactionReceipt')return receipt;if(method==='eth_getBlockByNumber')return params[0]==='finalized'||params[0]==='0x20'?finalized:canonical;throw Error('unexpected RPC');};return f;
}
async function paid(f,p,txHash){p=await authorizePayout(event(f,p));const c=chain(p,txHash);p=await registerPayoutTransaction(event(f,p,c));return reconcilePayout(event(f,p,c));}
function local(name,fn){test(name,async()=>{const db=database();try{await fn(db);}finally{db.close();}});}
local('BigInt gross accounting carries fractional atoms across independently paid cycles',async db=>{
 const f=await creator(db);accrue(f,'11');let e=await earnings(f);assert.equal(e.accrued_atomic,'9');assert.equal(e.fractional_atom_numerator,'9');await paid(f,(await propose(f,'9')).items[0]);accrue(f,'11');e=await earnings(f);assert.equal(e.available_atomic,'10');await paid(f,(await propose(f,'10')).items[0],'0x'+'66'.repeat(32));accrue(f,MAX_UINT256);e=await earnings(f);assert.equal(10n*BigInt(e.accrued_atomic)+BigInt(e.fractional_atom_numerator),9n*BigInt(e.gross_atomic));assert.equal(e.confirmed_paid_atomic,'19');assert.equal(e.reserved_atomic,'0');assert.equal(BigInt(e.available_atomic),BigInt(e.accrued_atomic)-19n);await assert.rejects(getCreatorEarnings({db,tool:f.tool,capability:'atbc_'+Buffer.alloc(32,9).toString('base64url')}),e=>e.status===403);
});
local('mixed receipt denominations fail closed and preserve all reservations',async db=>{const f=await creator(db);accrue(f);accrue(f,'10001',{network:'eip155:1'});await assert.rejects(earnings(f),e=>e.code==='payout_accounting_unavailable');await assert.rejects(propose(f),e=>e.status===503);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,0);});
local('wallet ownership proof and separate approval both precede payout reservation',async db=>{for(const options of [{proof:false},{approval:false}]){const f=await creator(db,options);accrue(f);await assert.rejects(propose(f),e=>e.code==='payout_wallet_not_approved');if(options.proof===false)await assert.rejects(approveWallet({db,claimId:f.claim.claim_id,reviewer,requestId:key(),now}),conflict);}assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,0);});
local('concurrent proposals reserve once; replay binds original body and wallet cannot change',async db=>{
 const f=await creator(db);accrue(f);const requestId=key(),args={requestId};const results=await Promise.allSettled([propose(f,'9000',args),propose(f,'9000')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const p=results.find(r=>r.status==='fulfilled').value.items[0];assert.equal((await earnings(f)).reserved_atomic,'9000');await assert.rejects(propose(f,'8999',args),conflict);await assert.rejects(claimWallet({db,capability:f.capability,body:{request_id:key(),expected_revision:1,network:BASE_NETWORK,address:sourceAddress},now}),conflict);assert.throws(()=>db.sqlite.prepare("UPDATE platform_creator_payouts SET amount_atomic='1'").run(),/immutable_payout/);assert.equal(p.state,'reserved');
});
local('invalid batch item and persistence failure leave no orphan batch or reservation',async db=>{
 const a=await creator(db),b=await creator(db);accrue(a);accrue(b);const items=[{tool_id:a.tool,amount_atomic:'9000'},{tool_id:b.tool,amount_atomic:'9002'}];await assert.rejects(propose(a,'9000',{items}),conflict);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_batches').get().n,0);
 const last=[a.tool,b.tool].sort().at(-1);db.sqlite.exec(`CREATE TRIGGER fixture_fail_payout BEFORE INSERT ON platform_creator_payouts WHEN NEW.tool_id='${last}' BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END`);await assert.rejects(propose(a,'9000',{items:[{tool_id:a.tool,amount_atomic:'9000'},{tool_id:b.tool,amount_atomic:'9000'}]}),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_batches').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,0);
});
local('cancel is limited to preauthorization; unknown transfers hold funds and do not resend',async db=>{
 const f=await creator(db);accrue(f);let p=(await propose(f)).items[0];p=await cancelPayout(event(f,p));assert.equal((await earnings(f)).reserved_atomic,'0');p=(await propose(f)).items[0];const auth=event(f,p);p=await authorizePayout(auth);assert.deepEqual(await authorizePayout(auth),p);await assert.rejects(cancelPayout(event(f,p)),conflict);p=await markPayoutUnknown(event(f,p));await assert.rejects(propose(f),conflict);const manifest=await getPayoutManifest({db,payoutId:p.payout_id,reviewer});assert.equal(manifest.broadcast,false);assert.equal(manifest.signature,null);assert.equal((await earnings(f)).reserved_atomic,'9000');
});
local('registered replacement uses same nonce and confirmed finalized evidence pays atomically once',async db=>{
 const f=await creator(db);accrue(f);let p=await authorizePayout(event(f,(await propose(f)).items[0]));const first=chain(p),registration=event(f,p,first);p=await registerPayoutTransaction(registration);assert.deepEqual(await registerPayoutTransaction(registration),p);const wrong=chain(p,'0x'+'77'.repeat(32),'0x8');await assert.rejects(registerPayoutTransaction(event(f,p,wrong)),conflict);const replacement=chain(p,'0x'+'66'.repeat(32));p=await registerPayoutTransaction(event(f,p,replacement));
 db.sqlite.exec("CREATE TRIGGER fixture_fail_confirmation BEFORE INSERT ON platform_creator_payout_events WHEN NEW.event='confirmed' BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END");await assert.rejects(reconcilePayout(event(f,p,replacement)),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_evidence').get().n,0);assert.equal((await earnings(f)).confirmed_paid_atomic,'0');db.sqlite.exec('DROP TRIGGER fixture_fail_confirmation');const confirmation=event(f,p,replacement);p=await reconcilePayout(confirmation);assert.equal(p.state,'paid');assert.deepEqual(await reconcilePayout(confirmation),p);await assert.rejects(reconcilePayout(event(f,p,first)),conflict);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_evidence').get().n,1);assert.equal((await earnings(f)).confirmed_paid_atomic,'9000');assert.equal((await earnings(f)).reserved_atomic,'0');
});
local('batch transfers resolve independently and transaction cannot satisfy two logical payouts',async db=>{
 const a=await creator(db),b=await creator(db);accrue(a);accrue(b);const batch=await propose(a,'9000',{items:[{tool_id:a.tool,amount_atomic:'9000'},{tool_id:b.tool,amount_atomic:'9000'}]});let pa=batch.items.find(p=>p.tool_id===a.tool),pb=batch.items.find(p=>p.tool_id===b.tool);pa=await paid(a,pa);pb=await authorizePayout(event(b,pb));await assert.rejects(registerPayoutTransaction(event(b,pb,chain(pb))),conflict);pb=await markPayoutUnknown(event(b,pb));assert.equal(pa.state,'paid');assert.equal(pb.state,'unknown');assert.equal((await earnings(a)).confirmed_paid_atomic,'9000');assert.equal((await earnings(b)).reserved_atomic,'9000');assert.equal((await earnings(b)).confirmed_paid_atomic,'0');
});
local('reconciliation rejects a changed registered nonce and preauthorization chain inclusion',async db=>{
 const f=await creator(db);accrue(f);let p=await authorizePayout(event(f,(await propose(f)).items[0]));const c=chain(p);p=await registerPayoutTransaction(event(f,p,c));
 c.tx.nonce='0x8';await assert.rejects(reconcilePayout(event(f,p,c)),conflict);c.tx.nonce='0x7';c.canonical.timestamp='0x'+(BigInt(Date.parse(date)/1000)-1n).toString(16);await assert.rejects(reconcilePayout(event(f,p,c)),conflict);
 assert.equal((await earnings(f)).confirmed_paid_atomic,'0');assert.equal((await earnings(f)).reserved_atomic,'9000');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_evidence').get().n,0);
});
local('paid snapshot count rejects a stale reservation after a competing payout becomes paid',async db=>{
 const f=await creator(db);accrue(f,'20000');const initial=(await propose(f)).items[0];const stale=db.sqlite.prepare('SELECT * FROM platform_creator_payouts WHERE payout_id=?').get(initial.payout_id);assert.equal(stale.paid_snapshot_count,0);
 await paid(f,initial);assert.equal((await earnings(f)).confirmed_paid_atomic,'9000');
 // Reproduce the commit of a reservation built from a pre-payment snapshot.
 // All immutable wallet and denomination fields remain valid; only paid count is stale.
 const batchId=key();db.sqlite.prepare('INSERT INTO platform_creator_payout_batches VALUES(?,?,?,?,?)').run(batchId,reviewer,'b'.repeat(64),'c'.repeat(64),date);
 const columns=Object.keys(stale),values={...stale,payout_id:key(),batch_id:batchId};
 assert.throws(()=>db.sqlite.prepare(`INSERT INTO platform_creator_payouts(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>values[c])),/invalid_payout_reservation/);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,1);assert.equal((await earnings(f)).reserved_atomic,'0');
 const fresh=(await propose(f)).items[0];assert.equal(db.sqlite.prepare('SELECT paid_snapshot_count FROM platform_creator_payouts WHERE payout_id=?').get(fresh.payout_id).paid_snapshot_count,1);
});
local('complete bounded snapshots reject 5001 real authoritative allocations before reserving',async db=>{
 const f=await creator(db);db.sqlite.exec('BEGIN');try{for(let i=0;i<5000;i++)accrue(f,'1');db.sqlite.exec('COMMIT');}catch(e){db.sqlite.exec('ROLLBACK');throw e;}
 const complete=await earnings(f);assert.equal(complete.receipt_count,5000);assert.equal(complete.accrued_atomic,'4500');accrue(f,'1');await assert.rejects(earnings(f),e=>e.status===503&&e.code==='payout_accounting_unavailable');await assert.rejects(propose(f,'1'),e=>e.status===503);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_batches').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,0);
});
local('authorize and cancel race produces one audited transition and one revision conflict',async db=>{
 const f=await creator(db);accrue(f);const p=(await propose(f)).items[0],results=await Promise.allSettled([authorizePayout(event(f,p)),cancelPayout(event(f,p))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const rejected=results.find(r=>r.status==='rejected');assert.equal(rejected.reason.status,409);const row=db.sqlite.prepare('SELECT state,revision FROM platform_creator_payouts WHERE payout_id=?').get(p.payout_id);assert.equal(row.revision,1);assert.ok(['awaiting_owner','cancelled'].includes(row.state));assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_events WHERE payout_id=?').get(p.payout_id).n,1);assert.equal((await earnings(f)).reserved_atomic,row.state==='cancelled'?'0':'9000');
});
local('canonical reorg during reconciliation preserves submitted reservation and no paid evidence',async db=>{
 const f=await creator(db);accrue(f);let p=await authorizePayout(event(f,(await propose(f)).items[0]));const c=chain(p);p=await registerPayoutTransaction(event(f,p,c));const originalRpc=c.rpc;let canonicalReads=0;c.rpc=async(method,params)=>{const result=await originalRpc(method,params);return method==='eth_getBlockByNumber'&&params[0]==='0x10'&&++canonicalReads===2?{...result,hash:'0x'+'88'.repeat(32)}:result;};await assert.rejects(reconcilePayout(event(f,p,c)),e=>e.code==='payout_chain_invalid');assert.equal(db.sqlite.prepare('SELECT state FROM platform_creator_payouts WHERE payout_id=?').get(p.payout_id).state,'submitted');assert.equal((await earnings(f)).reserved_atomic,'9000');assert.equal((await earnings(f)).confirmed_paid_atomic,'0');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_evidence').get().n,0);await assert.rejects(propose(f),conflict);
});
local('proposal rejects normalized source equal to verified creator destination',async db=>{
 const f=await creator(db);accrue(f);for(const sourceAddress of [account.address,account.address.toLowerCase()])await assert.rejects(propose(f,'9000',{sourceAddress}),e=>e.status===409&&e.code==='payout_self_transfer');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_batches').get().n,0);assert.equal((await earnings(f)).reserved_atomic,'0');
});
test('wallet and payout migrations preserve all earlier creator, payment and private history rows and foreign keys',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 const db={sqlite,prepare(sql){return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{sqlite.prepare(sql).run(...args);return {};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const results=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 try{
  const migrations=new URL('../migrations/',import.meta.url),names=readdirSync(migrations).filter(n=>n.endsWith('.sql')).sort();for(const name of names.filter(n=>n<'0011'))sqlite.exec(readFileSync(new URL(name,migrations),'utf8'));
  const f=await creator(db,{wallet:false});accrue(f);
  sqlite.prepare("INSERT INTO platform_examples(id,product_id,version,key_hash,state,sample_kind,created_at,updated_at,result_json,result_expires_at) VALUES(?,?,'0.1.0',?,'completed','synthetic',?,?,?,?)").run(key(),f.tool,key(),date,date,JSON.stringify({private_fixture:'local-only result'}),'2026-10-08T08:00:00.000Z');
  sqlite.prepare("INSERT INTO platform_feedback(id,key_hash,fingerprint,product_id,version,channel,link_status,sample_kind,rating,task_description,message,created_at) VALUES(?,?,?,?,'0.1.0','http','unverified','synthetic',4,?,?,?)").run(key(),key(),'private-fingerprint',f.tool,'Private test task','Private test feedback',date);
  const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),snapshot=()=>tables.map(name=>({name,rows:JSON.stringify(sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),foreignKeys:JSON.stringify(sqlite.prepare(`PRAGMA foreign_key_list(${name})`).all())})),before=snapshot();assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_live_receipts').get().n,1);assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_creator_allocations').get().n,1);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
  for(const name of ['0011_creator_wallets.sql','0012_creator_payouts.sql'])sqlite.exec(readFileSync(new URL(name,migrations),'utf8'));
  assert.deepEqual(snapshot(),before);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_creator_payouts').get().n,0);assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_creator_wallet_claims').get().n,0);
 }finally{sqlite.close();}
});
