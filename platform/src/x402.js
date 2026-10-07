import {HTTPFacilitatorClient,x402ResourceServer} from '@x402/core/server';
import {ExactEvmScheme} from '@x402/evm/exact/server';
import {decodePaymentSignatureHeader,encodePaymentRequiredHeader,encodePaymentResponseHeader} from '@x402/core/http';
import {PlatformError,invokeSchema,quoteSchema,assertContractPins} from './service.js';
import {z} from 'zod';
import {BASE_NETWORK,BASE_USDC,FACILITATOR,paymentRequirements,minimumAmount,MAX_UINT256} from './payment-config.js';
export {BASE_NETWORK,BASE_USDC,FACILITATOR} from './payment-config.js';
import {hash,telemetry} from './telemetry.js';
import {expirePaidResults} from './purchases.js';
import {createQuote,loadQuote,minimumPolicy,capabilityHash} from './preparations.js';
import {creatorBeneficiary} from './submissions.js';
import {referralBeneficiary} from './referrals.js';
import {contractPins,paymentRequirementsPin} from './contract-pins.js';
// Preserve the historical fingerprint serializer byte-for-byte. The stricter
// published contract/payment pin profile lives separately in contract-pins.js.
export function canonical(value) {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function invocationJsonSchema(product){
 const schema=z.toJSONSchema(invokeSchema);
 schema.properties.version={type:'string',const:product.version};
 if(product.input_schema)schema.properties.input=product.input_schema;
 schema.properties.payment_amount_atomic.description+=' Product minimum: '+minimumAmount(product)+'. Must equal the exact quoted/signed amount.';
 return schema;
}
export function paymentChallenge(product,requirements,origin){
 const input={type:'http',method:'POST',bodyType:'json',body:{version:product.version,input:product.example_input??{},payment_amount_atomic:requirements.amount,max_charge_usdc_atomic:requirements.amount}};
 const inputSchema={type:'object',properties:{type:{const:'http'},method:{const:'POST'},bodyType:{const:'json'},body:invocationJsonSchema(product)},required:['type','method','bodyType','body'],additionalProperties:false};
 const outputSchema={type:'object',properties:{type:{const:'json'},example:product.output_schema??{type:'object'}},required:['type'],additionalProperties:false};
 return {x402Version:2,error:'PAYMENT-SIGNATURE header is required',
  resource:{url:new URL('/v1/products/'+product.id+'/invoke',origin).href,description:product.summary??'Validated product outcome',mimeType:'application/json',serviceName:'AgentToolbox'},
  accepts:[requirements],...(requirements.amount===minimumAmount(product)?{extensions:{bazaar:{info:{input,output:{type:'json'}},schema:{type:'object',properties:{input:inputSchema,output:outputSchema},required:['input'],additionalProperties:false}}}}:{} )};
}
export async function discoveryChallenge({product,config,origin}){
 const terms=paymentRequirements(product,config);
 if(!terms)throw new PlatformError(503,'payment_not_ready','No configured payment requirements for this product.');
 const payment=paymentChallenge(product,terms,origin),pins=await contractPins(product,terms);
 return Response.json({error:{code:'payment_required',message:'Authorize the disclosed amount for this product. Settlement follows validated success.'},discovery_only:true,invoke_method:'POST',payment,contract_pins:pins,payment_requirements_pin:await paymentRequirementsPin(terms)},
  {status:402,headers:{'PAYMENT-REQUIRED':encodePaymentRequiredHeader(payment),'Cache-Control':'no-store'}});
}
export function paymentManifest({catalog,handlers,config,origin}){
 const routes=[];
 for(const product of catalog){const terms=handlers[product.id]?paymentRequirements(product,config):null;if(terms)routes.push({resource:new URL('/v1/products/'+product.id+'/invoke',origin).href,product_id:product.id,version:product.version,method:'POST',accepts:[terms],criteria_url:new URL('/v1/products/'+product.id+'/criteria',origin).href,quote_url:new URL('/v1/products/'+product.id+'/quote',origin).href,prepare_url:handlers[product.id].preview?new URL('/v1/products/'+product.id+'/prepare',origin).href:null,pricing:{model:'buyer_chosen_per_success',minimum_amount_atomic:terms.amount,decimals:6,business_maximum:null,protocol_maximum_atomic:MAX_UINT256},live_payment_verified:product.pricing.live_payment_verified===true});}
 // x402scan discovery version 1 is separate from x402 payment protocol version 2.
 return {version:1,resources:routes.map(route=>route.resource),payment:{x402Version:2,facilitator:FACILITATOR,configured:routes.length>0,routes},instructions:'Direct minimum-price calls need no quote: POST /v1/products/{id}/invoke with version, input, max_charge_usdc_atomic and a unique Idempotency-Key. Authorize the exact returned x402 challenge and resubmit the identical body/key. Optional higher amounts and prepared results require POST /v1/products/{id}/quote first. Manifest challenges quote the minimum only. Preserve the original authorization for delivery replay. Settlement occurs only after validated success. Live payment behavior is not yet independently verified.'};
}
export async function sdkAdapter({payTo,amount,network=BASE_NETWORK,asset=BASE_USDC,facilitatorClient}){
 const expected=paymentRequirements({status:'active',pricing:{payments_enabled:true,minimum_amount_atomic:typeof amount==='number'&&Number.isSafeInteger(amount)?String(amount):amount}},{enabled:true,receiverConfirmed:true,network,asset,payTo});
 if(!expected)throw new PlatformError(503,'payment_configuration_error','Unsupported payment configuration.');
 const client=facilitatorClient??new HTTPFacilitatorClient({url:FACILITATOR,timeoutMs:10000});
 const server=new x402ResourceServer(client).register(expected.network,new ExactEvmScheme());
 await server.initialize();
 const requirements=(await server.buildPaymentRequirements({scheme:expected.scheme,network:expected.network,payTo:expected.payTo,
  price:{asset:expected.asset,amount:expected.amount,extra:expected.extra},
  maxTimeoutSeconds:expected.maxTimeoutSeconds}))[0];
 if(canonical(requirements)!==canonical(expected))
  throw new PlatformError(503,'payment_configuration_error','Payment requirements do not match the product.');
 return {requirements,
  challenge:resource=>server.createPaymentRequiredResponse([requirements],{url:resource,description:'Validated product outcome',mimeType:'application/json'}),
  verify:payload=>server.verifyPayment(payload,requirements),
  // The high-level resource server retries settlement_pending automatically.
  // Our durable state machine instead requires reconciliation after one call.
  settle:payload=>client.settle(payload,requirements),
 };
}
function validatePayload(payload,requirements,nowSeconds,existing=false){
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
    (!existing&&(Number(a.validAfter)>nowSeconds||Number(a.validBefore)<nowSeconds+30||Number(a.validBefore)>nowSeconds+600)))
  throw new PlatformError(400,'invalid_authorization','Authorization recipient, amount or validity window is invalid.');
 return a;
}
export async function quotedPayment(options){
 const {terms,...quote}=await createQuote(options);
 return {api_version:'1',...quote,payment:paymentChallenge(options.product,terms,options.origin),payment_requirements_pin:await paymentRequirementsPin(terms),payment_effect:'none',instructions:'Include quote_id and this exact payment_amount_atomic in invoke. Preserve body, capability, key and original authorization for retries. A quote does not settle or release a result.'};
}
export async function paidInvocation({request,body,key,product,handler,db,config,origin,adapterFactory=sdkAdapter,now=()=>new Date()}){
 if(request.method!=='POST'||new URL(request.url).pathname!=='/v1/products/'+product.id+'/invoke')
  throw new PlatformError(405,'method_not_allowed','Paid products use their exact POST invocation path.');
 const currentTerms=()=>{
  if(product.status!=='active'&&product.status!=='validation')throw new PlatformError(410,'product_retired','Retired products cannot charge.');
  const current=paymentRequirements(product,config);
  if(!current)throw new PlatformError(503,'payment_not_ready','Paid execution is not enabled or receiver/network/asset verification is incomplete.');
  if(!handler)throw new PlatformError(503,'product_unavailable','No paid execution contract is available.');
  return current;
 };
 let terms;
 const signature=request.headers.get('PAYMENT-SIGNATURE');
 const sampleKind=request.headers.get('X-AgentToolbox-Sample')==='synthetic'?'synthetic':'unclassified';
 const metrics=telemetry(db,{sampleKind,now});
 await metrics.record('invoke_attempt',product);
 if(!signature){
  terms=currentTerms();
  await metrics.record('payment_required',product);
  return discoveryChallenge({product,config,origin:origin??new URL(request.url).origin});
 }
 if(signature.length>12288)throw new PlatformError(413,'payment_header_too_large','Payment header exceeds its bound.');
 if(!/^[A-Za-z0-9_-]{32,128}$/.test(key??''))throw new PlatformError(400,'idempotency_key_required','A stable Idempotency-Key is required.');
 let payload,paymentBytes;try{payload=decodePaymentSignatureHeader(signature);paymentBytes=canonical(payload);}catch{throw new PlatformError(400,'invalid_payment','Malformed payment header.');}
 let requestBytes;try{requestBytes=canonical(body);}catch{throw new PlatformError(400,'invalid_input','Request could not be serialized.');}
 const keyHash=await hash(key),requestHash=await hash(requestBytes),paymentDigest=await hash(paymentBytes);
 await expirePaidResults(db,now());
 const previous=await db.prepare('SELECT * FROM platform_payments WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,body?.version??'',keyHash).first();
 const replay=async(row,fingerprint)=>{
  if((row.request_hash?row.request_hash!==requestHash:row.fingerprint!==fingerprint)||row.payment_digest!==paymentDigest)throw new PlatformError(409,'payment_replay_conflict','This operation is bound to another request or authorization. Do not create a replacement charge.');
  if(row.prepared_id){const prepared=await db.prepare('SELECT capability_hash FROM platform_preparations WHERE prepared_id=?').bind(row.prepared_id).first();if(!prepared||prepared.capability_hash!==await capabilityHash(request))throw new PlatformError(403,'preparation_capability_invalid','Original preparation capability required.');}
  if(row.state==='settled'){
   if(!row.result_json)throw new PlatformError(410,'paid_result_expired','The 24-hour result retention window expired. This purchase will not execute or charge again.',{operation_id:row.operation_id});
   return Response.json(JSON.parse(row.result_json),{headers:{'PAYMENT-RESPONSE':encodePaymentResponseHeader(JSON.parse(row.settlement_json))}});
  }
  if(row.state==='failed')throw new PlatformError(422,'outcome_not_met','This operation did not meet its success criterion. No settlement was requested.');
  throw new PlatformError(503,'settlement_unresolved','The operation is in progress or requires reconciliation. Reuse this request; do not issue a new authorization.',{operation_id:row.operation_id});
 };
 // Frozen replay is checked before current schema, price or quote expiry. No facilitator call.
 if(previous?.request_hash)return replay(previous);
 if(previous){
  // Historical rows already froze these server-owned fields. Legacy products
  // used this exact v2 timeout/asset policy; never reconstruct from accepted.
  const frozen={scheme:'exact',network:previous.network,asset:BASE_USDC,amount:previous.amount_atomic,payTo:previous.receiver,maxTimeoutSeconds:300,extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009'}};
  // Address case was included in the historical fingerprint. Both forms below
  // come from server state/config; the client cannot supply settlement terms.
  for(const receiver of [...new Set([previous.receiver,config.payTo])]){
   if(receiver?.toLowerCase()!==previous.receiver.toLowerCase())continue;
   frozen.payTo=receiver;
   const legacy=await hash(canonical({method:'POST',path:new URL(request.url).pathname,product:product.id,version:previous.version,body,requirements:frozen,facilitator:FACILITATOR}));
   if(legacy===previous.fingerprint)return replay(previous,legacy);
  }
  throw new PlatformError(409,'payment_replay_conflict','Original legacy request cannot be matched. No replacement charge; reconcile this operation.');
 }
 terms=currentTerms();
 const parsed=invokeSchema.safeParse(body);if(!parsed.success){if(parsed.error.issues.some(issue=>issue.path[0]==='agent_id'))throw new PlatformError(400,'invalid_agent_id','agent_id must be a random UUID pseudonym such as crypto.randomUUID(); omit it if unavailable.');throw new PlatformError(400,'invalid_input','Request does not match the published invocation schema.');}body=parsed.data;
 if(body.version!==product.version)throw new PlatformError(409,'version_mismatch','Inspect the current product version.');
 const chosenTerms=paymentRequirements(product,config,body.payment_amount_atomic??minimumAmount(product));
 if(!chosenTerms)throw new PlatformError(400,'amount_below_minimum','Chosen amount must meet the product minimum.',{minimum_amount_atomic:minimumAmount(product)});
 terms=chosenTerms;let input,prepared,quotedSuccessPin;
 if(body.quote_id){({terms,input,prepared,success_contract_sha256:quotedSuccessPin}=await loadQuote({db,request,body,product,handler,config,now:now()}));}
 else{
  if(body.prepared_id||terms.amount!==minimumAmount(product))throw new PlatformError(400,'quote_required','Prepared results and above-minimum amounts require a fresh durable quote.');
  const checked=handler.input.safeParse(body.input);if(!checked.success)throw new PlatformError(400,'invalid_input','Input does not match the product schema.');input=checked.data;
 }
 const pins=await contractPins(product,terms);assertContractPins(body,pins);assertContractPins({success_contract_sha256:quotedSuccessPin},pins);
 const recheckPins=async()=>{assertContractPins(pins,await contractPins(product,paymentRequirements(product,config,terms.amount)));};
 if(BigInt(body.max_charge_usdc_atomic)<BigInt(terms.amount))throw new PlatformError(400,'charge_cap_exceeded','The product price exceeds the caller charge cap.');
 const beneficiary=await creatorBeneficiary(db,product,handler);
 const referral=await referralBeneficiary({db,code:body.referral_code,product,handler,creator:beneficiary});
 const adapter=await adapterFactory({payTo:terms.payTo,amount:terms.amount,network:terms.network,asset:terms.asset});
 if(canonical(adapter.requirements)!==canonical(terms))throw new PlatformError(503,'payment_configuration_error','Payment requirements differ from published terms.');
 const authorization=validatePayload(payload,adapter.requirements,Math.floor(now().getTime()/1000),!!previous);
 const fingerprint=await hash(canonical({method:'POST',path:new URL(request.url).pathname,product:product.id,version:product.version,body:{...body,...(input?{input}:{})},requirements:adapter.requirements,facilitator:FACILITATOR}));
 if(previous)return replay(previous,fingerprint);
 const verified=await adapter.verify(payload);
 if(!verified.isValid||verified.payer?.toLowerCase()!==authorization.from.toLowerCase())
  throw new PlatformError(402,'payment_invalid','The facilitator did not verify this authorization.');
 await recheckPins();
 const operationId=crypto.randomUUID(),date=now().toISOString();
 let inserted;try{inserted=await db.prepare(`INSERT OR IGNORE INTO platform_payments(operation_id,product_id,version,key_hash,fingerprint,payment_digest,network,asset,payer,nonce,amount_atomic,receiver,state,created_at,updated_at,sample_kind,is_live,result_expires_at,review_secret_hash,request_hash,requirements_json,minimum_policy,quote_id,prepared_id,creator_tool_id,creator_id,creator_share_bps,referral_code,referral_terms_version,referral_share_bps) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,'executing',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(operationId,product.id,product.version,keyHash,fingerprint,paymentDigest,BASE_NETWORK,BASE_USDC.toLowerCase(),authorization.from.toLowerCase(),authorization.nonce.toLowerCase(),adapter.requirements.amount,config.payTo.toLowerCase(),date,date,sampleKind,config.live===true?1:0,new Date(now().getTime()+86400000).toISOString(),body.review_secret_hash??null,requestHash,canonical(terms),minimumPolicy(product,handler),body.quote_id??null,body.prepared_id??null,beneficiary.tool_id,beneficiary.creator_id,beneficiary.share_bps,referral.referral_code,referral.referral_terms_version,referral.referral_share_bps).run();}catch(e){if(/quote_already_claimed|prepared_already_claimed/.test(String(e)))throw new PlatformError(409,'quote_already_claimed','This quote or prepared result is already purchased. Reuse the original paid request.');throw e;}
 if(!inserted.meta.changes){
  const row=await db.prepare('SELECT * FROM platform_payments WHERE product_id=? AND version=? AND key_hash=?').bind(product.id,product.version,keyHash).first();
  if(row)return replay(row,fingerprint);
  throw new PlatformError(409,'authorization_already_used','This authorization is already bound to another operation.');
 }
 await metrics.record('payment_verified',product);
 const ledger=async(event,amount='0',transaction=null)=>db.prepare('INSERT INTO platform_payment_ledger VALUES(?,?,?,?,?,?,?,?,?,?,?)')
  .bind(crypto.randomUUID(),operationId,product.id,product.version,event,BASE_NETWORK,BASE_USDC,amount,transaction,sampleKind,now().toISOString()).run();
 let output;const executionStarted=Date.now();
 try{
  const result=prepared?JSON.parse(prepared.result_json):await handler.run(input),checked=handler.output.safeParse(result);
  if(!checked.success||!await handler.success(checked.data))throw new Error('criterion');
  await recheckPins();
  output={api_version:'1',contract_pins:pins,operation_id:operationId,product_id:product.id,version:product.version,execution:'completed',evidence:'server_validated',output:checked.data};
  if(new TextEncoder().encode(JSON.stringify(output)).length>16384)throw new Error('output_bound');
 }catch(e){
  await db.prepare("UPDATE platform_payments SET state='failed',updated_at=? WHERE operation_id=?").bind(now().toISOString(),operationId).run();
  await ledger('outcome_failed');await metrics.record('execution_failure',product,Date.now()-executionStarted);
  if(e instanceof PlatformError&&['success_contract_mismatch','payment_requirements_pin_mismatch'].includes(e.code))throw e;
  const reason=handler.failureReason?.(e);
  throw new PlatformError(422,'outcome_not_met','The disclosed outcome was not met. No settlement was requested.',reason?{reason}:{});
 }
 // Durable output and intent must succeed before the only settlement call.
 const durable=await db.prepare("UPDATE platform_payments SET state='outcome_ready',result_json=?,updated_at=? WHERE operation_id=? AND state='executing'").bind(JSON.stringify(output),now().toISOString(),operationId).run();
 // D1 changes includes trigger writes (activity and purchase records). The
 // primary-key predicate updates at most one payment; require positive changes.
 if(!Number.isInteger(durable.meta.changes)||durable.meta.changes<1)throw new PlatformError(503,'settlement_unresolved','Result was not durably saved; no settlement requested.');
 await ledger('outcome_validated');await metrics.record('execution_success',product,Date.now()-executionStarted);
 const claim=await db.prepare("UPDATE platform_payments SET state='settling',updated_at=? WHERE operation_id=? AND state='outcome_ready'").bind(now().toISOString(),operationId).run();
 if(!claim.meta.changes)throw new PlatformError(503,'settlement_unresolved','Settlement state changed; reconciliation is required.');
 await ledger('settlement_intent');
 // Last contract check immediately before the sole settlement call. A changed
 // contract is a known no-settlement failure, not an ambiguous broadcast.
 try{await recheckPins();assertContractPins(pins,await contractPins(product,adapter.requirements));}catch(e){
  await db.prepare("UPDATE platform_payments SET state='failed',updated_at=? WHERE operation_id=? AND state='settling'").bind(now().toISOString(),operationId).run();await ledger('outcome_failed');throw e;
 }
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
 output.outcome_url='/v1/runs/'+operationId+'/outcome';
 output.result_expires_at=new Date(Date.parse(date)+86400000).toISOString();
 // Ledger before settled state. Failure here leaves settling, so replay cannot expose output or charge again.
 await ledger('settlement_reported',adapter.requirements.amount,receipt.transaction);
 const completed=await db.prepare("UPDATE platform_payments SET state='settled',result_json=?,settlement_json=?,updated_at=? WHERE operation_id=? AND state='settling'")
  .bind(JSON.stringify(output),JSON.stringify(receipt),now().toISOString(),operationId).run();
 if(!Number.isInteger(completed.meta.changes)||completed.meta.changes<1)throw new PlatformError(503,'settlement_unresolved','Payment state needs reconciliation. Do not submit another authorization.',{operation_id:operationId});
 await metrics.record('payment_settled',product);
 return Response.json(output,{headers:{'PAYMENT-RESPONSE':encodePaymentResponseHeader(receipt)}});
}
