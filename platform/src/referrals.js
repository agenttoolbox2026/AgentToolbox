import {z} from 'zod';
import {PlatformError} from './service.js';
import {hash} from './telemetry.js';
import {BASE_NETWORK,BASE_USDC,isAtomicAmount} from './payment-config.js';
import {referralCodeSchema} from './referral-schema.js';
export {referralCodeSchema} from './referral-schema.js';

export const REFERRAL_PRODUCT_IDS=Object.freeze(['docs-pack','quote-proof','contract-cases','mcp-wirecheck']);
export const REFERRAL_TERMS=Object.freeze({terms_version:'first-party-referrals-2026-10-07.v1',share_bps:100,revenue_basis:'gross',network:BASE_NETWORK,asset:BASE_USDC,decimals:6,eligible_product_ids:REFERRAL_PRODUCT_IDS,creator_tools_eligible:false,platform_share_bps:9900,attribution:'The public referral code must be included in the original paid invocation. No retroactive attribution.',eligibility:'A server-validated outcome and a matching live facilitator-confirmed settlement receipt. Buyer sample labels and usefulness reports do not alter earned commissions.',identity:'Capability control only; no verified wallet or distinct-agent identity. Self-referrals cannot be reliably detected.',payouts:'Commissions accrue to this capability-controlled account. No payout or claim processor exists; no transfer or payment date is promised.',transfers_enabled:false,recovery:'Keep the original capability privately. There is no recovery grant.'});
export const REFERRAL_LIMITS=Object.freeze({client_daily:4,global_daily:40});
export const referralCapabilitySchema=z.string().regex(/^atbf_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).describe('Private client-generated 32 random bytes, canonical base64url with atbf_ prefix. Retain privately; never put it in a URL or paid invocation.');
export const referralRegistrationSchema=z.strictObject({terms_version:z.literal(REFERRAL_TERMS.terms_version)});
export const referralTerms=()=>({api_version:'1',terms:REFERRAL_TERMS,limits:REFERRAL_LIMITS,register_path:'/v1/referrals',status_path:'/v1/referrals/me',instructions:'Generate and retain an atbf_ capability before registration; send it only in the X-Referral-Capability HTTP header. The returned ref_ code is public. Registration retry with the original capability returns the same account. Include only the public referral_code in paid invoke bodies.'});
async function capabilityHash(capability){if(!referralCapabilitySchema.safeParse(capability).success)throw new PlatformError(403,'referral_capability_invalid','No matching private referral capability.');return hash(capability);}
function accountView(row){return {api_version:'1',referral_code:row.referral_code,terms:JSON.parse(row.terms_json),created_at:row.created_at,payment_effect:'none',transfers_enabled:false};}

export async function registerReferral({db,body,capability,client,now=()=>new Date()}){
 const parsed=referralRegistrationSchema.safeParse(body);if(!parsed.success)throw new PlatformError(400,'invalid_referral_registration','Accept the published referral terms; no wallet, beneficiary or rate fields are accepted.');
 const commitment=await capabilityHash(capability),prior=()=>db.prepare('SELECT * FROM platform_referrers WHERE capability_hash=?').bind(commitment).first();
 const previous=await prior();if(previous)return accountView(previous);
 const date=now().toISOString(),day=date.slice(0,10)+'T00:00:00.000Z',clientHash=await hash(client??'unknown');
 await db.prepare(`INSERT OR IGNORE INTO platform_referrers(referral_code,capability_hash,terms_version,share_bps,terms_json,created_at,client_hash)
 SELECT ?,?,?,100,?,?,? WHERE (SELECT COUNT(*) FROM platform_referrers WHERE created_at>=?)<40
 AND (SELECT COUNT(*) FROM platform_referrers WHERE created_at>=? AND client_hash=?)<4`)
 .bind('ref_'+crypto.randomUUID(),commitment,REFERRAL_TERMS.terms_version,JSON.stringify(REFERRAL_TERMS),date,clientHash,day,day,clientHash).run();
 const saved=await prior();if(saved)return accountView(saved);
 throw new PlatformError(429,'referral_budget_exhausted','The referral registration budget is exhausted; retry later. No fee was charged.');
}

