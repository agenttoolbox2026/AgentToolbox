import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {privateKeyToAccount} from 'viem/accounts';
import {database} from '../scripts/local-db.js';
import {registerReferral,REFERRAL_TERMS} from '../src/referrals.js';
import {submitTool,CREATOR_TERMS} from '../src/submissions.js';
import {recordCreatorInstallation} from '../src/creator-installations.js';
import * as creatorWallet from '../src/creator-wallets.js';
import * as creatorPayout from '../src/creator-payouts.js';
import {claimWallet,challengeWallet,verifyWallet,approveWallet} from '../src/referral-wallets.js';
import {getReferralEarnings,proposePayoutBatch,authorizePayout,cancelPayout,markPayoutUnknown,getPayoutManifest,registerPayoutTransaction,reconcilePayout} from '../src/referral-payouts.js';
import {BASE_NETWORK,BASE_USDC,MAX_UINT256} from '../src/payment-config.js';
import {hash} from '../src/telemetry.js';
const date='2026-10-07T08:00:00.000Z',now=()=>new Date(date),origin='https://example.invalid',reviewer='local-owner',sourceAddress='0x'+'11'.repeat(20),account=privateKeyToAccount('0x'+'01'.repeat(32));
const key=()=>crypto.randomUUID(),conflict=e=>e.status===409;
async function creator(db,{proof=true,approval=true,wallet=true,legacy=false}={}){
 const capability='atbc_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const submission=await submitTool({db,body:{request_id:key(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal:{name:'Local payout fixture',summary:'Local private accounting fixture',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}},capability,client:key(),now});
 await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(key(),submission.submission_id,reviewer,await hash(key()),'a'.repeat(64),0,1,'approved','Local fixture',date).run();
 const tool=submission.tool_id;
 let installation;
 if(legacy)db.sqlite.prepare('UPDATE platform_creator_entitlements SET installed_adapter=? WHERE tool_id=?').run('local-fixture',tool);
 else installation=await recordCreatorInstallation({db,reviewer,requestId:key(),toolId:tool,expectedRevision:0,action:'install',metadataRevision:0,metadataVersion:'0.1.0',adapterId:'local-fixture',artifactSha256:'a'.repeat(64),successContractSha256:'b'.repeat(64),productVersion:'0.1.0',now});
 const creatorId=db.sqlite.prepare('SELECT creator_id FROM platform_creator_entitlements WHERE tool_id=?').get(tool).creator_id;
 if(!wallet)return {db,tool,creatorId,capability,installation};
 const claim=await creatorWallet.claimWallet({db,capability,body:{request_id:key(),expected_revision:0,network:BASE_NETWORK,address:account.address},now});
 if(proof){const challenge=await creatorWallet.challengeWallet({db,capability,body:{request_id:key(),claim_revision:1},origin,now});await creatorWallet.verifyWallet({db,capability,body:{challenge_id:challenge.challenge_id,signature:await account.signMessage({message:challenge.message})},origin,now});}
 if(approval&&proof)await creatorWallet.approveWallet({db,claimId:claim.claim_id,reviewer,requestId:key(),now});
 return {db,tool,creatorId,capability,claim,installation};
}
function creatorAccrue(f,gross='10001',{network=BASE_NETWORK,asset=BASE_USDC}={}){
 const operation=key(),transaction='0x'+operation.replaceAll('-','').padEnd(64,'a');
 f.db.sqlite.prepare(`INSERT INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,is_live,creator_tool_id,creator_id,creator_share_bps${f.installation?',creator_installation_id,creator_install_revision':''}) VALUES(?,?,'0.1.0',?,'fixture','fixture',?,?,?, ?,?,?,'settling',?,?,'synthetic',1,?,?,9000${f.installation?',?,?':''})`).run(operation,f.tool,key(),network,asset,sourceAddress,key(),gross,sourceAddress,date,date,f.tool,f.creatorId,...(f.installation?[f.installation.installation_id,f.installation.revision]:[]));
 const stmt=f.db.sqlite.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)');for(const event of ['outcome_validated','settlement_reported'])stmt.run(key(),operation,f.tool,'0.1.0',event,network,asset,gross,transaction,'synthetic',date);
 f.db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(operation);
}
async function referrer(db,{proof=true,approval=true}={}){
 const capability='atbf_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
 const registration=await registerReferral({db,body:{terms_version:REFERRAL_TERMS.terms_version},capability,client:key(),now}),code=registration.referral_code;
 const claim=await claimWallet({db,capability,body:{request_id:key(),expected_revision:0,network:BASE_NETWORK,address:account.address},now});
 if(proof){const challenge=await challengeWallet({db,capability,body:{request_id:key(),claim_revision:1},origin,now});await verifyWallet({db,capability,body:{challenge_id:challenge.challenge_id,signature:await account.signMessage({message:challenge.message})},origin,now});}
 if(proof&&approval)await approveWallet({db,claimId:claim.claim_id,reviewer,requestId:key(),now});
 return {db,code,capability,claim};
}
function accrue(f,gross='10001',{network=BASE_NETWORK,asset=BASE_USDC}={}){
 const operation=key(),transaction='0x'+operation.replaceAll('-','').padEnd(64,'a');
 f.db.sqlite.prepare(`INSERT INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,is_live,referral_code,referral_terms_version,referral_share_bps) VALUES(?,'docs-pack','0.1.0',?,'fixture','fixture',?,?,?,?,?,?,'settling',?,?,'synthetic',1,?,?,100)`).run(operation,key(),network,asset,sourceAddress,key(),gross,sourceAddress,date,date,f.code,REFERRAL_TERMS.terms_version);
 const stmt=f.db.sqlite.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)');for(const event of ['outcome_validated','settlement_reported'])stmt.run(key(),operation,'docs-pack','0.1.0',event,network,asset,gross,transaction,'synthetic',date);
 f.db.sqlite.prepare("UPDATE platform_payments SET state='settled' WHERE operation_id=?").run(operation);
}
const earnings=f=>getReferralEarnings({db:f.db,capability:f.capability});
const propose=(f,amount='100',extra={})=>proposePayoutBatch({db:f.db,reviewer,requestId:key(),sourceAddress,items:[{referral_code:f.code,amount_atomic:amount}],now,...extra});
const event=(f,p,extra={})=>({db:f.db,payoutId:p.payout_id,reviewer,requestId:key(),expectedRevision:p.revision,now,...extra});
function chain(p,transactionHash='0x'+'33'.repeat(32),nonce='0x7'){
 const blockHash='0x'+'44'.repeat(32),finalHash='0x'+'55'.repeat(32),topic=a=>'0x'+a.slice(2).padStart(64,'0'),data='0x'+BigInt(p.amount_atomic).toString(16).padStart(64,'0');
 const tx={hash:transactionHash,chainId:'0x2105',nonce,from:sourceAddress,to:BASE_USDC,value:'0x0',input:'0xa9059cbb'+topic(account.address).slice(2)+data.slice(2),blockNumber:'0x10',blockHash,transactionIndex:'0x0'};
 const log={address:BASE_USDC,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(sourceAddress),topic(account.address)],data,transactionHash,blockNumber:'0x10',blockHash,transactionIndex:'0x0',logIndex:'0x2',removed:false};
 const receipt={transactionHash,from:sourceAddress,to:BASE_USDC,status:'0x1',blockNumber:'0x10',blockHash,transactionIndex:'0x0',logs:[log]},canonical={number:'0x10',hash:blockHash,transactions:[transactionHash],timestamp:'0x'+(BigInt(Date.parse(date)/1000)+1n).toString(16)},finalized={number:'0x20',hash:finalHash},calls=[];
 const f={tx,receipt,canonical,calls,transactionHash};f.rpc=async(method,params)=>{calls.push(method);if(method==='eth_chainId')return '0x2105';if(method==='eth_getTransactionByHash')return tx;if(method==='eth_getTransactionReceipt')return receipt;if(method==='eth_getBlockByNumber')return params[0]==='finalized'||params[0]==='0x20'?finalized:canonical;throw Error('unexpected RPC');};return f;
}
async function paid(f,p,txHash){p=await authorizePayout(event(f,p));const c=chain(p,txHash,txHash?'0x8':'0x7');p=await registerPayoutTransaction(event(f,p,c));return reconcilePayout(event(f,p,c));}
function local(name,fn){test(name,async()=>{const db=database();try{await fn(db);}finally{db.close();}});}
local('referral 100bps BigInt carry persists across paid cycles and huge gross',async db=>{
 const f=await referrer(db);accrue(f,'199');let e=await earnings(f);assert.equal(e.accrued_atomic,'1');assert.equal(e.fractional_atom_numerator,'9900');await paid(f,(await propose(f,'1')).items[0]);accrue(f,'101');e=await earnings(f);assert.equal(e.available_atomic,'2');await paid(f,(await propose(f,'2')).items[0],'0x'+'66'.repeat(32));accrue(f,MAX_UINT256);e=await earnings(f);assert.equal(10000n*BigInt(e.accrued_atomic)+BigInt(e.fractional_atom_numerator),100n*BigInt(e.gross_atomic));assert.equal(e.confirmed_paid_atomic,'3');assert.equal(e.fractional_atom_denominator,'10000');assert.equal(e.reserved_atomic,'0');await assert.rejects(getReferralEarnings({db,capability:'atbf_'+Buffer.alloc(32,9).toString('base64url')}),e=>e.status===403);
});
local('mixed denominations fail closed; proof and separate owner approval are mandatory',async db=>{
 const mixed=await referrer(db);accrue(mixed);accrue(mixed,'10001',{network:'eip155:1'});await assert.rejects(earnings(mixed),e=>e.status===503);await assert.rejects(propose(mixed),e=>e.status===503);
 for(const options of [{proof:false},{approval:false}]){const f=await referrer(db,options);accrue(f);await assert.rejects(propose(f),e=>e.code==='payout_wallet_not_approved');}assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payouts').get().n,0);
});
local('concurrent proposal and changed replay reserve once; wallet remains frozen',async db=>{
 const f=await referrer(db);accrue(f);const requestId=key(),results=await Promise.allSettled([propose(f,'100',{requestId}),propose(f)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);await assert.rejects(propose(f,'99',{requestId}),conflict);await assert.rejects(claimWallet({db,capability:f.capability,body:{request_id:key(),expected_revision:1,network:BASE_NETWORK,address:sourceAddress},now}),conflict);assert.equal((await earnings(f)).reserved_atomic,'100');for(const sourceAddress of [account.address,account.address.toLowerCase()])await assert.rejects(propose(f,'1',{sourceAddress}),e=>e.code==='payout_self_transfer');
});
local('batch failure rolls back first reservation and batch audit; cancel/authorize race applies once',async db=>{
 const a=await referrer(db),b=await referrer(db);accrue(a);accrue(b);const last=[a.code,b.code].sort().at(-1);db.sqlite.exec(`CREATE TRIGGER fixture_failure BEFORE INSERT ON platform_referral_payouts WHEN NEW.referral_code='${last}' BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END`);await assert.rejects(propose(a,'100',{items:[{referral_code:a.code,amount_atomic:'100'},{referral_code:b.code,amount_atomic:'100'}]}),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_batches').get().n,0);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payouts').get().n,0);db.sqlite.exec('DROP TRIGGER fixture_failure');const p=(await propose(a)).items[0],race=await Promise.allSettled([authorizePayout(event(a,p)),cancelPayout(event(a,p))]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal(race.find(r=>r.status==='rejected').reason.status,409);
});
local('unknown reservation holds funds; replacement nonce and finalized evidence commit atomically once',async db=>{
 const f=await referrer(db);accrue(f);let p=await authorizePayout(event(f,(await propose(f)).items[0]));p=await markPayoutUnknown(event(f,p));await assert.rejects(cancelPayout(event(f,p)),conflict);await assert.rejects(propose(f),conflict);assert.equal((await getPayoutManifest({db,payoutId:p.payout_id,reviewer})).broadcast,false);const c=chain(p);p=await registerPayoutTransaction(event(f,p,c));await assert.rejects(registerPayoutTransaction(event(f,p,chain(p,'0x'+'77'.repeat(32),'0x8'))),conflict);
 db.sqlite.exec("CREATE TRIGGER fixture_failure BEFORE INSERT ON platform_referral_payout_events WHEN NEW.event='confirmed' BEGIN SELECT RAISE(ABORT,'fixture_disk_failure'); END");await assert.rejects(reconcilePayout(event(f,p,c)),/fixture_disk_failure/);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_evidence').get().n,0);assert.equal((await earnings(f)).reserved_atomic,'100');db.sqlite.exec('DROP TRIGGER fixture_failure');const confirmation=event(f,p,c);p=await reconcilePayout(confirmation);assert.equal(p.state,'paid');assert.deepEqual(await reconcilePayout(confirmation),p);assert.equal((await earnings(f)).confirmed_paid_atomic,'100');assert.equal((await earnings(f)).reserved_atomic,'0');
});
local('nonce changes, old inclusion and canonical reorg retain reservation without evidence',async db=>{
 const f=await referrer(db);accrue(f);let p=await authorizePayout(event(f,(await propose(f)).items[0]));const c=chain(p);p=await registerPayoutTransaction(event(f,p,c));c.tx.nonce='0x8';await assert.rejects(reconcilePayout(event(f,p,c)),conflict);c.tx.nonce='0x7';const timestamp=c.canonical.timestamp;c.canonical.timestamp='0x1';await assert.rejects(reconcilePayout(event(f,p,c)),conflict);c.canonical.timestamp=timestamp;c.canonical.hash='0x'+'88'.repeat(32);await assert.rejects(reconcilePayout(event(f,p,c)),e=>e.code==='payout_chain_invalid');assert.equal((await earnings(f)).reserved_atomic,'100');assert.equal((await earnings(f)).confirmed_paid_atomic,'0');assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_evidence').get().n,0);
});
local('creator and referral ledgers cannot share a source nonce or transaction in either direction',async db=>{
 const r=await referrer(db),c=await creator(db);accrue(r,'20000');creatorAccrue(c,'20000');let rp=await authorizePayout(event(r,(await propose(r)).items[0])),cp=(await creatorPayout.proposePayoutBatch({db,reviewer,requestId:key(),sourceAddress,items:[{tool_id:c.tool,amount_atomic:'100'}],now})).items[0];cp=await creatorPayout.authorizePayout(event(c,cp));const ct=chain(cp);cp=await creatorPayout.registerPayoutTransaction(event(c,cp,ct));await assert.rejects(registerPayoutTransaction(event(r,rp,chain(rp,'0x'+'66'.repeat(32)))),conflict);await assert.rejects(registerPayoutTransaction(event(r,rp,ct)),conflict);const rt=chain(rp,'0x'+'77'.repeat(32),'0x8');rp=await registerPayoutTransaction(event(r,rp,rt));cp=await creatorPayout.reconcilePayout(event(c,cp,ct));const next=(await creatorPayout.proposePayoutBatch({db,reviewer,requestId:key(),sourceAddress,items:[{tool_id:c.tool,amount_atomic:'100'}],now})).items[0],authorized=await creatorPayout.authorizePayout(event(c,next));await assert.rejects(creatorPayout.registerPayoutTransaction(event(c,authorized,chain(authorized,'0x'+'88'.repeat(32),'0x8'))),conflict);assert.equal((await earnings(r)).reserved_atomic,'100');
});
local('complete bounded accounting accepts 5000 allocations and fails closed at 5001',async db=>{
 const f=await referrer(db);db.sqlite.exec('BEGIN');try{for(let i=0;i<5000;i++)accrue(f,'1');db.sqlite.exec('COMMIT');}catch(e){db.sqlite.exec('ROLLBACK');throw e;}assert.equal((await earnings(f)).receipt_count,5000);accrue(f,'1');await assert.rejects(earnings(f),e=>e.status===503);await assert.rejects(propose(f,'1'),e=>e.status===503);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_batches').get().n,0);
});
local('paid-count snapshot prevents stale reservation and batch items resolve independently',async db=>{
 const a=await referrer(db),b=await referrer(db);accrue(a,'20000');accrue(b,'20000');const batch=await propose(a,'100',{items:[{referral_code:a.code,amount_atomic:'100'},{referral_code:b.code,amount_atomic:'100'}]}),first=batch.items.find(p=>p.referral_code===a.code),second=batch.items.find(p=>p.referral_code===b.code),stale=db.sqlite.prepare('SELECT * FROM platform_referral_payouts WHERE payout_id=?').get(first.payout_id);await paid(a,first);const unknown=await markPayoutUnknown(event(b,await authorizePayout(event(b,second))));assert.equal(unknown.state,'unknown');assert.equal((await earnings(a)).confirmed_paid_atomic,'100');assert.equal((await earnings(b)).reserved_atomic,'100');
 const batchId=key();db.sqlite.prepare('INSERT INTO platform_referral_payout_batches VALUES(?,?,?,?,?)').run(batchId,reviewer,'c'.repeat(64),'d'.repeat(64),date);const columns=Object.keys(stale),values={...stale,payout_id:key(),batch_id:batchId};assert.throws(()=>db.sqlite.prepare(`INSERT INTO platform_referral_payouts(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>values[c])),/invalid_payout_reservation/);const fresh=(await propose(a)).items[0];assert.equal(db.sqlite.prepare('SELECT paid_snapshot_count FROM platform_referral_payouts WHERE payout_id=?').get(fresh.payout_id).paid_snapshot_count,1);
});
local('request link maps reject missing or extra subjects before ledger mutation',async db=>{
 const f=await referrer(db);accrue(f);for(const requestIds of [{other:key()},{[f.code]:key(),other:key()},{[f.code]:'not-uuid'}])await assert.rejects(propose(f,'100',{requestIds}),e=>e.status===400);assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_batches').get().n,0);
});
test('additive referral payout migration preserves existing paid creator evidence and referral/private history',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');const db={sqlite,prepare(sql){return {bind(...args){return {first:async()=>sqlite.prepare(sql).get(...args)??null,all:async()=>({results:sqlite.prepare(sql).all(...args)}),run:async()=>{const before=sqlite.prepare('SELECT total_changes() n').get().n;sqlite.prepare(sql).run(...args);return {meta:{changes:sqlite.prepare('SELECT total_changes() n').get().n-before}};}};}};},async batch(statements){sqlite.exec('BEGIN');try{const out=await Promise.all(statements.map(s=>s.all()));sqlite.exec('COMMIT');return out;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};try{
 const directory=new URL('../migrations/',import.meta.url);for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')&&n<'0015').sort())sqlite.exec(readFileSync(new URL(name,directory),'utf8'));
 const c=await creator(db),r=await referrer(db);creatorAccrue(c);accrue(r);let p=(await creatorPayout.proposePayoutBatch({db,reviewer,requestId:key(),sourceAddress,items:[{tool_id:c.tool,amount_atomic:'100'}],now})).items[0];p=await creatorPayout.authorizePayout(event(c,p));const ct=chain(p);p=await creatorPayout.registerPayoutTransaction(event(c,p,ct));await creatorPayout.reconcilePayout(event(c,p,ct));
 sqlite.prepare("INSERT INTO platform_feedback(id,key_hash,fingerprint,product_id,version,channel,link_status,sample_kind,message,created_at) VALUES(?,?,?,'docs-pack','0.1.0','http','unverified','synthetic',?,?)").run(key(),key(),'local-fingerprint','Private migration fixture',date);
 const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name),snapshot=()=>tables.map(name=>({name,rows:JSON.stringify(sqlite.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()),foreignKeys:JSON.stringify(sqlite.prepare(`PRAGMA foreign_key_list(${name})`).all())})),before=snapshot();sqlite.exec(readFileSync(new URL('0015_referral_payouts.sql',directory),'utf8'));assert.deepEqual(snapshot(),before);assert.deepEqual(sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
 const rp=await authorizePayout(event(r,(await propose(r)).items[0]));await assert.rejects(registerPayoutTransaction(event(r,rp,chain(rp,'0x'+'66'.repeat(32)))),conflict);
 const evidence=sqlite.prepare('SELECT * FROM platform_creator_payout_evidence').get(),columns=Object.keys(evidence),duplicate={...evidence,evidence_id:key(),payout_id:rp.payout_id};assert.throws(()=>sqlite.prepare(`INSERT INTO platform_referral_payout_evidence(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...columns.map(c=>duplicate[c])),/payout_transaction_conflict/);assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_creator_payout_evidence').get().n,1);assert.equal(sqlite.prepare('SELECT count(*) n FROM platform_referral_payout_evidence').get().n,0);
 }finally{sqlite.close();}
});
