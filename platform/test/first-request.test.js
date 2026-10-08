import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {prepareFirstRequest} from '../../examples/prepare-first-request.js';
import {createAgi} from '../../agi/src/worker.js';
import {database} from '../scripts/local-db.js';
import {products} from '../src/registry.js';
const origin='https://agi.agenttoolbox2026.workers.dev';
function fixture(transform=value=>value){
 const db=database(),allow={limit:async()=>({success:true})},calls=[];
 const worker=createAgi({platformOptions:{paymentAdapterFactory:()=>{throw new Error('No payment adapter permitted.');}}});
 const env={METRICS_DB:db,PUBLIC_ORIGIN:origin,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow,RECEIVER_CONFIRMED:'true',PAYMENTS_MODE:'x402',PAYMENT_NETWORK:'eip155:8453',PAYMENT_ASSET:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',PAY_TO_ADDRESS:'0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D'};
 return {db,calls,fetchImpl:async(url,init)=>{calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.headers['X-AgentToolbox-Sample'],'synthetic');const response=await worker.fetch(new Request(url,init),env);return transform(response,url);}};
}
test('four first-purchase drafts perform three GETs, validate input and persist exact unsigned bytes',async()=>{
 const f=fixture();try{for(const tool of products.filter(p=>p.status==='active')){const result=await prepareFirstRequest({tool:tool.id,fetchImpl:f.fetchImpl});const body=JSON.parse(result.body_utf8);assert.equal(body.version,tool.version);assert.equal(result.body_sha256,createHash('sha256').update(result.body_utf8).digest('hex'));assert.match(result.headers['Idempotency-Key'],/^[0-9a-f]{64}$/);assert.equal(result.wallet_handoff.signature_present,false);assert.equal(result.input_check.outcome_checked,false);assert.equal(result.headers['PAYMENT-SIGNATURE'],undefined);}assert.equal(f.calls.length,12);for(const table of ['platform_payments','platform_quotes','platform_preparations','platform_paid_purchases','platform_runs'])assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM '+table).bind().first()).count,0);}finally{f.db.close();}
});
test('full local input refinements reject unsupported inputs without execution',async()=>{
 const f=fixture();try{await assert.rejects(prepareFirstRequest({tool:'docs-pack',input:{urls:['https://example.invalid/docs'],query:'x'},fetchImpl:f.fetchImpl}));assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM platform_payments').bind().first()).count,0);}finally{f.db.close();}
});
test('pin tampering and contract drift fail closed before an unsigned draft exists',async()=>{
 for(const kind of ['hash','resource','version']){
  const f=fixture(async(response,url)=>{const value=await response.json();if(url.endsWith('/criteria')&&kind==='hash')value.sha256='0'.repeat(64);if(url.endsWith('/invoke')&&kind==='resource')value.payment.resource.url='https://other.invalid/invoke';if(url.endsWith('/criteria')&&kind==='version'){const parsed=JSON.parse(value.canonical_json);parsed.product_version='9.9.9';value.canonical_json=JSON.stringify(parsed);value.sha256=createHash('sha256').update(value.canonical_json).digest('hex');}return Response.json(value,{status:response.status});});
  try{await assert.rejects(prepareFirstRequest({fetchImpl:f.fetchImpl}));}finally{f.db.close();}
 }
});
