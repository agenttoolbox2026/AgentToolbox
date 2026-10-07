import {z} from 'zod';
import {getAddress,isAddress} from 'viem';
import {PlatformError} from './service.js';
import {referralCapabilitySchema,REFERRAL_TERMS,REFERRAL_PRODUCT_IDS} from './referrals.js';
import {BASE_NETWORK,BASE_USDC,isAtomicAmount} from './payment-config.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';
import {verifyBaseUsdcTransfer} from './payout-chain.js';

export const PAYOUT_LIMITS=Object.freeze({snapshot_rows:5000,batch_items:20,transaction_candidates:20});
const ASSET=BASE_USDC.toLowerCase(),ACTIVE=['reserved','awaiting_owner','submitted','unknown'];
const id=z.string().uuid(),key=z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),amount=z.string().refine(v=>isAtomicAmount(v)&&BigInt(v)>0n);
const referralCode=z.string().regex(/^ref_[0-9a-f-]{36}$/);
const conflict=()=>new PlatformError(409,'payout_conflict','Read the current payout state; preserve the original request for replay. Uncertain transfers retain their reservation.');
const unavailable=()=>new PlatformError(503,'payout_accounting_unavailable','A complete consistent bounded accounting snapshot is required. No funds were sent.');
function actor(value){if(typeof value!=='string'||value.length<1||value.length>256)throw new PlatformError(403,'owner_authorization_required','This internal helper requires an authenticated owner subject.');return value;}
function checked(schema,value){const parsed=schema.safeParse(value);if(!parsed.success)throw new PlatformError(400,'invalid_payout_request','Use the bounded payout request contract.');return parsed.data;}
function address(value){if(!isAddress(value,{strict:true})||/^0x0{40}$/i.test(value))throw new PlatformError(400,'invalid_payout_address','Use a nonzero checksummed or lowercase EVM address.');return getAddress(value).toLowerCase();}
async function boundedRows(statement){const rows=(await statement.all()).results;if(rows.length>PAYOUT_LIMITS.snapshot_rows)throw unavailable();return rows;}
const rowFor=(db,payoutId)=>db.prepare('SELECT * FROM platform_referral_payouts WHERE payout_id=?').bind(payoutId).first();
const publicPayout=row=>({payout_id:row.payout_id,referral_code:row.referral_code,amount_atomic:row.amount_atomic,network:row.network,asset:row.asset,state:row.state,revision:row.revision,created_at:row.created_at});

