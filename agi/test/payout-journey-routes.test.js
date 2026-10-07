import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {z} from 'zod';
import {createRequire} from 'node:module';
import {createAgi} from '../src/worker.js';
import {createCompiledRuntime} from '../src/compiled-runtime.js';
import {createPayoutRequestsClient,payoutRequestText} from '../public/payout-requests.js';
import {database} from '../../platform/scripts/local-db.js';
import {submitTool,CREATOR_TERMS} from '../../platform/src/submissions.js';
import {REFERRAL_TERMS} from '../../platform/src/referrals.js';
import {createReviewedCreatorRegistry,reviewedCreatorRegistry} from '../../platform/src/reviewed-creator-adapters.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {products} from '../../platform/src/registry.js';
import {createContractCases} from '../../platform/src/contract-cases.js';
import {paymentRequirements,BASE_NETWORK,BASE_USDC} from '../../platform/src/payment-config.js';
import * as operator from '../../platform/src/payout-operator.js';
import {hash} from '../../platform/src/telemetry.js';

const platformRequire=createRequire(new URL('../../platform/package.json',import.meta.url));
const {privateKeyToAccount}=platformRequire('viem/accounts');
const {encodePaymentSignatureHeader}=platformRequire('@x402/core/http');
const origin='https://agi.agenttoolbox2026.workers.dev',reviewer='local-agi-payout-integration-owner';
const key=()=>crypto.randomUUID(),sourceAddress='0x'+'11'.repeat(20),payer='0x'+'22'.repeat(20);
// Public synthetic key used only for local wallet-message proofs. No transaction
// signature, network connection, broadcast, real account or production database.
const account=privateKeyToAccount('0x'+'01'.repeat(32));
const json=(body,headers={})=>({method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
async function result(response,status=200){assert.equal(response.status,status,await response.clone().text());return response.json();}
async function fixture(t,kind){
 t.mock.method(globalThis,'fetch',()=>{throw new Error('External network forbidden in local payout journey integration.');});
 const db=database();t.after(()=>db.close());db.sqlite.exec('PRAGMA foreign_keys=ON');
 const capability=(kind==='creator'?'atbc_':'atbf_')+Buffer.alloc(32,kind==='creator'?51:52).toString('base64url'),header=kind==='creator'?'X-Creator-Capability':'X-Referral-Capability';
 const counts={execute:0,verify:0,settle:0};let product,registry,compiled,input,toolId=null;
 assert.deepEqual((await reviewedCreatorRegistry).getRuntime(),{products:[],handlers:{}});
 if(kind==='creator'){
  const schema=z.strictObject({value:z.number().int()}),output=z.strictObject({doubled:z.number().int()}),proposal={name:'Local reviewed integer tool',summary:'Local synthetic seller payout integration',endpoint_url:'https://fixture.example/api',input_schema:z.toJSONSchema(schema),output_schema:z.toJSONSchema(output)};
  const submission=await submitTool({db,body:{request_id:key(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal},capability,client:'local-agi-payout'}),date=new Date().toISOString();toolId=submission.tool_id;
  await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(key(),submission.submission_id,reviewer,await hash(key()),'a'.repeat(64),0,1,'approved','Local source reviewed fixture',date).run();
  product={id:toolId,version:'0.1.0',name:proposal.name,summary:proposal.summary,status:'active',tags:[],provider:{id:'local-reviewed-seller',type:'creator'},pricing:{payments_enabled:true,minimum_amount_atomic:'10000'},outcome:{success_criterion:'Output doubles the supplied integer'},input_schema:z.toJSONSchema(schema),output_schema:z.toJSONSchema(output)};
  const pin=await successContractPin(product),manifestId='local-agi-payout-v1';
  registry=await createReviewedCreatorRegistry([{manifestId,toolId,metadataRevision:0,metadataVersion:'0.1.0',sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),successContractSha256:pin.sha256,productVersion:'0.1.0',adapterId:'local-compiled-integer-v1',product,handler:{input:schema,output,run:async({value})=>{counts.execute++;return {doubled:value*2};},success:r=>Number.isInteger(r.doubled),creatorAdapterId:'local-compiled-integer-v1',creatorArtifactSha256:'b'.repeat(64),creatorContractSha256:pin.sha256}}]);
  compiled=await createCompiledRuntime({registry,builtinCatalog:[],builtinHandlers:{}});input={value:7};
 }else{
  product=products.find(p=>p.id==='contract-cases');const handler=createContractCases(),run=handler.run;
  compiled=await createCompiledRuntime({builtinCatalog:[product],builtinHandlers:{'contract-cases':{...handler,run:async(...args)=>{counts.execute++;return run(...args);}}}});
  input={schema:{$schema:'https://json-schema.org/draft/2020-12/schema',type:'integer',minimum:1,maximum:3},valid_example:2,max_cases:4};
 }
 const payments={enabled:true,live:true,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:sourceAddress};
 const worker=createAgi({compiledRuntime:compiled,platformOptions:{payments,paymentAdapterFactory:async({amount})=>({requirements:paymentRequirements(product,payments,amount),verify:async()=>{counts.verify++;return {isValid:true,payer};},settle:async()=>{counts.settle++;return {success:true,network:BASE_NETWORK,transaction:'0x'+'cc'.repeat(32),payer,amount};}})}});
 const allow={limit:async()=>({success:true})},env={METRICS_DB:db,PUBLIC_ORIGIN:origin,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow},request=(path,init={})=>worker.fetch(new Request(origin+path,init),env),privateRequest=(path,body)=>request(path,body===undefined?{headers:{[header]:capability}}:json(body,{[header]:capability}));
 let referralCode;
 if(kind==='creator'){
  assert.equal((await request(`/v1/products/${toolId}/invoke`)).status,404);
  await registry.install({db,reviewer,requestId:key(),manifestId:'local-agi-payout-v1',expectedRevision:0});
 }else referralCode=(await result(await privateRequest('/v1/referrals',{terms_version:REFERRAL_TERMS.terms_version}))).referral_code;
 const path=`/v1/products/${product.id}`,quote=await result(await request(path+'/quote',json({version:product.version,input,payment_amount_atomic:'10001'}))),terms=paymentRequirements(product,payments,'10001'),seconds=Math.floor(Date.now()/1000);
 const payload={x402Version:2,accepted:terms,payload:{signature:'0x'+'00'.repeat(65),authorization:{from:payer,to:sourceAddress,value:'10001',nonce:'0x'+key().replaceAll('-','').padEnd(64,'a'),validAfter:String(seconds-1),validBefore:String(seconds+300)}}};
 const paidRequest=json({version:product.version,input,payment_amount_atomic:'10001',max_charge_usdc_atomic:'10001',quote_id:quote.quote_id,...(referralCode?{referral_code:referralCode}:{})},{'PAYMENT-SIGNATURE':encodePaymentSignatureHeader(payload),'Idempotency-Key':key(),'X-AgentToolbox-Sample':'synthetic'});
 const sale=await result(await request(path+'/invoke',paidRequest));assert.equal((await request(path+'/invoke',paidRequest)).status,200);
 if(kind==='creator')assert.deepEqual(sale.output,{doubled:14});else assert.equal(sale.output.tool,'contract-cases');assert.deepEqual(counts,{execute:1,verify:1,settle:1});
 const walletPath=kind==='creator'?'/v1/creators/me/payout-wallet':'/v1/referrals/me/payout-wallet';
 const claim=await result(await privateRequest(walletPath,{request_id:key(),expected_revision:0,network:BASE_NETWORK,address:account.address}));
 const challenge=await result(await privateRequest(walletPath+'/challenge',{request_id:key(),claim_revision:1}));
 const proof=await result(await privateRequest(walletPath+'/verify',{challenge_id:challenge.challenge_id,signature:await account.signMessage({message:challenge.message})}));assert.equal(proof.ownership_status,'eoa_signature_verified');
 await operator.approvePayoutWallet({db,kind,claimId:claim.claim_id,reviewer,requestId:key()});
 return {db,kind,capability,header,request,privateRequest,claim,toolId,subject:toolId??referralCode,counts,amount:kind==='creator'?'9000':'100',decimal:kind==='creator'?'0.009000':'0.000100'};
}
function syntheticChain(manifest){
 const transactionHash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32),finalHash='0x'+'55'.repeat(32),topic=a=>'0x'+a.slice(2).padStart(64,'0'),data='0x'+BigInt(manifest.amount_atomic).toString(16).padStart(64,'0');
 const tx={hash:transactionHash,chainId:'0x2105',nonce:'0x7',from:manifest.from,to:manifest.asset,value:'0x0',input:manifest.transaction.data,blockNumber:'0x10',blockHash,transactionIndex:'0x0'},log={address:manifest.asset,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(manifest.from),topic(manifest.to)],data,transactionHash,blockNumber:'0x10',blockHash,transactionIndex:'0x0',logIndex:'0x2',removed:false};
 const receipt={transactionHash,from:manifest.from,to:manifest.asset,status:'0x1',blockNumber:'0x10',blockHash,transactionIndex:'0x0',logs:[log]},canonical={number:'0x10',hash:blockHash,timestamp:'0x'+(BigInt(Math.floor(Date.now()/1000))+5n).toString(16)},finalized={number:'0x20',hash:finalHash},calls=[];
 const rpc=async(method,params)=>{calls.push(method);if(method==='eth_chainId')return '0x2105';if(method==='eth_getTransactionByHash')return tx;if(method==='eth_getTransactionReceipt')return receipt;if(method==='eth_getBlockByNumber')return params[0]==='finalized'||params[0]==='0x20'?finalized:canonical;throw new Error('Unexpected synthetic RPC method.');};
 return {rpc,transactionHash,receipt,log,calls};
}
for(const kind of ['creator','referral'])test(`real AGI ${kind} payout journey preserves one lost-response request and pays only after verified chain evidence`,async t=>{
 const f=await fixture(t,kind);let loseResponse=true;const sent=[];
 const fetchImpl=async(path,init)=>{sent.push({path,...init});const response=await f.request(path,init);assert.equal(response.headers.get('cache-control'),'no-store');if(init.method==='POST'&&loseResponse){loseResponse=false;assert.equal(response.status,200,await response.clone().text());throw new Error('Local simulated lost response.');}return response;};
 const client=createPayoutRequestsClient({kind,fetchImpl,cryptoImpl:webcrypto}),current=await client.read(f.toolId,f.capability);
 assert.equal(current.wallet.ownership_status,'eoa_signature_verified');assert.equal(current.wallet.owner_approval.status,'approved');assert.equal(current.earnings.available_atomic,f.amount);
 const text=await client.prepare(f.decimal,f.toolId,f.capability),envelope=JSON.parse(text);assert(!text.includes(f.capability));assert.equal(envelope.subject_id,f.subject);assert.equal(envelope.claim_id,f.claim.claim_id);
 await assert.rejects(client.send(f.capability),/uncertain/);assert.throws(()=>client.startNew());
 const reloaded=createPayoutRequestsClient({kind,fetchImpl,cryptoImpl:webcrypto});await reloaded.restore(text,f.capability);assert.equal(reloaded.snapshot().envelope,text);
 const accepted=await reloaded.resolve(f.capability);assert.equal(accepted.state,'requested');assert.equal(accepted.amount_atomic,f.amount);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM platform_payout_requests').get().n,1);
 assert.equal((await reloaded.send(f.capability)).request_id,envelope.body.request_id);assert(sent.filter(c=>c.method==='POST').every(c=>c.body===JSON.stringify(envelope.body)));
 for(const headers of [{},{[f.header]:(kind==='creator'?'atbc_':'atbf_')+Buffer.alloc(32,91).toString('base64url')},{[kind==='creator'?'X-Referral-Capability':'X-Creator-Capability']:f.capability}]){
  for(const requestId of [envelope.body.request_id,key()]){const denied=await f.request(`${envelope.path}/${requestId}`,{headers});const data=await result(denied,403);assert.equal(data.error.code,kind==='creator'?(headers[f.header]?'creator_capability_invalid':'creator_capability_required'):'referral_capability_invalid');assert(!JSON.stringify(data).includes(f.capability));}
 }
 const unknown=await result(await f.privateRequest(`${envelope.path}/${key()}`),404);assert.equal(unknown.error.code,'payout_request_not_found');
 let payout=(await operator.reservePayoutRequests({db:f.db,kind,requestIds:[envelope.body.request_id],reviewer,requestId:key(),sourceAddress})).items[0];
 assert.equal((await reloaded.resolve(f.capability)).state,'reserved');assert.equal((await reloaded.read(f.toolId,f.capability)).earnings.available_atomic,'0');
 const event=(extra={})=>({db:f.db,kind,payoutId:payout.payout_id,reviewer,requestId:key(),expectedRevision:payout.revision,...extra});
 payout=await operator.authorizeOperatorPayout(event());const manifest=await operator.getOperatorPayoutManifest({db:f.db,kind,payoutId:payout.payout_id,reviewer});assert.equal(manifest.to,account.address.toLowerCase());assert.equal(manifest.amount_atomic,f.amount);assert.equal(manifest.signature,null);assert.equal(manifest.broadcast,false);
 payout=await operator.markOperatorPayoutUnknown(event());const held=await reloaded.send(f.capability);assert.equal(held.state,'unknown');assert.match(payoutRequestText(held,{kind}),/Reservation remains held/);assert.equal(held.request_id,envelope.body.request_id);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM platform_payout_requests').get().n,1);
 const chain=syntheticChain(manifest);payout=await operator.registerOperatorPayoutTransaction(event({rpc:chain.rpc,transactionHash:chain.transactionHash}));
 const originalData=chain.log.data;chain.log.data='0x'+(BigInt(f.amount)+1n).toString(16).padStart(64,'0');
 await assert.rejects(operator.reconcileOperatorPayout(event({rpc:chain.rpc,transactionHash:chain.transactionHash})),/wrong transfer event/);
 const pending=await reloaded.resolve(f.capability);assert.equal(pending.state,'submitted');assert.equal(pending.payout.receipt,null);assert.doesNotMatch(payoutRequestText(pending,{kind}),/Paid: the backend verified/);
 assert.equal(f.db.sqlite.prepare(`SELECT count(*) n FROM platform_${kind}_payout_evidence`).get().n,0);
 chain.log.data=originalData;payout=await operator.reconcileOperatorPayout(event({rpc:chain.rpc,transactionHash:chain.transactionHash}));assert.equal(payout.state,'paid');
 const paid=await reloaded.resolve(f.capability);assert.match(payoutRequestText(paid,{kind}),/Paid: the backend verified a finalized canonical Base USDC transfer/);assert.equal(paid.payout.receipt.transaction_hash,chain.transactionHash);assert.equal(paid.payout.receipt.block_number,'0x10');assert.equal(paid.payout.receipt.log_index,'0x2');
 for(const mutate of [data=>{data.payout.receipt.basis='unfinalized';},data=>{data.payout.receipt.block_number='16';},data=>{data.payout.amount_atomic='1';}]){
  const malicious=createPayoutRequestsClient({kind,cryptoImpl:webcrypto,fetchImpl:async(path,init)=>{const response=await f.request(path,init),data=await response.json();mutate(data);return Response.json(data);}});await malicious.restore(text,f.capability);await assert.rejects(malicious.resolve(f.capability),/unexpected or inconsistent/);assert.equal(malicious.snapshot().phase,'uncertain');
 }
 const final=await reloaded.read(f.toolId,f.capability);assert.equal(final.earnings.confirmed_paid_atomic,f.amount);assert.equal(final.earnings.reserved_atomic,'0');assert.equal(final.earnings.available_atomic,'0');
 assert.equal((await reloaded.history(f.toolId,f.capability)).requests[0].state,'paid');assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM platform_payout_requests').get().n,1);assert.equal(f.db.sqlite.prepare('SELECT count(*) n FROM platform_payout_request_links').get().n,1);assert.equal(f.db.sqlite.prepare(`SELECT count(*) n FROM platform_${kind}_payout_evidence`).get().n,1);
 assert.deepEqual(f.counts,{execute:1,verify:1,settle:1});assert(chain.calls.every(method=>['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(method)));assert.deepEqual(f.db.sqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
