import {z} from 'zod';
import {PlatformError} from './service.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';
import {BASE_NETWORK,BASE_USDC} from './payment-config.js';

export const CREATOR_TERMS=Object.freeze({terms_version:'creator-promo-2026-10-07.v1',currency:'USDC',network:BASE_NETWORK,asset:BASE_USDC,decimals:6,list_fee_atomic:'500000',discount_bps:10000,charged_fee_atomic:'0',paid_fee_atomic:'0',share_bps:9000,revenue_basis:'gross',duration:'lifetime_of_the_approved_tool',deductions:'none; operating costs and referral commissions do not reduce the creator share',rejection_refund:'actual_fee_paid',promotion:'100% off; no fee charged and no refund due on rejection',transfers_enabled:false,approval_effect:'metadata approval only; separate installed-adapter review required before publication or execution',identity:'Capability control only; no verified wallet or real identity',recovery:'Keep your capability privately; no recovery grant is provided'});
export const SUBMISSION_LIMITS=Object.freeze({body_bytes:16384,client_daily:4,global_daily:40,name_chars:120,summary_chars:1000,url_chars:800,schema_bytes:4000});
export const creatorCapabilitySchema=z.string().regex(/^atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).describe('Private client-generated 32 random bytes, canonical base64url prefixed atbc_. Never put it in a URL, public proposal, log or wallet field.');
const jsonSchema=z.record(z.string(),z.unknown()).refine(v=>new TextEncoder().encode(JSON.stringify(v)).length<=SUBMISSION_LIMITS.schema_bytes).describe('Private untrusted proposed JSON Schema, at most 4000 UTF-8 bytes; not executed or accepted as a platform contract.');
function proposalUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash&&u.hostname.includes('.')&&!/[\[\]:]/.test(u.hostname)&&!/^\d+(\.\d+){3}$/.test(u.hostname)&&!/(^|\.)(localhost|local|internal|test|invalid)$/.test(u.hostname);}catch{return false;}}
export const proposalSchema=z.strictObject({name:z.string().trim().min(1).max(120),summary:z.string().trim().min(1).max(1000),endpoint_url:z.string().max(800).refine(proposalUrl).describe('HTTPS proposal URL without credentials, query, fragment, explicit ports or local/IP hosts. Never fetched.'),input_schema:jsonSchema,output_schema:jsonSchema});
export const submissionSchema=z.strictObject({request_id:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),creator_secret_hash:z.string().regex(/^[0-9a-f]{64}$/),terms_version:z.literal(CREATOR_TERMS.terms_version),proposal:proposalSchema});
export const SUBMISSION_BUDGET_SQL=`((SELECT COUNT(*) FROM platform_tool_submissions WHERE created_at>=?)+(SELECT COUNT(*) FROM platform_tool_update_proposals WHERE created_at>=?))<40 AND ((SELECT COUNT(*) FROM platform_tool_submissions WHERE created_at>=? AND client_hash=?)+(SELECT COUNT(*) FROM platform_tool_update_proposals WHERE created_at>=? AND client_hash=?))<4`;
export const creatorTerms=()=>({api_version:'1',terms:CREATOR_TERMS,limits:SUBMISSION_LIMITS,submit_path:'/v1/tool-submissions',status_path:'/v1/tool-submissions/{id}',approved_tool_path:'/v1/creator-tools/{tool_id}',update_path:'/v1/creator-tools/{tool_id}/updates',update_status_path:'/v1/tool-updates/{id}',payout_wallet_path:'/v1/creators/me/payout-wallet',earnings_path:'/v1/creator-tools/{tool_id}/earnings',wallet_policy:'Optional destination collection; private and unverified until EOA ownership proof, then separate owner approval. No automatic transfer.',instructions:'Generate and retain an atbc_ capability before submitting; commit SHA-256(capability) as creator_secret_hash. Submit only non-sensitive private metadata; URLs/schemas are untrusted and never executed. Reuse the same request_id/body/capability for replay. Approval creates an entitlement, not a published or installed tool.'});
export async function creatorSecretHash(secret){if(!creatorCapabilitySchema.safeParse(secret).success)throw new PlatformError(403,'creator_capability_required','Use your client-generated 32-byte atbc_ capability privately.');return hash(secret);}
function view(row,decision){return {api_version:'1',submission_id:row.submission_id,tool_id:row.tool_id,state:row.state,revision:row.revision,proposal:JSON.parse(row.proposal_json),terms:JSON.parse(row.terms_json),refund_due_atomic:row.refund_due_atomic,decision:decision?{decision:decision.decision,reason:decision.reason,created_at:decision.created_at}:null,publication:'not_published_by_submission',payment_effect:'none',transfers_enabled:false,created_at:row.created_at};}
async function decisionFor(db,id){return db.prepare('SELECT decision,reason,created_at FROM platform_submission_decisions WHERE submission_id=?').bind(id).first();}
export async function getSubmission({db,id,capability}){
 const commitment=await creatorSecretHash(capability);
 const row=await db.prepare('SELECT s.* FROM platform_tool_submissions s JOIN platform_creators c ON c.creator_id=s.creator_id WHERE s.submission_id=? AND c.capability_hash=?').bind(id,commitment).first();
 if(!row)throw new PlatformError(403,'creator_capability_invalid','No matching private submission capability.');
 return view(row,await decisionFor(db,id));
}
export async function submitTool({db,body,capability,client,now=()=>new Date()}){
 const parsed=submissionSchema.safeParse(body);if(!parsed.success)throw new PlatformError(400,'invalid_submission','Use the published proposal schema and current terms.');
 const data=parsed.data,commitment=await creatorSecretHash(capability);
 if(commitment!==data.creator_secret_hash)throw new PlatformError(403,'creator_capability_invalid','Capability does not match its commitment.');
 if(JSON.stringify(data.proposal).includes(capability))throw new PlatformError(400,'capability_in_proposal','Keep your private capability out of the proposal.');
 const keyHash=await hash(data.request_id),requestHash=await hash(canonical(data)),clientHash=await hash(client),date=now().toISOString(),day=date.slice(0,10)+'T00:00:00.000Z';
 const prior=()=>db.prepare('SELECT s.* FROM platform_tool_submissions s JOIN platform_creators c ON c.creator_id=s.creator_id WHERE c.capability_hash=? AND s.request_key_hash=?').bind(commitment,keyHash).first();
 const replay=async row=>{if(row.request_hash!==requestHash)throw new PlatformError(409,'submission_conflict','Keep the original request_id, proposal, terms and capability.');return view(row,await decisionFor(db,row.submission_id));};
 const existing=await prior();if(existing)return replay(existing);
 const id=crypto.randomUUID(),creator=crypto.randomUUID(),tool='creator-'+id;
 const budget=SUBMISSION_BUDGET_SQL,budgetArgs=[day,day,day,clientHash,day,clientHash];
 // Batch admission is transactional. Exhausted budgets never create orphan creator rows.
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO platform_creators SELECT ?,?,? WHERE ${budget}`).bind(creator,commitment,date,...budgetArgs),
  db.prepare(`INSERT OR IGNORE INTO platform_tool_submissions(submission_id,creator_id,tool_id,request_key_hash,request_hash,proposal_json,terms_json,terms_version,list_fee_atomic,discount_bps,charged_fee_atomic,paid_fee_atomic,share_bps,revenue_basis,created_at,client_hash)
  SELECT ?,c.creator_id,?,?,?,?,?,?,'500000',10000,'0','0',9000,'gross',?,? FROM platform_creators c WHERE c.capability_hash=? AND ${budget}`)
   .bind(id,tool,keyHash,requestHash,JSON.stringify(data.proposal),JSON.stringify(CREATOR_TERMS),CREATOR_TERMS.terms_version,date,clientHash,commitment,...budgetArgs),
 ]);
 const saved=await prior();if(saved)return replay(saved);
 throw new PlatformError(429,'submission_budget_exhausted','The bounded submission budget is exhausted; retry later. No fee was charged.');
}

// Internal server helper only. Metadata approval alone can never bind a beneficiary.
export async function creatorBeneficiary(db,product,handler){
 if(typeof handler.creatorAdapterId!=='string')return {tool_id:null,creator_id:null,share_bps:null};
 const row=await db.prepare('SELECT tool_id,creator_id,share_bps FROM platform_creator_entitlements WHERE tool_id=? AND installed_adapter=?').bind(product.id,handler.creatorAdapterId).first();
 if(!row)throw new PlatformError(503,'creator_adapter_unavailable','No reviewed creator entitlement matches this installed adapter.');
 return row;
}
export function creatorAccrual(rows){
 let gross=0n;const operations=new Set(),entitlement=rows[0]&&[rows[0].tool_id,rows[0].creator_id].join(':');
 for(const row of rows){if(!row.tool_id||!row.creator_id||[row.tool_id,row.creator_id].join(':')!==entitlement||operations.has(row.operation_id)||row.share_bps!==9000||typeof row.gross_atomic!=='string'||!/^(0|[1-9][0-9]*)$/.test(row.gross_atomic))throw new Error('Invalid, mixed or duplicate allocation; refusing inaccurate accrual.');operations.add(row.operation_id);gross+=BigInt(row.gross_atomic);}
 const numerator=gross*9n;
 return {gross_atomic:gross.toString(),share_bps:9000,accrued_atomic:(numerator/10n).toString(),fractional_atom_numerator:(numerator%10n).toString(),fractional_atom_denominator:'10',receipt_count:operations.size,transfer_status:'not_paid_by_this_ledger',receipt_basis:'facilitator_confirmed_not_independently_reconciled'};
}
