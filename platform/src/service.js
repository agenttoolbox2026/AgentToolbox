import { z } from 'zod';
import { products, findProduct, catalogResult } from './registry.js';
import { hash, telemetry } from './telemetry.js';
import {isAtomicAmount,minimumAmount,MAX_UINT256} from './payment-config.js';
import {submitFeedback} from './feedback.js';
import {listReviews,readReview,listReplies,submitReview,submitReply} from './reviews.js';
import {successContractPin} from './contract-pins.js';
import {referralCodeSchema} from './referral-schema.js';
import {creatorBeneficiary} from './submissions.js';
export class PlatformError extends Error {
  constructor(status,code,message,details={}) { super(message); this.status=status;this.code=code;this.details=details; }
}
export function assertContractPins(expected,actual){
 for(const field of ['success_contract_sha256','payment_requirements_sha256'])if(expected[field]!==undefined&&expected[field]!==null&&expected[field]!==actual[field])
  throw new PlatformError(409,field==='success_contract_sha256'?'success_contract_mismatch':'payment_requirements_pin_mismatch','The pinned contract differs. Inspect current discovery before authorizing a new request.',{field,expected:expected[field],actual:actual[field]});
}
export const searchSchema=z.strictObject({q:z.string().max(120).default(''),status:z.enum(['active','validation','retired','all']).default('active')});
export const atomicAmountSchema=z.string().regex(/^(0|[1-9][0-9]{0,77})$/).refine(isAtomicAmount).describe('Canonical decimal USDC atomic-unit string (6 decimals). Protocol uint256 maximum '+MAX_UINT256+'. No business maximum.');
const sha256Schema=z.string().regex(/^[0-9a-f]{64}$/);
const pinFields={success_contract_sha256:sha256Schema.describe('Optional SHA-256 of the published canonical success contract. Mismatch prevents new work or payment. Quotes inherit their stored success pin even when this field is omitted.').optional(),payment_requirements_sha256:sha256Schema.describe('Optional SHA-256 of the complete canonical PaymentRequirements object under agenttoolbox-json-v1. Exact string/address case is significant.').optional()};
export const prepareSchema=z.strictObject({version:z.string().regex(/^\d+\.\d+\.\d+$/),input:z.record(z.string(),z.unknown()),request_id:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),prepare_secret_hash:sha256Schema,success_contract_sha256:pinFields.success_contract_sha256});
export const quoteSchema=z.strictObject({version:z.string().regex(/^\d+\.\d+\.\d+$/),payment_amount_atomic:atomicAmountSchema,input:z.record(z.string(),z.unknown()).optional(),prepared_id:z.uuid().optional(),...pinFields}).refine(v=>!!v.input!==!!v.prepared_id);
export const invokeSchema=z.strictObject({version:z.string().regex(/^\d+\.\d+\.\d+$/),input:z.record(z.string(),z.unknown()).optional(),prepared_id:z.uuid().optional(),quote_id:z.uuid().optional(),referral_code:referralCodeSchema.optional(),payment_amount_atomic:atomicAmountSchema.optional(),max_charge_usdc_atomic:z.union([atomicAmountSchema,z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)]).describe('Caller spending cap. Canonical decimal string recommended; safe integer numbers accepted for compatibility. Does not select an amount.'),agent_id:z.uuid().describe('Optional random UUID pseudonym (e.g. crypto.randomUUID()); not authenticated identity. Omit if unavailable.').optional(),review_secret_hash:z.string().regex(/^[0-9a-f]{64}$/).describe('Optional SHA-256 hex of caller-kept atbr_ secret (32 random bytes). Bound to this paid request; never send the raw secret here.').optional(),...pinFields}).refine(v=>!!v.input!==!!v.prepared_id);
export const outcomeSchema=z.strictObject({outcome:z.enum(['success','failure','unverifiable'])});
export function service({db,catalog=products,handlers={},channel='http',sampleKind='unclassified',feedbackAllowed=async()=>true,now=()=>new Date(),trackingEnabled=true}) {
  const metrics=telemetry(db,{channel,sampleKind,now,enabled:trackingEnabled});
  const get = id => {
    const p=findProduct(id,catalog); if(!p) throw new PlatformError(404,'product_not_found','No product has that identifier.');
    return p;
  };
  return {
    async reviews(productId,params){return listReviews({db,catalog,productId,params});},
    async review(reviewId,params){return readReview({db,reviewId,params});},
    async replies(reviewId,params){return listReplies({db,reviewId,params});},
    async submitReview(body,key){if(!await feedbackAllowed())throw new PlatformError(429,'rate_limited','Wait before submitting more reviews.');return submitReview({db,catalog,body,key,channel,sampleKind,now});},
    async reply(reviewId,body,key){if(!await feedbackAllowed())throw new PlatformError(429,'rate_limited','Wait before submitting more replies.');return submitReply({db,reviewId,body,key,channel,sampleKind,now});},
    async feedback(body,key){if(!await feedbackAllowed())throw new PlatformError(429,'rate_limited','Wait before submitting more feedback.');return submitFeedback({db,catalog,body,key,channel,sampleKind,now});},
    async list(params) { await metrics.record('catalog_view');return catalogResult(params,catalog); },
    async detail(id) { const p=get(id);await metrics.record('product_view',p);return {api_version:'1',product:p}; },
    async invoke(id,body,key) {
      const p=get(id); await metrics.record('invoke_attempt',p);
      if(p.status==='retired') { await metrics.record('retired_rejected',p);throw new PlatformError(410,'product_retired','This product is retired. No work was executed and no payment was requested.',{product_id:p.id,version:p.version,catalog_url:'/v1/products'}); }
      if(!['active','validation'].includes(p.status)) throw new PlatformError(503,'product_unavailable','This product cannot be invoked.');
      if(body.version!==p.version) throw new PlatformError(409,'version_mismatch','Inspect the current product contract before invoking.',{current_version:p.version});
      if(!handlers[id]) throw new PlatformError(503,'product_unavailable','No executable product handler is installed.');
      if(p.pricing.payments_enabled || minimumAmount(p)!==null) throw new PlatformError(402,'paid_http_required','Use the product HTTP endpoint with an x402-capable client.',{path:p.invocation?.path??'/v1/products/'+p.id+'/invoke',minimum_amount_atomic:minimumAmount(p),quote_path:'/v1/products/'+p.id+'/quote',network:p.pricing.network});
      if(!/^[A-Za-z0-9_-]{32,128}$/.test(key??'')) throw new PlatformError(400,'idempotency_key_required','Send an Idempotency-Key of 32–128 letters, digits, underscores or hyphens.');
      const handler=handlers[id], parsed=handler.input.safeParse(body.input);
      if(!parsed.success) throw new PlatformError(400,'invalid_input','Input does not match the product schema.');
      const inputHash=await hash(JSON.stringify({version:body.version,input:parsed.data,max_charge_usdc_atomic:body.max_charge_usdc_atomic,agent_id:body.agent_id??null,...(body.success_contract_sha256?{success_contract_sha256:body.success_contract_sha256}:{}),...(body.payment_requirements_sha256?{payment_requirements_sha256:body.payment_requirements_sha256}:{})}));
      const keyHash=await hash(key), date=now().toISOString(), runId=crypto.randomUUID();
      await db.prepare('DELETE FROM platform_runs WHERE expires_at < ?').bind(date).run();
      const prior=await db.prepare('SELECT * FROM platform_runs WHERE product_id=? AND version=? AND idempotency_hash=?').bind(p.id,p.version,keyHash).first();
      const replay = row => {
        if(row.input_hash!==inputHash) throw new PlatformError(409,'idempotency_conflict','This key was used for different inputs.');
        if(row.state!=='completed') throw new PlatformError(409,'run_not_completed','The original run is pending or failed. Do not submit a replacement payment.');
        return JSON.parse(row.result_json);
      };
      if(prior) return replay(prior);
      if(body.payment_requirements_sha256)throw new PlatformError(400,'payment_not_required','This free invocation has no PaymentRequirements object to pin.');
      const successPin=await successContractPin(p);assertContractPins(body,{success_contract_sha256:successPin.sha256});
      await creatorBeneficiary(db,p,handler);
      const callerHash=trackingEnabled&&body.agent_id?await hash(body.agent_id):null;
      const inserted=await db.prepare(`INSERT OR IGNORE INTO platform_runs(id,product_id,version,idempotency_hash,input_hash,caller_hash,created_at,expires_at,state,sample_kind) VALUES(?,?,?,?,?,?,?,?,'running',?)`)
        .bind(runId,p.id,p.version,keyHash,inputHash,callerHash,date,new Date(now().getTime()+86400000).toISOString(),sampleKind).run();
      if(!inserted.meta.changes) return replay(await db.prepare('SELECT * FROM platform_runs WHERE product_id=? AND version=? AND idempotency_hash=?').bind(p.id,p.version,keyHash).first());
      const started=Date.now();
      try {
        await creatorBeneficiary(db,p,handler);
        const output=await handler.run(parsed.data);
        const checked=handler.output.safeParse(output);
        if(!checked.success || !(await handler.success(checked.data))) throw new PlatformError(422,'outcome_not_met','The product success criterion was not met. No charge.');
        assertContractPins({success_contract_sha256:successPin.sha256},{success_contract_sha256:(await successContractPin(p)).sha256});
        const result={api_version:'1',run_id:runId,product_id:p.id,version:p.version,execution:'completed',
          success_criterion:p.outcome.success_criterion,evidence:'server_validated',output:checked.data,
          payment:{status:'not_required',amount_settled_atomic:0},outcome_url:`/v1/runs/${runId}/outcome`};
        const serialized=JSON.stringify(result);
        if(new TextEncoder().encode(serialized).length>16384) throw new PlatformError(422,'output_too_large','Product output exceeded its bound. No charge.');
        await db.prepare("UPDATE platform_runs SET state='completed',result_json=? WHERE id=?").bind(serialized,runId).run();
        await metrics.record('execution_success',p,Date.now()-started);
        if(callerHash) await db.prepare(`INSERT INTO platform_callers VALUES(?,?,?,?,?,?,1) ON CONFLICT(product_id,version,caller_hash,sample_kind) DO UPDATE SET last_day=excluded.last_day,completed_runs=completed_runs+1`).bind(p.id,p.version,callerHash,sampleKind,date.slice(0,10),date.slice(0,10)).run();
        return result;
      } catch(e) {
        await db.prepare("UPDATE platform_runs SET state='failed' WHERE id=? AND state='running'").bind(runId).run();
        await metrics.record('execution_failure',p,Date.now()-started);
        throw e instanceof PlatformError?e:new PlatformError(500,'execution_failed','The product could not complete. No charge.');
      }
    },
    async outcome(id,body) {
      let row=await db.prepare('SELECT * FROM platform_runs WHERE id=? AND expires_at>=?').bind(id,now().toISOString()).first();
      let table='platform_runs',idColumn='id';
      if(!row){row=await db.prepare('SELECT * FROM platform_payments WHERE operation_id=? AND result_expires_at>=?').bind(id,now().toISOString()).first();table='platform_payments';idColumn='operation_id';}
      if(!row) throw new PlatformError(404,'run_not_found','Run is unknown or expired.');
      if(!['completed','settled'].includes(row.state)) throw new PlatformError(409,'run_not_completed','Only completed runs accept outcome reports.');
      if(row.outcome && row.outcome!==body.outcome) throw new PlatformError(409,'outcome_conflict','An outcome was already reported.');
      if(!row.outcome) {
        const changed=await db.prepare('UPDATE '+table+' SET outcome=? WHERE '+idColumn+'=? AND outcome IS NULL').bind(body.outcome,id).run();
        if(changed.meta.changes) await telemetry(db,{channel,sampleKind:row.sample_kind,now,enabled:trackingEnabled}).record('outcome_'+body.outcome,{id:row.product_id,version:row.version});
        else { const latest=await db.prepare('SELECT outcome FROM '+table+' WHERE '+idColumn+'=?').bind(id).first();if(latest.outcome!==body.outcome) throw new PlatformError(409,'outcome_conflict','An outcome was already reported.'); }
      }
      return {run_id:id,outcome:body.outcome,evidence:'caller_reported',payment_effect:'none'};
    },
  };
}