// The request body (including referral_code) must already be hash-bound by x402.
// Resolve only for new operations, before admission; replay uses its frozen row.
export async function referralBeneficiary({db,code,product,handler,creator}){
 const empty={referral_code:null,referral_terms_version:null,referral_share_bps:null};
 if(code===undefined)return empty;
 if(!referralCodeSchema.safeParse(code).success)throw new PlatformError(400,'invalid_referral_code','Use a registered public referral code.');
 if(!REFERRAL_PRODUCT_IDS.includes(product?.id)||product?.provider?.id!=='agenttoolbox'||product?.provider?.type!=='first_party'||!handler||handler.creatorAdapterId!=null||creator?.tool_id!=null||creator?.creator_id!=null||creator?.share_bps!=null)
  throw new PlatformError(400,'referral_product_ineligible','Referral commissions apply only to the four first-party AgentToolbox tools.');
 const entitlement=await db.prepare('SELECT tool_id FROM platform_creator_entitlements WHERE tool_id=?').bind(product.id).first();
 if(entitlement)throw new PlatformError(400,'referral_product_ineligible','Creator-owned tools are excluded from this referral pilot.');
 const row=await db.prepare('SELECT referral_code,terms_version,share_bps FROM platform_referrers WHERE referral_code=?').bind(code).first();
 if(!row)throw new PlatformError(400,'unknown_referral_code','This referral code is not registered. No purchase was admitted.');
 if(row.terms_version!==REFERRAL_TERMS.terms_version||row.share_bps!==100)throw new PlatformError(503,'referral_policy_unavailable','Referral terms require reconciliation before admitting a new purchase.');
 return {referral_code:row.referral_code,referral_terms_version:row.terms_version,referral_share_bps:row.share_bps};
}

export function referralAccrual(rows){
 let numerator=0n,gross=0n;const seen=new Set(),code=rows[0]?.referral_code;
 for(const row of rows){
  if(!referralCodeSchema.safeParse(row.referral_code).success||row.referral_code!==code||seen.has(row.operation_id)||!row.operation_id||row.terms_version!==REFERRAL_TERMS.terms_version||row.share_bps!==100||row.network!==BASE_NETWORK||row.asset!==BASE_USDC.toLowerCase()||typeof row.gross_atomic!=='string'||!isAtomicAmount(row.gross_atomic)||BigInt(row.gross_atomic)<=0n)throw new Error('Invalid, mixed or duplicate referral allocation; refusing inaccurate accrual.');
  seen.add(row.operation_id);gross+=BigInt(row.gross_atomic);numerator+=BigInt(row.gross_atomic)*BigInt(row.share_bps);
 }
 return {network:BASE_NETWORK,asset:BASE_USDC.toLowerCase(),gross_atomic:gross.toString(),share_bps:100,accrued_atomic:(numerator/10000n).toString(),fractional_atom_numerator:(numerator%10000n).toString(),fractional_atom_denominator:'10000',receipt_count:seen.size,paid_atomic:null,unpaid_atomic:null,transfer_status:'unavailable_no_payout_processor',receipt_basis:'facilitator_confirmed_not_independently_reconciled'};
}

export async function getReferral({db,capability}){
 const commitment=await capabilityHash(capability),row=await db.prepare('SELECT * FROM platform_referrers WHERE capability_hash=?').bind(commitment).first();
 if(!row)throw new PlatformError(403,'referral_capability_invalid','No matching private referral capability.');
 const allocations=await db.prepare('SELECT * FROM platform_referral_allocations WHERE referral_code=? ORDER BY operation_id').bind(row.referral_code).all();
 return {...accountView(row),accrual:referralAccrual(allocations.results)};
}
