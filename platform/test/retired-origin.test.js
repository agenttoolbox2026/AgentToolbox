import test from 'node:test';
import assert from 'node:assert/strict';
import {retiredOrigin} from '../src/retired-origin.js';
test('retired endpoint gives an explicit canonical address without executing, redirecting or echoing credentials',async()=>{
 for(const path of ['/mcp','/v1/products/docs-pack/invoke','/v1/tool-submissions','/v1/referrals','/health','/.well-known/x402','/admin'])for(const method of ['GET','HEAD','POST','OPTIONS']){
  const request=new Request('https://old.example.invalid'+path+'?private=fixture-secret',{
   method,headers:{Authorization:'Bearer fixture-secret',Cookie:'private=fixture-secret','PAYMENT-SIGNATURE':'fixture-secret','X-Creator-Capability':'fixture-secret'},...(method==='POST'?{body:'fixture-secret'}:{}),
  });
  const response=retiredOrigin(request);assert.equal(response.status,410);assert.equal(response.headers.get('Location'),null);assert.equal(response.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(response.headers.get('Cache-Control'),'no-store');
  if(method==='HEAD'){assert.equal(await response.text(),'');continue;}
  const text=await response.text();assert(!text.includes('fixture-secret'));const notice=JSON.parse(text);
  assert.equal(notice.canonical_origin,'https://agi.agenttoolbox2026.workers.dev');assert.equal(notice.payment_effect,'none');assert.match(notice.retry_instructions,/Do not rewrite its resource URL/);
 }
});
test('retired browser root preserves the exact tab title and links only to the canonical root',async()=>{
 const response=retiredOrigin(new Request('https://old.example.invalid/?private=fixture-secret'));const page=await response.text();
 assert.equal(response.status,410);assert.match(page,/<title>AgentToolbox<\/title>/);assert.match(page,/href="https:\/\/agi\.agenttoolbox2026\.workers\.dev"/);assert(!page.includes('fixture-secret'));assert(!page.includes('<script'));
});
