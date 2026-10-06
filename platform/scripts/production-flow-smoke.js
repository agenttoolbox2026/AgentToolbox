// Authorized nonfinancial functional checks. Creates bounded expiring private
// quotes/preparation only; never sends PAYMENT-SIGNATURE or calls settlement.
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {createContractCases} from '../src/contract-cases.js';
const origin=process.argv[2];if(!origin)throw new Error('Explicit origin required.');
const root=new URL(origin);if(root.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(root.hostname))throw new Error('HTTPS required.');
const headers={'Content-Type':'application/json','X-AgentToolbox-Sample':'synthetic'},path='/v1/products/contract-cases',start=new Date().toISOString();let requests=0;
const send=async(suffix,body,extra={})=>{requests++;const response=await fetch(new URL(path+suffix,origin),{method:'POST',headers:{...headers,...extra},body:JSON.stringify(body)});return {status:response.status,body:await response.json()};};
const contract=await(await fetch(new URL(path,origin),{headers})).json(),input=contract.product.example_input,version=contract.product.version;
const minimum=await send('/quote',{version,input,payment_amount_atomic:'10000'});assert.equal(minimum.status,200);assert.equal(minimum.body.payment.accepts[0].amount,'10000');assert(minimum.body.payment.extensions.bazaar);
const secret='atbp_'+Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),cap={'X-Preparation-Capability':secret},commitment=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))).toString('hex');
const request={version,input,request_id:'synthetic_'+crypto.randomUUID().replaceAll('-',''),prepare_secret_hash:commitment};
const prepared=await send('/prepare',request,cap);assert.equal(prepared.status,200);assert(prepared.body.preview.available);assert(!Object.hasOwn(prepared.body,'output'));assert(!Object.hasOwn(prepared.body.preview,'cases'));assert(new TextEncoder().encode(JSON.stringify(prepared.body.preview)).length<=2000);
const expected=await createContractCases().run(input);assert(expected.cases.length>1);assert.notDeepEqual(prepared.body.preview,expected);
const replay=await send('/prepare',request,cap);assert.equal(replay.status,200);assert.deepEqual(replay.body,prepared.body);
const higher=await send('/quote',{version,prepared_id:prepared.body.prepared_id,payment_amount_atomic:'20000'},cap);assert.equal(higher.status,200);assert.equal(higher.body.payment.accepts[0].amount,'20000');assert.equal(higher.body.payment.extensions,undefined);
for(const q of [minimum,higher]){const t=q.body.payment.accepts[0];assert.equal(t.network,'eip155:8453');assert.equal(t.asset.toLowerCase(),contract.product.pricing.asset.toLowerCase());assert.equal(t.payTo.toLowerCase(),contract.product.pricing.pay_to.toLowerCase());assert.equal(q.body.minimum_amount_atomic,'10000');}
const wrong=await send('/quote',{version,prepared_id:prepared.body.prepared_id,payment_amount_atomic:'20000'},{'X-Preparation-Capability':'atbp_'+Buffer.alloc(32,9).toString('base64url')});assert.equal(wrong.status,403);
const unpaid=await send('/invoke',{version,prepared_id:prepared.body.prepared_id,quote_id:higher.body.quote_id,payment_amount_atomic:'20000',max_charge_usdc_atomic:'20000'},cap);assert.equal(unpaid.status,402);assert(!Object.hasOwn(unpaid.body,'output'));assert.deepEqual(Object.keys(unpaid.body).sort(),['error','payment']);assert.deepEqual(unpaid.body.payment.extensions.bazaar.info.output,{type:'json'});
const report={origin,started_at:start,completed_at:new Date().toISOString(),synthetic_header:true,successful_quotes:2,quoted_atomic_amounts:['10000','20000'],higher_quote_bazaar_omitted:true,preparations_created:1,stable_preview_replays:1,preview_bytes:new TextEncoder().encode(JSON.stringify(prepared.body.preview)).length,preview_sample_cases:1,full_cases_withheld:expected.cases.length-1,wrong_capability_rejections:1,unsigned_invokes_402:1,full_result_released:false,post_requests:requests,contract_reads:1,free_examples:0,payment_headers:0,settlement_calls:0,purchases:0,expires_at:prepared.body.expires_at,retention:'Expire normally; no deletion.'};
if(process.argv[3])writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
