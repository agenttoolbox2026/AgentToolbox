// Internal protected-operator integration. The caller validates owner Access/JWT
// and supplies its verified subject. No HTTP route or signing authority lives here.
import {z} from 'zod';
import {PlatformError} from './service.js';
import * as creator from './creator-payouts.js';
import * as referral from './referral-payouts.js';
import * as creatorWallet from './creator-wallets.js';
import * as referralWallet from './referral-wallets.js';
import {payoutKind,payoutRequestView,requestCursorDecode,requestCursorEncode} from './payout-requests.js';
import {hash} from './telemetry.js';
const id=z.uuid(),key=z.string().regex(/^[A-Za-z0-9_-]{32,128}$/);
const modules={creator,referral},walletModules={creator:creatorWallet,referral:referralWallet};
const domain=kind=>{payoutKind(kind);return {module:modules[kind],wallet:walletModules[kind],prefix:kind==='creator'?'platform_creator':'platform_referral',subject:kind==='creator'?'tool_id':'referral_code'};};
function actor(reviewer){if(typeof reviewer!=='string'||!reviewer.trim()||reviewer.length>128)throw new PlatformError(403,'owner_authorization_required','A verified owner subject is required by this internal integration.');}
function parsed(schema,value){const p=schema.safeParse(value);if(!p.success)throw new PlatformError(400,'invalid_operator_request','Use the bounded owner operation contract.');return p.data;}
const conflict=()=>new PlatformError(409,'payout_request_conflict','Request and reservation differ. Re-read the saved request; do not replace an uncertain payout.');
export const operatorQueueSchema=z.strictObject({kind:z.enum(['creator','referral']).optional(),status:z.enum(['requested','all']).default('requested'),limit:z.coerce.number().int().min(1).max(20).default(10),cursor:z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional()});
async function ownerRequestView(db,row){
 const {prefix}=domain(row.beneficiary_kind),ownerColumn=row.beneficiary_kind==='creator'?'creator_id':'referral_code';
 const wallet=await db.prepare(`SELECT c.claim_id,c.revision,c.address,c.network,c.created_at,EXISTS(SELECT 1 FROM ${prefix}_wallet_proofs p WHERE p.claim_id=c.claim_id) AS proof_verified,EXISTS(SELECT 1 FROM ${prefix}_wallet_approvals a WHERE a.claim_id=c.claim_id) AS owner_approved,c.revision=(SELECT max(revision) FROM ${prefix}_wallet_claims WHERE ${ownerColumn}=?) AS is_current FROM ${prefix}_wallet_claims c WHERE c.claim_id=?`).bind(row.owner_id,row.claim_id).first();
 return {...await payoutRequestView(db,row),wallet:wallet?{claim_id:wallet.claim_id,revision:wallet.revision,address:wallet.address,network:wallet.network,created_at:wallet.created_at,ownership_status:wallet.proof_verified?'eoa_signature_verified':'unverified',owner_approved:!!wallet.owner_approved,is_current:!!wallet.is_current}:null};
}
export async function listPayoutRequestsForOwner({db,reviewer,params={}}){
 actor(reviewer);const data=parsed(operatorQueueSchema,params),scope=await hash('owner-payout-requests:'+reviewer+':'+(data.kind??'all')+':'+data.status),before=requestCursorDecode(data.cursor,scope);
 const rows=(await db.prepare(`SELECT r.* FROM platform_payout_requests r WHERE 1=1 ${data.kind?'AND r.beneficiary_kind=?':''} ${data.status==='requested'?'AND NOT EXISTS(SELECT 1 FROM platform_payout_request_links l WHERE l.request_id=r.request_id)':''} ${before?'AND (r.created_at<? OR (r.created_at=? AND r.request_id<?))':''} ORDER BY r.created_at DESC,r.request_id DESC LIMIT ?`).bind(...(data.kind?[data.kind]:[]),...(before?[before.created,before.created,before.id]:[]),data.limit+1).all()).results,page=rows.slice(0,data.limit),last=page.at(-1);
 return {api_version:'1',requests:await Promise.all(page.map(r=>ownerRequestView(db,r))),next_cursor:rows.length>data.limit?requestCursorEncode({scope,created:last.created_at,id:last.request_id}):null,payment_effect:'none'};
}
export async function getPayoutRequestForOwner({db,reviewer,requestId}){
 actor(reviewer);parsed(id,requestId);const row=await db.prepare('SELECT * FROM platform_payout_requests WHERE request_id=?').bind(requestId).first();
 if(!row)throw new PlatformError(404,'payout_request_not_found','No payout request exists.');return ownerRequestView(db,row);
}
export async function approvePayoutWallet({db,kind,claimId,reviewer,requestId,now}){
 actor(reviewer);const {wallet}=domain(kind);parsed(id,claimId);parsed(key,requestId);return wallet.approveWallet({db,claimId,reviewer,requestId,now});
}
export async function reservePayoutRequests({db,kind,requestIds,reviewer,requestId,sourceAddress,now}){
 actor(reviewer);const {module,subject:subjectColumn,prefix}=domain(kind),ids=parsed(z.array(id).min(1).max(20),requestIds);parsed(key,requestId);
 if(new Set(ids).size!==ids.length)throw conflict();
 const rows=[];for(const request of [...ids].sort()){const row=await db.prepare('SELECT * FROM platform_payout_requests WHERE request_id=? AND beneficiary_kind=?').bind(request,kind).first();if(!row)throw conflict();rows.push(row);}
 if(new Set(rows.map(r=>r.subject_id)).size!==rows.length)throw conflict();
 const links=Object.fromEntries(rows.map(r=>[r.subject_id,r.request_id]));
 let batch;try{batch=await module.proposePayoutBatch({db,reviewer,requestId,sourceAddress,requestIds:links,items:rows.map(r=>({[subjectColumn]:r.subject_id,amount_atomic:r.amount_atomic})),now});}
 catch(error){if(/payout_request_link_conflict/.test(String(error)))throw conflict();throw error;}
 // Exact helper replay must already have these links. Never repair an unrelated
 // historical batch after commit or silently attach a different request.
 const saved=(await db.prepare(`SELECT l.request_id,l.payout_id FROM platform_payout_request_links l JOIN ${prefix}_payouts p ON p.payout_id=l.payout_id WHERE p.batch_id=? AND l.beneficiary_kind=? ORDER BY l.request_id LIMIT 21`).bind(batch.batch_id,kind).all()).results;
 if(saved.length!==ids.length||saved.some(r=>!ids.includes(r.request_id)))throw new PlatformError(503,'payout_link_unresolved','Reservation exists but request linkage requires reconciliation. Do not create a replacement payout.');
 return {beneficiary_kind:kind,...batch,request_ids:saved.map(r=>r.request_id)};
}
export async function readPayoutForOwner({db,kind,payoutId,reviewer}){
 actor(reviewer);const {prefix,subject}=domain(kind);parsed(id,payoutId);
 const row=await db.prepare(`SELECT * FROM ${prefix}_payouts WHERE payout_id=?`).bind(payoutId).first();if(!row)throw new PlatformError(404,'payout_not_found','No payout exists.');
 const events=(await db.prepare(`SELECT event_id,event,resulting_revision,reviewer_subject,transaction_hash,created_at FROM ${prefix}_payout_events WHERE payout_id=? ORDER BY resulting_revision DESC LIMIT 20`).bind(payoutId).all()).results;
 const candidates=(await db.prepare(`SELECT transaction_hash,nonce,created_at FROM ${prefix}_payout_transactions WHERE payout_id=? ORDER BY created_at,transaction_hash LIMIT 21`).bind(payoutId).all()).results;if(candidates.length>20)throw new PlatformError(503,'payout_accounting_unavailable','Candidate history exceeded its bound.');
 const linked=await db.prepare('SELECT request_id FROM platform_payout_request_links WHERE beneficiary_kind=? AND payout_id=?').bind(kind,payoutId).first();
 return {api_version:'1',beneficiary_kind:kind,payout_id:row.payout_id,batch_id:row.batch_id,subject_id:row[subject],request_id:linked?.request_id??null,claim_id:row.claim_id,claim_revision:row.claim_revision,network:row.network,asset:row.asset,source_address:row.source_address,destination_address:row.destination_address,amount_atomic:row.amount_atomic,state:row.state,revision:row.revision,created_at:row.created_at,events,candidates,payment_effect:'none'};
}
export async function getOperatorPayoutManifest({db,kind,payoutId,reviewer}){actor(reviewer);const {module}=domain(kind);return {beneficiary_kind:kind,...await module.getPayoutManifest({db,payoutId,reviewer})};}
const operation=name=>async({kind,...args})=>{actor(args.reviewer);return domain(kind).module[name](args);};
export const authorizeOperatorPayout=operation('authorizePayout');
export const cancelOperatorPayout=operation('cancelPayout');
export const markOperatorPayoutUnknown=operation('markPayoutUnknown');
export const registerOperatorPayoutTransaction=operation('registerPayoutTransaction');
export const reconcileOperatorPayout=operation('reconcilePayout');