// Complete bounded snapshots only. No SQL floating-point/integer SUM on USDC strings.
async function accounting(db,code){
 const allocations=await boundedRows(db.prepare(`SELECT a.*,r.product_id AS receipt_product,r.version AS receipt_version,r.network AS receipt_network,r.asset AS receipt_asset,r.gross_atomic AS receipt_gross,r.settled_at,r.creator_tool_id AS receipt_creator_tool,r.creator_id AS receipt_creator,r.creator_share_bps AS receipt_creator_share,
 p.product_id AS payment_product,p.version AS payment_version,p.network AS payment_network,p.asset AS payment_asset,p.amount_atomic AS payment_gross,p.state AS payment_state,p.is_live,p.referral_code AS payment_code,p.referral_terms_version,p.referral_share_bps,p.creator_tool_id AS payment_creator_tool,p.creator_id AS payment_creator,p.creator_share_bps AS payment_creator_share,
 f.terms_version AS account_terms,f.share_bps AS account_share
 FROM platform_referral_allocations a LEFT JOIN platform_live_receipts r USING(operation_id) LEFT JOIN platform_payments p USING(operation_id) LEFT JOIN platform_referrers f ON f.referral_code=a.referral_code WHERE a.referral_code=? ORDER BY a.operation_id LIMIT 5001`).bind(code));
 const payouts=await boundedRows(db.prepare('SELECT * FROM platform_referral_payouts WHERE referral_code=? ORDER BY payout_id LIMIT 5001').bind(code));
 let gross=0n,paid=0n,reserved=0n;const seen=new Set();
 for(const a of allocations){
  if(seen.has(a.operation_id)||a.referral_code!==code||a.share_bps!==100||a.terms_version!==REFERRAL_TERMS.terms_version||a.account_terms!==a.terms_version||a.account_share!==100||!isAtomicAmount(a.gross_atomic)||a.gross_atomic==='0'||!REFERRAL_PRODUCT_IDS.includes(a.product_id)||a.receipt_product!==a.product_id||a.payment_product!==a.product_id||a.receipt_version!==a.version||a.payment_version!==a.version||a.receipt_gross!==a.gross_atomic||a.payment_gross!==a.gross_atomic||a.created_at!==a.settled_at||a.payment_state!=='settled'||a.is_live!==1||a.payment_code!==code||a.referral_terms_version!==a.terms_version||a.referral_share_bps!==100||[a.receipt_creator_tool,a.receipt_creator,a.receipt_creator_share,a.payment_creator_tool,a.payment_creator,a.payment_creator_share].some(v=>v!==null)||[a.network,a.receipt_network,a.payment_network].some(v=>v!==BASE_NETWORK)||[a.asset,a.receipt_asset,a.payment_asset].some(v=>typeof v!=='string'||v.toLowerCase()!==ASSET))throw unavailable();
  seen.add(a.operation_id);gross+=BigInt(a.gross_atomic);
 }
 for(const p of payouts){if(!isAtomicAmount(p.amount_atomic)||p.amount_atomic==='0'||p.network!==BASE_NETWORK||p.asset!==ASSET||p.share_bps!==100||p.terms_version!==REFERRAL_TERMS.terms_version)throw unavailable();if(p.state==='paid')paid+=BigInt(p.amount_atomic);else if(ACTIVE.includes(p.state))reserved+=BigInt(p.amount_atomic);}
 const numerator=gross*100n,accrued=numerator/10000n,available=accrued-paid-reserved;if(available<0n)throw unavailable();
 return {network:BASE_NETWORK,asset:ASSET,terms_version:REFERRAL_TERMS.terms_version,share_bps:100,revenue_basis:'gross',gross_atomic:gross.toString(),accrued_atomic:accrued.toString(),fractional_atom_numerator:(numerator%10000n).toString(),fractional_atom_denominator:'10000',confirmed_paid_atomic:paid.toString(),reserved_atomic:reserved.toString(),available_atomic:available.toString(),receipt_count:allocations.length,snapshot_hash:await hash(canonical({allocations:allocations.map(a=>[a.operation_id,a.referral_code,a.gross_atomic,a.network,a.asset.toLowerCase()]),paid:payouts.filter(p=>p.state==='paid').map(p=>[p.payout_id,p.amount_atomic])})),payouts,receipt_basis:'facilitator_confirmed_not_independently_reconciled',payout_basis:'finalized_canonical_base_usdc_transfer',fees:'platform funds gas separately; no referral deductions',transfers_enabled:false};
}
export async function getReferralEarnings({db,capability}){
 if(!referralCapabilitySchema.safeParse(capability).success)throw new PlatformError(403,'referral_capability_invalid','No matching private referral capability.');
 const entitlement=await db.prepare('SELECT * FROM platform_referrers WHERE capability_hash=?').bind(await hash(capability)).first();
 if(!entitlement)throw new PlatformError(403,'referral_capability_invalid','No matching private referral capability.');
 const result=await accounting(db,entitlement.referral_code);delete result.snapshot_hash;const payouts=result.payouts;delete result.payouts;
 return {api_version:'1',referral_code:entitlement.referral_code,...result,payout_count:payouts.length,payment_effect:'none'};
}
async function batchView(db,batchId){
 const rows=(await db.prepare('SELECT * FROM platform_referral_payouts WHERE batch_id=? ORDER BY referral_code LIMIT 21').bind(batchId).all()).results;if(!rows.length||rows.length>20)throw unavailable();
 return {batch_id:batchId,items:rows.map(publicPayout),payment_effect:'none',transfers_enabled:false};
}
// Internal owner-only functions: callers must establish owner auth before calling.
// They are deliberately absent from public HTTP and MCP route registries.
export async function proposePayoutBatch({db,reviewer,requestId,items,sourceAddress,requestIds={},now=()=>new Date()}){
 actor(reviewer);const body=checked(z.strictObject({request_id:key,items:z.array(z.strictObject({referral_code:referralCode,amount_atomic:amount})).min(1).max(20),source_address:z.string()}),{request_id:requestId,items,source_address:sourceAddress});
 const source=address(body.source_address);body.source_address=source;body.items.sort((a,b)=>a.referral_code.localeCompare(b.referral_code));if(new Set(body.items.map(x=>x.referral_code)).size!==body.items.length)throw conflict();
 const links=checked(z.record(z.string(),id),requestIds);
 if(Object.keys(links).length){if(Object.keys(links).length!==body.items.length||body.items.some(item=>!Object.hasOwn(links,item.referral_code)))throw new PlatformError(400,'invalid_payout_request','Request links must exactly match the batch subjects.');body.request_ids=links;}
 const keyHash=await hash(body.request_id),requestHash=await hash(canonical(body));
 const prior=()=>db.prepare('SELECT * FROM platform_referral_payout_batches WHERE reviewer_subject=? AND request_key_hash=?').bind(reviewer,keyHash).first();
 const replay=async row=>{if(row.request_hash!==requestHash)throw conflict();return batchView(db,row.batch_id);};
 const existing=await prior();if(existing)return replay(existing);
 const batchId=crypto.randomUUID(),date=now().toISOString(),statements=[db.prepare('INSERT INTO platform_referral_payout_batches VALUES(?,?,?,?,?)').bind(batchId,reviewer,keyHash,requestHash,date)];
 for(const item of body.items){
  const owner=await db.prepare(`SELECT e.referral_code,e.terms_version,c.claim_id,c.revision,c.address FROM platform_referrers e
 JOIN platform_referral_wallet_claims c USING(referral_code) JOIN platform_referral_wallet_approvals a USING(claim_id)
 JOIN platform_referral_wallet_proofs v USING(claim_id) WHERE e.referral_code=? AND c.revision=(SELECT max(revision) FROM platform_referral_wallet_claims WHERE referral_code=e.referral_code) LIMIT 1`).bind(item.referral_code).first();
  if(!owner)throw new PlatformError(409,'payout_wallet_not_approved','The current destination requires its wallet proof and a separate owner approval.');
  if(source===owner.address.toLowerCase())throw new PlatformError(409,'payout_self_transfer','The payout source and referral destination must differ.');
  const snapshot=await accounting(db,item.referral_code);
  if(snapshot.payouts.some(p=>ACTIVE.includes(p.state))||BigInt(item.amount_atomic)>BigInt(snapshot.available_atomic))throw conflict();
  const payoutId=crypto.randomUUID();
  statements.push(db.prepare(`INSERT INTO platform_referral_payouts(payout_id,batch_id,referral_code,terms_version,share_bps,claim_id,claim_revision,network,asset,source_address,destination_address,amount_atomic,gross_snapshot_atomic,accrued_snapshot_atomic,paid_snapshot_atomic,paid_snapshot_count,snapshot_hash,snapshot_receipt_count,created_at)
 VALUES(?,?,?,?,100,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(payoutId,batchId,item.referral_code,owner.terms_version,owner.claim_id,owner.revision,BASE_NETWORK,ASSET,source,owner.address.toLowerCase(),item.amount_atomic,snapshot.gross_atomic,snapshot.accrued_atomic,snapshot.confirmed_paid_atomic,snapshot.payouts.filter(p=>p.state==='paid').length,snapshot.snapshot_hash,snapshot.receipt_count,date));
  if(links[item.referral_code])statements.push(db.prepare("INSERT INTO platform_payout_request_links(request_id,beneficiary_kind,payout_id,created_at) VALUES(?, 'referral', ?, ?)").bind(links[item.referral_code],payoutId,date));
 }
 try{await db.batch(statements);}catch(e){const raced=await prior();if(raced)return replay(raced);if(/UNIQUE constraint|invalid_payout_reservation/.test(String(e)))throw conflict();throw e;}
 return batchView(db,batchId);
}
async function eventContext({db,payoutId,reviewer,requestId,expectedRevision,event,extra={}}){
 actor(reviewer);checked(id,payoutId);checked(key,requestId);checked(z.number().int().min(0).max(2147483646),expectedRevision);
 const requestHash=await hash(canonical({payoutId,expectedRevision,event,...extra})),keyHash=await hash(requestId);
 const existing=await db.prepare('SELECT * FROM platform_referral_payout_events WHERE reviewer_subject=? AND request_key_hash=?').bind(reviewer,keyHash).first();
 if(existing){if(existing.request_hash!==requestHash)throw conflict();return {replay:publicPayout(await rowFor(db,existing.payout_id))};}
 const row=await rowFor(db,payoutId);if(!row||row.revision!==expectedRevision)throw conflict();
 return {row,keyHash,requestHash};
}
function eventStatement(db,{row,keyHash,requestHash},reviewer,event,date,{transactionHash=null,evidenceId=null}={}){
 return db.prepare('INSERT INTO platform_referral_payout_events VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),row.payout_id,reviewer,keyHash,requestHash,row.revision,row.revision+1,event,transactionHash,evidenceId,date);
}
async function commitEvent(args,context,event,{before=[],transactionHash=null,evidenceId=null}={}){
 try{await args.db.batch([...before,eventStatement(args.db,context,args.reviewer,event,(args.now??(()=>new Date()))().toISOString(),{transactionHash,evidenceId})]);}
 catch(e){const raced=await eventContext({...args,event,extra:args.eventExtra??{}});if(raced.replay)return raced.replay;if(/payout_revision_conflict|payout_transaction_conflict|payout_transfer_conflict|payout_evidence_conflict|UNIQUE constraint/.test(String(e)))throw conflict();throw e;}
 return publicPayout(await rowFor(args.db,args.payoutId));
}
export async function authorizePayout(args){const context=await eventContext({...args,event:'authorize'});if(context.replay)return context.replay;if(context.row.state!=='reserved')throw conflict();return commitEvent(args,context,'authorize');}
export async function cancelPayout(args){const context=await eventContext({...args,event:'cancelled'});if(context.replay)return context.replay;if(context.row.state!=='reserved')throw conflict();return commitEvent(args,context,'cancelled');}
export async function markPayoutUnknown(args){const context=await eventContext({...args,event:'unknown'});if(context.replay)return context.replay;if(!['awaiting_owner','submitted','unknown'].includes(context.row.state))throw conflict();return commitEvent(args,context,'unknown');}
export async function getPayoutManifest({db,payoutId,reviewer}){
 actor(reviewer);checked(id,payoutId);const row=await rowFor(db,payoutId);if(!row||!['awaiting_owner','submitted','unknown','paid'].includes(row.state))throw conflict();
 return {manifest_version:'1',payout_id:row.payout_id,batch_id:row.batch_id,claim_id:row.claim_id,claim_revision:row.claim_revision,network:row.network,chain_id:8453,asset:row.asset,from:row.source_address,to:row.destination_address,amount_atomic:row.amount_atomic,transaction:{to:row.asset,value:'0',data:'0xa9059cbb'+row.destination_address.slice(2).padStart(64,'0')+BigInt(row.amount_atomic).toString(16).padStart(64,'0')},state:row.state,signature:null,broadcast:false,execution:'Owner reviews and signs one ordinary USDC transfer externally. A batch is a group of independent transfers, not atomic. Never resend an uncertain transfer.',fees:'Platform funds gas and other costs separately; exact referral amount cannot be reduced.'};
}
const txHashSchema=z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export async function registerPayoutTransaction(args){
 const transactionHash=checked(txHashSchema,args.transactionHash).toLowerCase(),extra={transactionHash},context=await eventContext({...args,event:'submitted',extra});if(context.replay)return context.replay;
 if(!['awaiting_owner','submitted','unknown'].includes(context.row.state)||typeof args.rpc!=='function')throw conflict();
 const tx=await args.rpc('eth_getTransactionByHash',[transactionHash]);
 const row=context.row,expectedInput='0xa9059cbb'+row.destination_address.slice(2).padStart(64,'0')+BigInt(row.amount_atomic).toString(16).padStart(64,'0');
 if(!tx||JSON.stringify(tx).length>16384||tx.hash?.toLowerCase()!==transactionHash||tx.from?.toLowerCase()!==row.source_address||tx.to?.toLowerCase()!==row.asset||tx.input?.toLowerCase()!==expectedInput||tx.value!=='0x0'||tx.chainId!=='0x2105'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(tx.nonce??''))throw new PlatformError(409,'payout_transaction_unconfirmed','Transaction is unavailable or differs from the approved transfer. Reservation remains held.');
 const prior=await args.db.prepare('SELECT * FROM platform_referral_payout_transactions WHERE transaction_hash=?').bind(transactionHash).first();
 if(prior&&prior.payout_id!==args.payoutId)throw conflict();
 const other=await args.db.prepare('SELECT nonce FROM platform_referral_payout_transactions WHERE payout_id=? LIMIT 1').bind(args.payoutId).first();if(other&&other.nonce!==tx.nonce)throw new PlatformError(409,'payout_replacement_conflict','A replacement must use the same source nonce and transfer intent. Reservation remains held.');
 const before=prior?[]:[args.db.prepare('INSERT INTO platform_referral_payout_transactions VALUES(?,?,?,?)').bind(transactionHash,args.payoutId,tx.nonce,(args.now??(()=>new Date()))().toISOString())];
 return commitEvent({...args,eventExtra:extra},context,'submitted',{before,transactionHash});
}
export async function reconcilePayout(args){
 const transactionHash=checked(txHashSchema,args.transactionHash).toLowerCase(),extra={transactionHash},context=await eventContext({...args,event:'confirmed',extra});if(context.replay)return context.replay;
 if(!['submitted','unknown'].includes(context.row.state))throw conflict();
 const candidate=await args.db.prepare('SELECT nonce FROM platform_referral_payout_transactions WHERE payout_id=? AND transaction_hash=?').bind(args.payoutId,transactionHash).first();if(!candidate)throw conflict();
 const row=context.row,evidence=await verifyBaseUsdcTransfer({rpc:args.rpc,transactionHash,sender:row.source_address,recipient:row.destination_address,amountAtomic:row.amount_atomic});
 const authorization=await args.db.prepare("SELECT created_at FROM platform_referral_payout_events WHERE payout_id=? AND event='authorize' LIMIT 1").bind(row.payout_id).first();
 if(evidence.nonce!==candidate.nonce||!authorization||BigInt(evidence.blockTimestamp)<=BigInt(Math.floor(Date.parse(authorization.created_at)/1000)))throw new PlatformError(409,'payout_evidence_predates_authorization','Transfer must match the reserved nonce and be mined after owner authorization. Reservation remains held.');
 const evidenceId=crypto.randomUUID(),before=[args.db.prepare('INSERT INTO platform_referral_payout_evidence VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(evidenceId,row.payout_id,evidence.network,evidence.token,evidence.transactionHash,evidence.logIndex,evidence.blockNumber,evidence.blockHash,evidence.finalizedBlockNumber,evidence.sender,evidence.recipient,evidence.amountAtomic,await hash(canonical(evidence)),(args.now??(()=>new Date()))().toISOString())];
 return commitEvent({...args,eventExtra:extra},context,'confirmed',{before,transactionHash,evidenceId});
}
