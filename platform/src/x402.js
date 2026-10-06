import {HTTPFacilitatorClient,x402ResourceServer} from '@x402/core/server';
import {ExactEvmScheme} from '@x402/evm/exact/server';
import {decodePaymentSignatureHeader,encodePaymentRequiredHeader,encodePaymentResponseHeader} from '@x402/core/http';
import {PlatformError} from './service.js';
import {hash,telemetry} from './telemetry.js';
export const BASE_NETWORK='eip155:8453';
export const BASE_USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const FACILITATOR='https://facilitator.payai.network';
export function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export async function sdkAdapter({payTo,amount,facilitatorClient}){
 const client=facilitatorClient??new HTTPFacilitatorClient({url:FACILITATOR,timeoutMs:10000});
 const server=new x402ResourceServer(client).register(BASE_NETWORK,new ExactEvmScheme());
 await server.initialize();
 const requirements=(await server.buildPaymentRequirements({scheme:'exact',network:BASE_NETWORK,payTo,
  price:{asset:BASE_USDC,amount:String(amount),extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009'}},
  maxTimeoutSeconds:300}))[0];
 if(requirements.network!==BASE_NETWORK||requirements.scheme!=='exact'||requirements.asset.toLowerCase()!==BASE_USDC.toLowerCase()||requirements.payTo.toLowerCase()!==payTo.toLowerCase()||requirements.amount!==String(amount))
  throw new PlatformError(503,'payment_configuration_error','Payment requirements do not match the product.');
 return {requirements,
  challenge:resource=>server.createPaymentRequiredResponse([requirements],{url:resource,description:'Validated product outcome',mimeType:'application/json'}),
  verify:payload=>server.verifyPayment(payload,requirements),
  settle:payload=>server.settlePayment(payload,requirements),
 };
}
function validatePayload(payload,requirements,nowSeconds){
 const a=payload?.payload?.authorization,accepted=payload?.accepted;
 if(payload?.x402Version!==2||!accepted||!a||typeof payload?.payload?.signature!=='string')
  throw new PlatformError(400,'invalid_payment','Use an x402 v2 exact EIP-3009 authorization.');
 if(accepted.scheme!=='exact'||accepted.network!==requirements.network||
  accepted.asset?.toLowerCase()!==requirements.asset.toLowerCase()||
  accepted.payTo?.toLowerCase()!==requirements.payTo.toLowerCase()||
  accepted.amount!==requirements.amount || accepted.maxTimeoutSeconds!==requirements.maxTimeoutSeconds ||
  canonical(accepted.extra??{})!==canonical(requirements.extra??{}))
  throw new PlatformError(400,'payment_requirements_mismatch','Payment does not match this product contract.');
 if(!/^0x[0-9a-fA-F]{40}$/.test(a.from??'')||!/^0x[0-9a-fA-F]{64}$/.test(a.nonce??'')||
    a.to?.toLowerCase()!==requirements.payTo.toLowerCase()||String(a.value)!==requirements.amount||
    !/^\d{1,12}$/.test(String(a.validAfter))||!/^\d{1,12}$/.test(String(a.validBefore))||
    Number(a.validAfter)>nowSeconds||Number(a.validBefore)<nowSeconds+30||Number(a.validBefore)>nowSeconds+600)
  throw new PlatformError(400,'invalid_authorization','Authorization recipient, amount or validity window is invalid.');
 return a;
}
export async function paidInvocation({request,body,key,product,handler,db,config,adapterFactory=sdkAdapter,now=()=>new Date()}){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/products/'+product.id+'/invoke')
  throw new PlatformError(405,'method_not_allowed','Paid products use their exact POST invocation path.');
 if(!config?.enabled||!config.receiverConfirmed||config.network!==BASE_NETWORK||!/^0x[0-9a-fA-F]{40}$/.test(config.payTo??''))
  throw new PlatformError(503,'payment_not_ready','Paid execution is not enabled or receiver/network verification is incomplete.');
 if(product.status!=='active'&&product.status!=='validation')throw new PlatformError(410,'product_retired','Retired products cannot charge.');
 if(body.version!==product.version)throw new PlatformError(409,'version_mismatch','Inspect the current product version.');
 if(!handler||!Number.isSafeInteger(product.pricing.amount_atomic)||product.pricing.amount_atomic<=0)
  throw new PlatformError(503,'product_unavailable','No paid execution contract is available.');
 if(body.max_charge_usdc_atomic<product.pricing.amount_atomic)throw new PlatformError(400,'charge_cap_exceeded','The product price exceeds the caller charge cap.');
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(key??''))throw new PlatformError(400,'idempotency_key_required','A stable Idempotency-Key is required.');
 const input=handler.input.safeParse(body.input);if(!input.success)throw new PlatformError(400,'invalid_input','Input does not match the product schema.');
 const adapter=await adapterFactory({payTo:config.payTo,amount:product.pricing.amount_atomic});
 const signature=request.headers.get('PAYMENT-SIGNATURE');
 const sampleKind=request.headers.get('X-AgentToolbox-Sample')==='synthetic'?'synthetic':'unclassified';
 const metrics=telemetry(db,{sampleKind,now});
 if(!signature){
  const challenge=await adapter.challenge(request.url);await metrics.record('payment_required',product);
  return Response.json({error:{code:'payment_required',message:'Authorize the disclosed amount for this product. Settlement follows validated success.'},payment:challenge},
   {status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(challenge),'Cache-Control':'no-store'}});
 }
 if(signature.length>12288)throw new PlatformError(413,'payment_header_too_large','Payment header exceeds its bound.');
 let payload;try{payload=decodePaymentSignatureHeader(signature);}catch{throw new PlatformError(400,'invalid_payment','Malformed payment header.');}
 const authorization=validatePayload(payload,adapter.requirements,Math.floor(now().getTime()/1000));
 const fingerprint=await hash(canonical({method:'POST',path:new URL(request.url).pathname,product:product.id,version:product.version,body:{...body,input:input.data},requirements:adapter.requirements,facilitator:FACILITATOR}));
 const paymentDigest=await hash(canonical(payload)),keyHash=await hash(key);
 const previous=await db.prepare('SELECT * FROM platform_payments WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,product.version,keyHash).first();
 const replay=row=>{
  if(row.fingerprint!==fingerprint||row.payment_digest!==paymentDigest)throw new PlatformError(409,'payment_replay_conflict','This operation is bound to another request or authorization. Do not create a replacement charge.');
  if(row.state==='settled')return Response.json(JSON.parse(row.result_json),{headers:{'PAYMENT-RESPONSE':encodePaymentResponseHeader(JSON.parse(row.settlement_json))}});
  if(row.state==='failed')throw new PlatformError(422,'outcome_not_met','This operation did not meet its success criterion. No settlement was requested.');
  throw new PlatformError(503,'settlement_unresolved','The operation is in progress or requires reconciliation. Reuse this request; do not issue a new authorization.',{operation_id:row.operation_id});
 };
 if(previous)return replay(previous);
 const verified=await adapter.verify(payload);
 if(!verified.isValid||verified.payer?.toLowerCase()!==authorization.from.toLowerCase())
  throw new PlatformError(402,'payment_invalid','The facilitator did not verify this authorization.');
 const operationId=crypto.randomUUID(),date=now().toISOString();
 const inserted=await db.prepare(`INSERT OR IGNORE INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'executing',?,?,?)`)
  .bind(operationId,product.id,product.version,keyHash,fingerprint,paymentDigest,BASE_NETWORK,BASE_USDC.toLowerCase(),authorization.from.toLowerCase(),authorization.nonce.toLowerCase(),adapter.requirements.amount,config.payTo.toLowerCase(),date,date,sampleKind).run();
 if(!inserted.meta.changes){
  const row=await db.prepare('SELECT * FROM platform_payments WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,product.version,keyHash).first();
  if(row)return replay(row);
  throw new PlatformError(409,'authorization_already_used','This authorization is already bound to another operation.');
 }
 await metrics.record('payment_verified',product);
 const ledger=async(event,amount='0',transaction=null)=>db.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),operationId,product.id,product.version,event,BASE_NETWORK,BASE_USDC,amount,transaction,sampleKind,now().toISOString()).run();
 let output;
 try{
  const result=await handler.run(input.data),checked=handler.output.safeParse(result);
  if(!checked.success||!await handler.success(checked.data))throw new Error('criterion');
  output={api_version:'1',operation_id:operationId,product_id:product.id,version:product.version,execution:'completed',evidence:'server_validated',output:checked.data};
  if(new TextEncoder().encode(JSON.stringify(output)).length>16384)throw new Error('output_bound');
 }catch{
  await db.prepare("UPDATE platform_payments SET state='failed',updated_at=? WHERE operation_id=?").bind(now().toISOString(),operationId).run();
  await ledger('outcome_failed');await metrics.record('execution_failure',product);
  throw new PlatformError(422,'outcome_not_met','The disclosed outcome was not met. No settlement was requested.');
 }
 // Durable output and intent must succeed before the only settlement call.
 await db.prepare("UPDATE platform_payments SET state='outcome_ready',result_json=?,updated_at=? WHERE operation_id=?").bind(JSON.stringify(output),now().toISOString(),operationId).run();
 await ledger('outcome_validated');await metrics.record('execution_success',product);
 const claim=await db.prepare("UPDATE platform_payments SET state='settling',updated_at=? WHERE operation_id=? AND state='outcome_ready'").bind(now().toISOString(),operationId).run();
 if(!claim.meta.changes)throw new PlatformError(503,'settlement_unresolved','Settlement state changed; reconciliation is required.');
 await ledger('settlement_intent');
 let receipt;
 try{receipt=await adapter.settle(payload);}
 catch{
  await db.prepare("UPDATE platform_payments SET state='unknown',updated_at=? WHERE operation_id=?").bind(now().toISOString(),operationId).run();
  await ledger('settlement_unknown');
  throw new PlatformError(503,'settlement_unresolved','Settlement outcome is unknown. No replacement charge; operator reconciliation is required.',{operation_id:operationId});
 }
 if(!receipt.success||receipt.network!==BASE_NETWORK||!/^0x[0-9a-fA-F]{64}$/.test(receipt.transaction??'')||receipt.payer?.toLowerCase()!==authorization.from.toLowerCase()||(receipt.amount!==undefined&&receipt.amount!==adapter.requirements.amount)){
  await db.prepare("UPDATE platform_payments SET state='unknown',settlement_json=?,updated_at=? WHERE operation_id=?").bind(JSON.stringify(receipt),now().toISOString(),operationId).run();
  await ledger('settlement_unconfirmed');await metrics.record('payment_failed',product);
  throw new PlatformError(503,'settlement_unresolved','Payment was not confirmed. No output release or new authorization; reconcile this operation.');
 }
 output.payment={status:'facilitator_confirmed',network:BASE_NETWORK,asset:BASE_USDC,amount_settled_atomic:adapter.requirements.amount,transaction:receipt.transaction,onchain_reconciled:false};
 // Ledger before settled state. Failure here leaves settling, so replay cannot expose output or charge again.
 await ledger('settlement_reported',adapter.requirements.amount,receipt.transaction);
 await db.prepare("UPDATE platform_payments SET state='settled',result_json=?,settlement_json=?,updated_at=? WHERE operation_id=? AND state='settling'")
  .bind(JSON.stringify(output),JSON.stringify(receipt),now().toISOString(),operationId).run();
 await metrics.record('payment_settled',product);
 return Response.json(output,{headers:{'PAYMENT-RESPONSE':encodePaymentResponseHeader(receipt)}});
}
