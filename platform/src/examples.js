import {hash} from './telemetry.js';
import {PlatformError} from './service.js';
import {validKey} from './feedback.js';
export async function runExample({db,product,handler,key,sampleKind='unclassified',now=()=>new Date()}){
 if(key&&!validKey(key))throw new PlatformError(400,'idempotency_key_required','Use a 32–128 character Idempotency-Key for replay, or omit it for a new example.');
 const keyHash=key?await hash(key):null;
 const replay=row=>{
  if(row.state==='running')throw new PlatformError(409,'example_in_progress','This example is still in progress. Reuse its key.',{example_id:row.id});
  if(row.state==='failed')throw new PlatformError(422,'example_unavailable','This example failed its contract.',{example_id:row.id,reason:row.failure_code});
  if(!row.result_json||row.result_expires_at<now().toISOString())throw new PlatformError(410,'example_result_expired','The result expired. Use a new key for a new free example.',{example_id:row.id});
  return JSON.parse(row.result_json);
 };
 if(keyHash){const previous=await db.prepare('SELECT * FROM platform_examples WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,product.version,keyHash).first();if(previous)return replay(previous);}
 const id=crypto.randomUUID(),date=now().toISOString();
 const created=await db.prepare(`INSERT OR IGNORE INTO platform_examples(id,product_id,version,key_hash,state,sample_kind,created_at,updated_at,result_expires_at) VALUES(?,?,?,?,'running',?,?,?,?)`)
  .bind(id,product.id,product.version,keyHash,sampleKind,date,date,new Date(now().getTime()+86400000).toISOString()).run();
 if(!created.meta.changes)return replay(await db.prepare('SELECT * FROM platform_examples WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,product.version,keyHash).first());
 const started=Date.now();let result;
 try{
  const output=await handler.run(handler.input.parse(product.example_input));
  if(!handler.output.safeParse(output).success||!await handler.success(output))throw new Error('example_contract_failed');
  result={example:true,example_id:id,product_id:product.id,version:product.version,payment:{status:'not_required',amount_settled_atomic:0},output,
   feedback:{url:'/v1/feedback',reference:{kind:'example',id}},result_expires_at:new Date(now().getTime()+86400000).toISOString()};
  if(new TextEncoder().encode(JSON.stringify(result)).length>16384)throw new Error('example_output_too_large');
 }catch(e){
  const reason=handler.failureReason?.(e)??'example_failed';
  await db.prepare("UPDATE platform_examples SET state='failed',failure_code=?,duration_ms=?,updated_at=? WHERE id=? AND state='running'").bind(reason,Date.now()-started,now().toISOString(),id).run();
  throw new PlatformError(422,'example_unavailable','Example did not meet its contract.',{example_id:id,reason});
 }
 await db.prepare("UPDATE platform_examples SET state='completed',result_json=?,duration_ms=?,updated_at=? WHERE id=? AND state='running'").bind(JSON.stringify(result),Date.now()-started,now().toISOString(),id).run();
 return result;
}
