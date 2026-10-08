import {z} from 'zod';
import {hash} from './telemetry.js';
import {PlatformError} from './service.js';
export const feedbackSchema=z.strictObject({
 product_id:z.string().regex(/^[a-z0-9-]{1,64}$/),
 version:z.string().max(32).regex(/^\d+\.\d+\.\d+$/).optional(),
 reference:z.strictObject({kind:z.enum(['example','purchase','run']),id:z.uuid()}).optional(),
 rating:z.number().int().min(1).max(5).optional(),
 outcome:z.enum(['success','failure','unverifiable']).optional(),helpful:z.boolean().optional(),
 task_description:z.string().trim().min(1).max(1000).optional(),
 message:z.string().trim().min(1).max(2000).optional(),
});
export const validKey=key=>/^[A-Za-z0-9_-]{32,128}$/.test(key??'');
export const suspicious=/(?:atb[cfpr]_[A-Za-z0-9_-]{43}|-----BEGIN[^\n]*PRIVATE KEY|\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b|\bBearer\s+\S+|\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|0x[0-9a-fA-F]{64,}|(?:payment.signature|private.key|seed.phrase|password|api.key)\s*[:=])/i;
function acknowledgment(row){return {feedback_id:row.id,product_id:row.product_id,version:row.version,
 evidence:{link:row.link_status,execution_state:row.execution_state,identity:'unverified',feedback:'self_reported'},payment_effect:'none'};}
export async function submitFeedback({db,catalog,body,key,channel='http',sampleKind='unclassified',now=()=>new Date()}){
 if(!validKey(key))throw new PlatformError(400,'idempotency_key_required','Send a 32–128 character Idempotency-Key.');
 const parsed=feedbackSchema.safeParse(body);if(!parsed.success)throw new PlatformError(400,'invalid_input','Use the published feedback schema.');
 const data=parsed.data,product=catalog.find(p=>p.id===data.product_id);
 if(!product)throw new PlatformError(404,'product_not_found','No product has that identifier.');
 if(!['rating','outcome','helpful','task_description','message'].some(k=>data[k]!==undefined))throw new PlatformError(400,'feedback_empty','Include at least one feedback field.');
 if(suspicious.test((data.message??'')+'\n'+(data.task_description??'')))throw new PlatformError(400,'sensitive_content','Remove credentials, signatures and secrets before submitting.');
 const version=data.version??product.version,keyHash=await hash(key),fingerprint=await hash(JSON.stringify({...data,version}));
 const previous=await db.prepare('SELECT * FROM platform_feedback WHERE key_hash=?').bind(keyHash).first();
 const replay=row=>{if(row.fingerprint!==fingerprint)throw new PlatformError(409,'idempotency_conflict','This key belongs to different feedback.');return acknowledgment(row);};
 if(previous)return replay(previous);
 let linked=null;
 if(data.reference){
  const {kind,id}=data.reference;
  const query=kind==='example'?'SELECT * FROM platform_examples WHERE id=?':kind==='purchase'?'SELECT * FROM platform_payments WHERE operation_id=?':'SELECT * FROM platform_runs WHERE id=?';
  const row=await db.prepare(query).bind(id).first();
  if(row&&row.product_id===product.id&&row.version===version&&['completed','failed','settled'].includes(row.state))linked=row;
 }
 if(version!==product.version&&!linked)throw new PlatformError(409,'version_mismatch','Use the current product version or a matching real execution reference.');
 const classification=sampleKind==='synthetic'||linked?.sample_kind==='synthetic'||(data.reference?.kind==='purchase'&&linked?.is_live===0)?'synthetic':linked?.payer&&linked.payer===linked.receiver?'owner':'unclassified';
 const id=crypto.randomUUID();
 const result=await db.prepare(`INSERT OR IGNORE INTO platform_feedback(id,key_hash,fingerprint,product_id,version,channel,reference_kind,reference_id,execution_state,link_status,sample_kind,rating,outcome,helpful,task_description,message,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(id,keyHash,fingerprint,product.id,version,channel,data.reference?.kind??null,linked?data.reference.id:null,linked?.state??null,linked?'server_record_linked':'unverified',classification,data.rating??null,data.outcome??null,data.helpful===undefined?null:Number(data.helpful),data.task_description??null,data.message??null,now().toISOString()).run();
 const saved=await db.prepare('SELECT * FROM platform_feedback WHERE key_hash=?').bind(keyHash).first();
 if(!saved)throw new Error('feedback_storage_unavailable');
 return result.meta.changes?acknowledgment(saved):replay(saved);
}
