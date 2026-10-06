import { z } from 'zod';
import { products, findProduct, catalogResult } from './registry.js';
import { hash, telemetry } from './telemetry.js';
import {submitFeedback} from './feedback.js';
export class PlatformError extends Error {
  constructor(status,code,message,details={}) { super(message); this.status=status;this.code=code;this.details=details; }
}
export const searchSchema=z.strictObject({q:z.string().max(120).default(''),status:z.enum(['active','validation','retired','all']).default('active')});
export const invokeSchema=z.strictObject({version:z.string().regex(/^\d+\.\d+\.\d+$/),input:z.record(z.string(),z.unknown()),max_charge_usdc_atomic:z.number().int().min(0).max(1000000000),agent_id:z.uuid().optional()});
export const outcomeSchema=z.strictObject({outcome:z.enum(['success','failure','unverifiable'])});
export function service({db,catalog=products,handlers={},channel='http',sampleKind='unclassified',feedbackAllowed=async()=>true,now=()=>new Date()}) {
  const metrics=telemetry(db,{channel,sampleKind,now});
  const get = id => {
    const p=findProduct(id,catalog); if(!p) throw new PlatformError(404,'product_not_found','No product has that identifier.');
    return p;
  };
  return {
    async feedback(body,key){if(!await feedbackAllowed())throw new PlatformError(429,'rate_limited','Wait before submitting more feedback.');return submitFeedback({db,catalog,body,key,channel,sampleKind,now});},
    async list(params) { await metrics.record('catalog_view');return catalogResult(params,catalog); },
    async detail(id) { const p=get(id);await metrics.record('product_view',p);return {api_version:'1',product:p}; },
    async invoke(id,body,key) {
      const p=get(id); await metrics.record('invoke_attempt',p);
      if(p.status==='retired') { await metrics.record('retired_rejected',p);throw new PlatformError(410,'product_retired','This product is retired. No work was executed and no payment was requested.',{product_id:p.id,version:p.version,catalog_url:'/v1/products'}); }
      if(!['active','validation'].includes(p.status)) throw new PlatformError(503,'product_unavailable','This product cannot be invoked.');
      if(body.version!==p.version) throw new PlatformError(409,'version_mismatch','Inspect the current product contract before invoking.',{current_version:p.version});
      if(!handlers[id]) throw new PlatformError(503,'product_unavailable','No executable product handler is installed.');
      if(p.pricing.payments_enabled || p.pricing.amount_atomic>0) throw new PlatformError(402,'paid_http_required','Use the product HTTP endpoint with an x402-capable client.',{path:p.invocation?.path??'/v1/products/'+p.id+'/invoke',amount_atomic:p.pricing.amount_atomic,network:p.pricing.network});
      if(!/^[A-Za-z0-9_-]{32,128}$/.test(key??'')) throw new PlatformError(400,'idempotency_key_required','Send an Idempotency-Key of 32–128 letters, digits, underscores or hyphens.');
      const handler=handlers[id], parsed=handler.input.safeParse(body.input);
      if(!parsed.success) throw new PlatformError(400,'invalid_input','Input does not match the product schema.');
      const inputHash=await hash(JSON.stringify({version:body.version,input:parsed.data,max_charge_usdc_atomic:body.max_charge_usdc_atomic,agent_id:body.agent_id??null}));
      const keyHash=await hash(key), date=now().toISOString(), runId=crypto.randomUUID();
      await db.prepare('DELETE FROM platform_runs WHERE expires_at < ?').bind(date).run();
      const prior=await db.prepare('SELECT * FROM platform_runs WHERE product_id=? AND version=? AND idempotency_hash=?').bind(p.id,p.version,keyHash).first();
      const replay = row => {
        if(row.input_hash!==inputHash) throw new PlatformError(409,'idempotency_conflict','This key was used for different inputs.');
        if(row.state!=='completed') throw new PlatformError(409,'run_not_completed','The original run is pending or failed. Do not submit a replacement payment.');
        return JSON.parse(row.result_json);
      };
      if(prior) return replay(prior);
      const callerHash=body.agent_id?await hash(body.agent_id):null;
      const inserted=await db.prepare(`INSERT OR IGNORE INTO platform_runs(id,product_id,version,idempotency_hash,input_hash,caller_hash,created_at,expires_at,state,sample_kind) VALUES(?,?,?,?,?,?,?,?,'running',?)`)
        .bind(runId,p.id,p.version,keyHash,inputHash,callerHash,date,new Date(now().getTime()+86400000).toISOString(),sampleKind).run();
      if(!inserted.meta.changes) return replay(await db.prepare('SELECT * FROM platform_runs WHERE product_id=? AND version=? AND idempotency_hash=?').bind(p.id,p.version,keyHash).first());
      const started=Date.now();
      try {
        const output=await handler.run(parsed.data);
        const checked=handler.output.safeParse(output);
        if(!checked.success || !(await handler.success(checked.data))) throw new PlatformError(422,'outcome_not_met','The product success criterion was not met. No charge.');
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
        if(changed.meta.changes) await telemetry(db,{channel,sampleKind:row.sample_kind,now}).record('outcome_'+body.outcome,{id:row.product_id,version:row.version});
        else { const latest=await db.prepare('SELECT outcome FROM '+table+' WHERE '+idColumn+'=?').bind(id).first();if(latest.outcome!==body.outcome) throw new PlatformError(409,'outcome_conflict','An outcome was already reported.'); }
      }
      return {run_id:id,outcome:body.outcome,evidence:'caller_reported',payment_effect:'none'};
    },
  };
}
