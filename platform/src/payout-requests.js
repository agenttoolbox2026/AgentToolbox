import {z} from 'zod';
import {PlatformError} from './service.js';
import {creatorSecretHash} from './submissions.js';
import {referralCapabilitySchema} from './referrals.js';
import {getCreatorEarnings} from './creator-payouts.js';
import {getReferralEarnings} from './referral-payouts.js';
import {BASE_NETWORK,BASE_USDC,isAtomicAmount} from './payment-config.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';
const kindSchema=z.enum(['creator','referral']),uuid=z.uuid();
export const payoutRequestSchema=z.strictObject({request_id:uuid,amount_atomic:z.string().regex(/^[1-9][0-9]{0,77}$/).refine(isAtomicAmount),claim_revision:z.number().int().min(1).max(2147483647)});
export const payoutRequestHistorySchema=z.strictObject({limit:z.coerce.number().int().min(1).max(20).default(10),cursor:z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional()});
const fail=(status,code,message)=>new PlatformError(status,code,message);
export function payoutKind(kind){if(!kindSchema.safeParse(kind).success)throw fail(400,'invalid_payout_kind','Use creator or referral.');return kind;}
const conflict=()=>fail(409,'payout_request_conflict','Keep the original request. A changed destination or cancelled payout requires a new explicit request.');
function parse(schema,value){const p=schema.safeParse(value);if(!p.success)throw fail(400,'invalid_payout_request','Use the published bounded payout request.');return p.data;}
async function subject({db,kind,tool,capability}){
 payoutKind(kind);
 if(kind==='creator'){
  const row=await db.prepare('SELECT e.tool_id,e.creator_id FROM platform_creator_entitlements e JOIN platform_creators c USING(creator_id) WHERE e.tool_id=? AND c.capability_hash=?').bind(tool??'',await creatorSecretHash(capability)).first();
  if(!row)throw fail(403,'creator_capability_invalid','No matching private creator entitlement.');
  return {id:row.tool_id,owner:row.creator_id};
 }
 if(!referralCapabilitySchema.safeParse(capability).success)throw fail(403,'referral_capability_invalid','No matching private referral capability.');
 const row=await db.prepare('SELECT referral_code FROM platform_referrers WHERE capability_hash=?').bind(await hash(capability)).first();
 if(!row)throw fail(403,'referral_capability_invalid','No matching private referral capability.');return {id:row.referral_code,owner:row.referral_code};
}
export async function payoutRequestView(db,row){
 const kind=payoutKind(row.beneficiary_kind),table=kind==='creator'?'platform_creator_payouts':'platform_referral_payouts',evidence=kind==='creator'?'platform_creator_payout_evidence':'platform_referral_payout_evidence';
 const payout=await db.prepare(`SELECT p.payout_id,p.batch_id,p.amount_atomic,p.network,p.asset,p.state,p.revision,p.created_at,e.transaction_hash,e.block_hash,e.block_number,e.log_index,e.checked_at FROM platform_payout_request_links l JOIN ${table} p ON p.payout_id=l.payout_id LEFT JOIN ${evidence} e ON e.payout_id=p.payout_id WHERE l.request_id=? AND l.beneficiary_kind=?`).bind(row.request_id,kind).first();
 if(payout?.state==='paid'&&!payout.transaction_hash)throw fail(503,'payout_accounting_unavailable','Paid receipt evidence is unavailable.');
 const receipt=payout?.state==='paid'?{transaction_hash:payout.transaction_hash,block_hash:payout.block_hash,block_number:payout.block_number,log_index:payout.log_index,checked_at:payout.checked_at,basis:'finalized_canonical_base_usdc_transfer'}:null;
 return {api_version:'1',request_id:row.request_id,beneficiary_kind:kind,subject_id:row.subject_id,amount_atomic:row.amount_atomic,network:row.network,asset:row.asset,claim_id:row.claim_id,claim_revision:row.claim_revision,created_at:row.created_at,state:payout?.state??'requested',payout:payout?{payout_id:payout.payout_id,batch_id:payout.batch_id,state:payout.state,revision:payout.revision,amount_atomic:payout.amount_atomic,created_at:payout.created_at,receipt}:null,payment_effect:'none'};
}
export async function requestPayout({db,kind,tool,body,capability,now=()=>new Date()}){
 const who=await subject({db,kind,tool,capability}),data=parse(payoutRequestSchema,body),requestHash=await hash(canonical({kind,subject:who.id,...data}));
 const reload=()=>db.prepare('SELECT * FROM platform_payout_requests WHERE request_id=?').bind(data.request_id).first();
 const replay=row=>{if(row.beneficiary_kind!==kind||row.subject_id!==who.id||row.owner_id!==who.owner||row.request_hash!==requestHash)throw conflict();return payoutRequestView(db,row);};
 const previous=await reload();if(previous)return replay(previous);
 const walletTable=kind==='creator'?'platform_creator_wallet_claims':'platform_referral_wallet_claims',ownerColumn=kind==='creator'?'creator_id':'referral_code';
 const claim=await db.prepare(`SELECT * FROM ${walletTable} WHERE ${ownerColumn}=? ORDER BY revision DESC LIMIT 1`).bind(who.owner).first();
 if(!claim||claim.revision!==data.claim_revision)throw fail(409,'payout_wallet_changed','Claim the current payout destination and use its revision.');
 const earnings=kind==='creator'?await getCreatorEarnings({db,tool,capability}):await getReferralEarnings({db,capability});
 if(BigInt(data.amount_atomic)>BigInt(earnings.available_atomic))throw fail(409,'insufficient_payout_balance','Requested amount exceeds currently available earned funds.');
 try{await db.prepare('INSERT INTO platform_payout_requests VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(data.request_id,kind,who.id,who.owner,data.amount_atomic,BASE_NETWORK,BASE_USDC.toLowerCase(),claim.claim_id,claim.revision,requestHash,now().toISOString()).run();}
 catch(error){const raced=await reload();if(raced)return replay(raced);if(/payout_request_budget_exhausted/.test(String(error)))throw fail(429,'payout_request_budget_exhausted','The bounded request budget is exhausted.');if(/invalid_payout_request_claim|UNIQUE constraint/.test(String(error)))throw conflict();throw error;}
 return replay(await reload());
}
export async function getPayoutRequest({db,kind,tool,id,capability}){
 const who=await subject({db,kind,tool,capability});parse(uuid,id);
 const row=await db.prepare('SELECT * FROM platform_payout_requests WHERE request_id=? AND beneficiary_kind=? AND subject_id=? AND owner_id=?').bind(id,kind,who.id,who.owner).first();
 if(!row)throw fail(404,'payout_request_not_found','No matching private payout request.');return payoutRequestView(db,row);
}
export function requestCursorEncode(value){return btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
export function requestCursorDecode(cursor,scope){
 if(!cursor)return null;try{const value=JSON.parse(atob(cursor.replaceAll('-','+').replaceAll('_','/')));if(value.scope!==scope||!uuid.safeParse(value.id).success||!z.string().datetime().safeParse(value.created).success||Object.keys(value).length!==3)throw Error();return value;}catch{throw fail(400,'invalid_cursor','Use the returned private cursor.');}
}
export async function listPayoutRequests({db,kind,tool,capability,params={}}){
 const who=await subject({db,kind,tool,capability}),data=parse(payoutRequestHistorySchema,params),scope=await hash(kind+':'+who.id),before=requestCursorDecode(data.cursor,scope);
 const rows=(await db.prepare(`SELECT * FROM platform_payout_requests WHERE beneficiary_kind=? AND subject_id=? AND owner_id=? ${before?'AND (created_at<? OR (created_at=? AND request_id<?))':''} ORDER BY created_at DESC,request_id DESC LIMIT ?`).bind(kind,who.id,who.owner,...(before?[before.created,before.created,before.id]:[]),data.limit+1).all()).results,page=rows.slice(0,data.limit),last=page.at(-1);
 return {api_version:'1',requests:await Promise.all(page.map(row=>payoutRequestView(db,row))),next_cursor:rows.length>data.limit?requestCursorEncode({scope,created:last.created_at,id:last.request_id}):null,payment_effect:'none'};
}
