import {PlatformError,prepareSchema,quoteSchema,assertContractPins} from './service.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';
import {minimumAmount,paymentRequirements} from './payment-config.js';
import {CANONICAL_JSON_PROFILE,successContractPin,contractPins} from './contract-pins.js';
export {PREPARATION_LIMITS} from './preparation-limits.js';
// Creator adapter IDs identify immutable installed revisions; metadata approval never changes them.
export const minimumPolicy=(product,handler)=>`${product.version}:${minimumAmount(product)}`+(typeof handler?.creatorAdapterId==='string'?':adapter:'+handler.creatorAdapterId:'');
export async function capabilityHash(request){
 const secret=request.headers.get('X-Preparation-Capability');
 if(!/^atbp_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(secret??''))throw new PlatformError(403,'preparation_capability_required','Keep a client-generated 32-byte atbp_ capability; send it only in X-Preparation-Capability.');
 return hash(secret);
}
export async function preparedRecord({db,request,id,product,now=new Date(),allowClaimed=false}){
 const supplied=await capabilityHash(request),row=await db.prepare('SELECT * FROM platform_preparations WHERE prepared_id=? AND product_id=? AND version=?').bind(id,product.id,product.version).first();
 if(!row||row.capability_hash!==supplied)throw new PlatformError(403,'preparation_capability_invalid','No matching preparation capability.');
 if(!allowClaimed&&row.expires_at<=now.toISOString())throw new PlatformError(410,'preparation_expired','This unpaid preparation expired.');
 if(!allowClaimed&&row.state!=='ready')throw new PlatformError(409,'preparation_unavailable','This preparation is not ready or is already bound to a purchase.');
 if(!row.success_contract_sha256)throw new PlatformError(409,'preparation_unpinned','This legacy preparation has no saved success contract. Generate a new preparation before purchasing.');
 assertContractPins(row,{success_contract_sha256:(await successContractPin(product)).sha256});
 return row;
}
function contract(product,handler,config){
 if(!handler||!paymentRequirements(product,config))throw new PlatformError(503,'payment_not_ready','No configured paid contract.');
}
const validate=(schema,value)=>{const p=schema.safeParse(value);if(!p.success)throw new PlatformError(400,'invalid_input','Use the published schema.');return p.data;};
export async function prepareResult({db,request,body,product,handler,config,client,now=()=>new Date()}){
 contract(product,handler,config);
 if(!handler.preview)throw new PlatformError(409,'preview_unavailable','This tool has no safe limited preview. Inspect its contract and use direct invocation.');
 const data=validate(prepareSchema,body);if(data.version!==product.version)throw new PlatformError(409,'version_mismatch','Inspect the current version.');
 const secretHash=await capabilityHash(request);if(secretHash!==data.prepare_secret_hash)throw new PlatformError(403,'preparation_capability_invalid','Capability does not match its commitment.');
 const successPin=await successContractPin(product);assertContractPins(data,{success_contract_sha256:successPin.sha256});
 const input=validate(handler.input,data.input),date=now(),iso=date.toISOString(),day=iso.slice(0,10)+'T00:00:00.000Z';
 const requestHash=await hash(canonical({...data,input})),keyHash=await hash(data.request_id),clientHash=await hash(client),inputHash=await hash(canonical(input));
 const prior=await db.prepare('SELECT * FROM platform_preparations WHERE product_id=? AND version=? AND request_key_hash=?').bind(product.id,product.version,keyHash).first();
 const view=row=>{if(row.capability_hash!==secretHash||row.request_hash!==requestHash)throw new PlatformError(409,'preparation_conflict','Keep the original request and capability.');assertContractPins(row,{success_contract_sha256:successPin.sha256});if(row.expires_at<=iso)throw new PlatformError(410,'preparation_expired','Preparation expired.');if(row.state!=='ready')throw new PlatformError(409,'preparation_unavailable','Preparation is pending, failed or purchased.');return {prepared_id:row.prepared_id,expires_at:row.expires_at,contract_pins:{canonicalization:CANONICAL_JSON_PROFILE.id,success_contract_sha256:row.success_contract_sha256??null},preview:JSON.parse(row.preview_json),pricing:{minimum_amount_atomic:minimumAmount(product),decimals:6},payment_effect:'none'};};
 if(prior)return view(prior);
 const id=crypto.randomUUID(),expires=new Date(date.getTime()+900000).toISOString();
 // Atomic admission before any subsidized work; even failed attempts consume today's budget.
 const admitted=await db.prepare(`INSERT OR IGNORE INTO platform_preparations(prepared_id,product_id,version,request_hash,request_key_hash,capability_hash,client_hash,input_hash,state,created_at,expires_at,success_contract_sha256)
 SELECT ?,?,?,?,?,?,?,?,'preparing',?,?,? WHERE
 (SELECT COUNT(*) FROM platform_preparations WHERE created_at>=?)<50 AND
 (SELECT COUNT(*) FROM platform_preparations WHERE created_at>=? AND client_hash=?)<10 AND
 (SELECT COUNT(*) FROM platform_preparations WHERE expires_at>? AND state IN ('preparing','ready'))<16`).bind(id,product.id,product.version,requestHash,keyHash,secretHash,clientHash,inputHash,iso,expires,successPin.sha256,day,day,clientHash,iso).run();
 if(admitted.meta.changes!==1){const raced=await db.prepare('SELECT * FROM platform_preparations WHERE product_id=? AND version=? AND request_key_hash=?').bind(product.id,product.version,keyHash).first();if(raced)return view(raced);throw new PlatformError(429,'preparation_budget_exhausted','The bounded free preparation budget is exhausted. Use direct paid invocation or retry later.');}
 try{
  const result=validate(handler.output,await handler.run(input));if(!await handler.success(result))throw new Error('criterion');
  assertContractPins({success_contract_sha256:successPin.sha256},{success_contract_sha256:(await successContractPin(product)).sha256});
  const serialized=JSON.stringify(result);if(new TextEncoder().encode(serialized).length>14000)throw new Error('result_bound');
  const preview=handler.preview(result);if(new TextEncoder().encode(JSON.stringify(preview)).length>2000)throw new Error('preview_bound');
  const updated=await db.prepare("UPDATE platform_preparations SET state='ready',result_hash=?,result_json=?,preview_json=? WHERE prepared_id=? AND state='preparing'").bind(await hash(canonical(result)),serialized,JSON.stringify(preview),id).run();
  if(updated.meta.changes!==1)throw new Error('write_failed');
  return view({capability_hash:secretHash,request_hash:requestHash,prepared_id:id,expires_at:expires,state:'ready',preview_json:JSON.stringify(preview),success_contract_sha256:successPin.sha256});
 }catch(e){await db.prepare("UPDATE platform_preparations SET state='failed' WHERE prepared_id=? AND state='preparing'").bind(id).run();if(e instanceof PlatformError&&e.code==='success_contract_mismatch')throw e;throw new PlatformError(422,'preparation_failed','Preparation did not produce a validated result. No payment was requested.');}
}
export async function createQuote({db,request,body,product,handler,config,now=()=>new Date()}){
 contract(product,handler,config);const data=validate(quoteSchema,body);
 if(data.version!==product.version)throw new PlatformError(409,'version_mismatch','Inspect the current version.');
 const terms=paymentRequirements(product,config,data.payment_amount_atomic);if(!terms)throw new PlatformError(400,'amount_below_minimum','Choose at least the published minimum.');
 const pins=await contractPins(product,terms);assertContractPins(data,pins);
 const date=now(),iso=date.toISOString();let prepared;
 if(data.prepared_id){prepared=await preparedRecord({db,request,id:data.prepared_id,product,now:date});assertContractPins(prepared,pins);}
 const inputHash=prepared?.input_hash??await hash(canonical(validate(handler.input,data.input)));
 const expires=prepared?.expires_at??new Date(date.getTime()+900000).toISOString(),id=crypto.randomUUID();
 const saved=await db.prepare(`INSERT INTO platform_quotes(quote_id,product_id,version,input_hash,result_hash,prepared_id,capability_hash,amount_atomic,minimum_policy,requirements_json,created_at,expires_at,success_contract_sha256)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM platform_quotes WHERE created_at>=?)<200`).bind(id,product.id,product.version,inputHash,prepared?.result_hash??null,prepared?.prepared_id??null,prepared?.capability_hash??null,terms.amount,minimumPolicy(product,handler),canonical(terms),iso,expires,pins.success_contract_sha256,iso.slice(0,10)+'T00:00:00.000Z').run();
 if(saved.meta.changes!==1)throw new PlatformError(429,'quote_budget_exhausted','Daily quote budget exhausted.');
 return {quote_id:id,expires_at:expires,contract_pins:pins,product_id:product.id,version:product.version,payment_amount_atomic:terms.amount,minimum_amount_atomic:minimumAmount(product),prepared_id:prepared?.prepared_id??null,terms};
}
export async function loadQuote({db,request,body,product,handler,config,now=new Date()}){
 const row=await db.prepare('SELECT * FROM platform_quotes WHERE quote_id=?').bind(body.quote_id).first();
 if(!row||row.product_id!==product.id||row.version!==product.version||row.amount_atomic!==body.payment_amount_atomic||row.prepared_id!==(body.prepared_id??null))throw new PlatformError(409,'quote_mismatch','Quote is bound to another product, input or chosen amount.');
 if(row.operation_id)throw new PlatformError(409,'quote_already_claimed','Reuse the original paid request and authorization.');
 if(!row.success_contract_sha256)throw new PlatformError(409,'quote_unpinned','This legacy quote has no saved success contract. Obtain a new quote before authorizing payment.');
 if(row.expires_at<=now.toISOString())throw new PlatformError(410,'quote_expired','Request a fresh quote before authorizing payment.');
 const current=paymentRequirements(product,config,body.payment_amount_atomic);
 if(row.minimum_policy!==minimumPolicy(product,handler)||canonical(current)!==row.requirements_json)throw new PlatformError(409,'quote_terms_changed','Request a current quote before authorizing payment.');
 assertContractPins(row,{success_contract_sha256:(await successContractPin(product)).sha256});
 let prepared,input;
 if(row.prepared_id){prepared=await preparedRecord({db,request,id:row.prepared_id,product,now});if(prepared.result_hash!==row.result_hash||prepared.capability_hash!==row.capability_hash)throw new PlatformError(409,'quote_mismatch','Prepared result differs from quote.');}
 else input=validate(handler.input,body.input);
 if((prepared?.input_hash??await hash(canonical(input)))!==row.input_hash)throw new PlatformError(409,'quote_mismatch','Input differs from quote.');
 return {terms:JSON.parse(row.requirements_json),input,prepared,success_contract_sha256:row.success_contract_sha256??null};
}
export async function expirePreparations(db,now=new Date(),{preserveRecords=false}={}){
 const iso=now.toISOString(),previousDay=new Date(now.getTime()-86400000).toISOString();
 if(!preserveRecords){
  await db.prepare('DELETE FROM platform_quotes WHERE operation_id IS NULL AND expires_at<? AND created_at<?').bind(iso,previousDay).run();
  await db.prepare('DELETE FROM platform_preparations WHERE operation_id IS NULL AND expires_at<? AND created_at<? AND NOT EXISTS(SELECT 1 FROM platform_quotes q WHERE q.prepared_id=platform_preparations.prepared_id)').bind(iso,previousDay).run();
 }
 // Uncertain settlement keeps its durable result; settled/failed outputs follow paid retention.
 await db.prepare("UPDATE platform_preparations SET result_json=NULL,preview_json=NULL WHERE operation_id IN (SELECT operation_id FROM platform_payments WHERE state IN ('settled','failed') AND result_expires_at<?)").bind(iso).run();
}
