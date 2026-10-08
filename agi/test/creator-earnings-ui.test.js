import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {creatorEarningsSection} from '../src/creator-earnings-section.js';
import {bindCreatorEarnings,createCreatorEarningsClient,creatorEarningsText,formatEarningsUsdc,validateCreatorEarnings} from '../public/creator-earnings.js';

const toolId='creator-11111111-1111-4111-8111-111111111111',otherTool='creator-22222222-2222-4222-8222-222222222222';
const creatorCapability='atbc_'+'A'.repeat(43),otherCapability='atbc_'+'B'.repeat(42)+'A',referralCapability='atbf_'+'A'.repeat(43);
const readAt='2026-10-07T18:40:00.000Z';
const json=(data,status=200)=>Response.json(data,{status});
function earnings(kind='creator',gross='1000001',overrides={}){
 const referral=kind==='referral',g=BigInt(gross),denominator=referral?10000n:10n,numerator=g*(referral?100n:9n),accrued=numerator/denominator;
 return {
  api_version:'1',...(referral?{referral_code:'ref_11111111-1111-4111-8111-111111111111',terms_version:'first-party-referrals-2026-10-07.v1'}:{tool_id:toolId,execution_status:'installed_adapter'}),
  network:'eip155:8453',asset:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',share_bps:referral?100:9000,revenue_basis:'gross',gross_atomic:gross,accrued_atomic:String(accrued),fractional_atom_numerator:String(numerator%denominator),fractional_atom_denominator:String(denominator),confirmed_paid_atomic:'0',reserved_atomic:'0',available_atomic:String(accrued),receipt_count:g===0n?0:1,payout_count:0,
  receipt_basis:'facilitator_confirmed_not_independently_reconciled',payout_basis:'finalized_canonical_base_usdc_transfer',fees:referral?'platform funds gas separately; no referral deductions':'platform_share_only; no creator deductions',transfers_enabled:false,payment_effect:'none',...overrides,
 };
}
function setup(responses=[],options={}){
 const calls=[];
 const client=createCreatorEarningsClient({now:()=>new Date(readAt),...options,fetchImpl:async(path,init)=>{calls.push({path,...init});const value=responses.shift();if(value instanceof Error)throw value;return typeof value==='function'?value():value;}});
 return {client,calls};
}
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};

test('both sections share page forms, keep capabilities out of native submissions, and provide no-JavaScript API instructions',async()=>{
 const creator=creatorEarningsSection(),referral=creatorEarningsSection({kind:'referral'});
 for(const html of [creator,referral]){
  assert.match(html,/class="workflow-actions"/);assert.match(html,/class="workflow-result"/);
  assert.match(html,/data-read-earnings hidden/);assert.match(html,/<noscript>.*OpenAPI/s);
  assert.doesNotMatch(html,/\bname=|type="password"|method="post"|data-send|data-request-payout|<script/);
 }
 assert.match(creator,/#creator-wallet-capability/);assert.match(creator,/data-earnings-tool/);
 assert.match(creator,/90% of gross/);assert.match(creator,/GET \/v1\/creator-tools\/\{tool_id\}\/earnings/);
 assert.match(referral,/#referral-capability/);assert.doesNotMatch(referral,/data-earnings-tool/);
 assert.match(referral,/1% of eligible first-party/);assert.match(referral,/X-Referral-Capability/);
 assert.throws(()=>creatorEarningsSection({kind:'https://example.org/collect'}));
 const source=await readFile(new URL('../public/creator-earnings.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|insertAdjacentHTML|console\.|method:\s*['"]POST|document\.querySelectorAll|window\.ethereum|personal_sign/);
});

test('creator and referral amounts remain exact above Number precision and at the complete snapshot bound',()=>{
 for(const kind of ['creator','referral']){
  const huge=((2n**256n-1n)*5000n).toString(),value=earnings(kind,huge);
  assert.equal(validateCreatorEarnings(value,toolId,{kind}).gross_atomic,huge);
  const expected=`${BigInt(huge)/1000000n}.${(BigInt(huge)%1000000n).toString().padStart(6,'0')} USDC`;
  assert.equal(formatEarningsUsdc(huge),expected);
  assert(creatorEarningsText(value,{kind,readAt}).includes(expected));
 }
 assert.equal(formatEarningsUsdc('9007199254740993'),'9007199254.740993 USDC');
 assert.equal(formatEarningsUsdc('1'),'0.000001 USDC');assert.equal(formatEarningsUsdc('0'),'0.000000 USDC');
 for(const value of [1,'01','-1','1.0','1e6','1'.repeat(83)])assert.throws(()=>formatEarningsUsdc(value));
});

test('the 90% and 1% exact carry equations and reserved/paid subtraction are checked independently',()=>{
 const creator=earnings('creator','1000001',{confirmed_paid_atomic:'10',reserved_atomic:'20',available_atomic:'899970',payout_count:2});
 const referral=earnings('referral','1000001',{confirmed_paid_atomic:'10',reserved_atomic:'20',available_atomic:'9970',payout_count:2});
 for(const [kind,value] of [['creator',creator],['referral',referral]]){
  validateCreatorEarnings(value,toolId,{kind});
  assert.throws(()=>validateCreatorEarnings({...value,available_atomic:String(BigInt(value.available_atomic)+1n)},toolId,{kind}));
  assert.throws(()=>validateCreatorEarnings({...value,accrued_atomic:String(BigInt(value.accrued_atomic)+1n)},toolId,{kind}));
  assert.throws(()=>validateCreatorEarnings({...value,fractional_atom_numerator:value.fractional_atom_denominator},toolId,{kind}));
 }
 assert.match(creatorEarningsText(creator,{readAt}),/Fractional carry: 9\/10/);
 assert.match(creatorEarningsText(referral,{readAt,kind:'referral'}),/Fractional carry: 100\/10000/);
});

test('only a complete validated zero snapshot displays zero; metadata approval never implies earnings',()=>{
 const value=earnings('creator','0',{execution_status:'metadata_only_not_earning'});
 const text=creatorEarningsText(value,{readAt});
 assert.match(text,/metadata only; not currently installed to earn/);assert.match(text,/Available: 0.000000 USDC/);
 assert.match(text,/browser time/);assert.match(text,/does not update automatically/);
 assert.match(text,/facilitator-confirmed settlements; not independently reconciled/);
 assert.throws(()=>validateCreatorEarnings({...value,receipt_count:1},toolId));
 assert.throws(()=>validateCreatorEarnings(earnings('creator','1',{receipt_count:0}),toolId));
 const priorPaid=earnings('creator','100',{execution_status:'metadata_only_not_earning',confirmed_paid_atomic:'90',available_atomic:'0',payout_count:1});
 assert.match(creatorEarningsText(priorPaid,{readAt}),/Confirmed paid: 0.000090 USDC/);
});

test('unexpected fields, identities, denominations, shares, basis and readiness fail closed',()=>{
 const wrong=[{tool_id:otherTool},{tool_id:'<img src=x>'},{api_version:'2'},{network:'eip155:1'},{asset:'0x'+'1'.repeat(40)},{share_bps:100},{revenue_basis:'net'},{fees:'deduct gas'},{transfers_enabled:true},{payment_effect:'paid'},{execution_status:'earning'},{fractional_atom_denominator:'10000'},{receipt_basis:'verified'},{payout_basis:'broadcast'},{receipt_count:5001},{payout_count:-1},{gross_atomic:1000001},{extra:'unexpected'}];
 for(const change of wrong)assert.throws(()=>validateCreatorEarnings(earnings('creator','1000001',change),toolId),JSON.stringify(change));
 for(const value of [null,[],{},Object.fromEntries(Object.entries(earnings()).filter(([key])=>key!=='available_atomic'))])assert.throws(()=>validateCreatorEarnings(value,toolId));
 for(const change of [{referral_code:'ref_bad'},{terms_version:'unknown'},{share_bps:9000},{fractional_atom_denominator:'10'},{tool_id:toolId},{execution_status:'installed_adapter'}])assert.throws(()=>validateCreatorEarnings(earnings('referral','1000001',change),null,{kind:'referral'}));
});

test('every request is a fixed GET with only the matching private capability header and no URL secret',async()=>{
 for(const kind of ['creator','referral']){
  const capability=kind==='creator'?creatorCapability:referralCapability,fixture=setup([json(earnings(kind))],{kind});
  await fixture.client.read(kind==='creator'?toolId:null,capability);
  assert.equal(fixture.calls.length,1);const call=fixture.calls[0];
  assert.equal(call.path,kind==='creator'?`/v1/creator-tools/${toolId}/earnings`:'/v1/referrals/me/earnings');
  assert.equal(call.method,'GET');assert.equal(call.headers[kind==='creator'?'X-Creator-Capability':'X-Referral-Capability'],capability);
  assert.equal(call.cache,'no-store');assert.equal(call.credentials,'omit');assert.equal(call.redirect,'error');assert.equal(call.referrerPolicy,'no-referrer');
  assert(!Object.hasOwn(call,'body'));assert(!call.path.includes(capability));assert(!call.path.includes('?'));
 }
});

test('invalid capabilities and user-controlled paths are rejected before fetching',async()=>{
 const fixture=setup();
 for(const id of ['../../collect',toolId+'?cap='+creatorCapability,toolId.toUpperCase(),'https://example.org/earnings'])await assert.rejects(fixture.client.read(id,creatorCapability));
 for(const capability of ['',referralCapability,creatorCapability+'A','atbc_'+ 'A'.repeat(42)+'B'])await assert.rejects(fixture.client.read(toolId,capability));
 assert.equal(fixture.calls.length,0);
 const referral=setup([],{kind:'referral'});await assert.rejects(referral.client.read(toolId,referralCapability));await assert.rejects(referral.client.read(null,creatorCapability));assert.equal(referral.calls.length,0);
 assert.throws(()=>createCreatorEarningsClient({kind:'../collect'}));
});

test('HTTP, malformed, mismatched and network errors never expose server or transport text containing a capability',async()=>{
 for(const response of [json({error:{message:creatorCapability}},403),json({error:creatorCapability},429),json({error:creatorCapability},503),new Response(creatorCapability),json(earnings('creator','1000001',{tool_id:otherTool})),new Error('network '+creatorCapability)]){
  const fixture=setup([response]);
  await assert.rejects(fixture.client.read(toolId,creatorCapability),error=>!error.message.includes(creatorCapability)&&/No balance was assumed|no balance was assumed/.test(error.message));
 }
});

test('a timeout rejects even an uncooperative fetch and never resolves an invented balance',async()=>{
 const fixture=setup([()=>new Promise(()=>{})],{timeoutMs:5});
 await assert.rejects(fixture.client.read(toolId,creatorCapability),/timed out/);
 assert.equal(fixture.calls[0].signal.aborted,true);
});

test('clearing or superseding a read discards a late response even if fetch ignores cancellation',async()=>{
 const first=deferred(),second=deferred(),fixture=setup([()=>first.promise,()=>second.promise]);
 const old=fixture.client.read(toolId,creatorCapability),next=fixture.client.read(otherTool,otherCapability);
 assert.equal(await old,null);assert(fixture.calls[0].signal.aborted);
 first.resolve(json(earnings()));second.resolve(json(earnings('creator','0',{tool_id:otherTool})));
 assert.equal((await next).earnings.tool_id,otherTool);
 const waiting=deferred(),cleared=setup([()=>waiting.promise]);const read=cleared.client.read(toolId,creatorCapability);cleared.client.clear();assert.equal(await read,null);waiting.resolve(json(earnings()));
});

class Element{
 constructor(){this.value='';this.textContent='';this.hidden=true;this.disabled=false;this.events={};this.attributes={};}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(event,handler){(this.events[event]??=[]).push(handler);}
 async emit(event,value={}){return Promise.all((this.events[event]??[]).map(handler=>handler(value)));}
}
function uiFixture(client,kind='creator'){
 const keys=['[data-creator-earnings-form]','[data-read-earnings]','[role="status"]','[data-earnings-result]',...(kind==='creator'?['[data-earnings-tool]']:[])];
 const elements=new Map(keys.map(key=>[key,new Element()])),root={querySelector:key=>elements.get(key)??null},capabilityInput=new Element(),lifecycleTarget=new Element();
 const get=key=>elements.get(key);capabilityInput.value=kind==='creator'?creatorCapability:referralCapability;
 if(kind==='creator')get('[data-earnings-tool]').value=toolId;
 bindCreatorEarnings(root,{kind,capabilityInput,client,lifecycleTarget});
 return {get,capabilityInput,lifecycleTarget,submit:()=>get('[data-creator-earnings-form]').emit('submit',{preventDefault(){}}),result:get('[data-earnings-result]'),status:get('[role="status"]'),button:get('[data-read-earnings]')};
}

test('successful UI reads display exact money via textContent and a failed refresh removes old balances',async()=>{
 const fixture=setup([json(earnings()),json({error:{message:creatorCapability}},503)]),ui=uiFixture(fixture.client);
 assert.equal(ui.button.hidden,false);await ui.submit();assert.equal(ui.result.hidden,false);assert.match(ui.result.textContent,/Gross sales: 1.000001 USDC/);assert.match(ui.result.textContent,new RegExp(readAt.replaceAll('.','\\.')));
 await ui.submit();assert.equal(ui.result.hidden,true);assert.equal(ui.result.textContent,'');assert.match(ui.status.textContent,/No balance was assumed|no balance was assumed/);assert(!ui.status.textContent.includes(creatorCapability));
});

test('earnings exposes busy state while reading and clears it after a failed refresh',async()=>{
 const waiting=deferred(),fixture=setup([()=>waiting.promise]),ui=uiFixture(fixture.client),pending=ui.submit();
 assert.equal(ui.button.attributes['aria-busy'],'true');assert.match(ui.status.textContent,/Reading private earnings/);waiting.resolve(json({},503));await pending;assert.equal(ui.button.attributes['aria-busy'],'false');assert.equal(ui.button.disabled,false);assert.equal(ui.result.hidden,true);
});

test('capability or tool edits hide old results immediately and cannot display a stale pending response',async()=>{
 for(const field of ['capability','tool']){
  const waiting=deferred(),fixture=setup([json(earnings()),()=>waiting.promise]),ui=uiFixture(fixture.client);
  await ui.submit();assert(!ui.result.hidden);const pending=ui.submit();assert(ui.button.disabled);
  const input=field==='capability'?ui.capabilityInput:ui.get('[data-earnings-tool]');input.value=field==='capability'?otherCapability:otherTool;await input.emit('input');
  assert(ui.result.hidden);assert.equal(ui.result.textContent,'');assert(!ui.button.disabled);waiting.resolve(json(earnings()));await pending;assert(ui.result.hidden);
 }
});

test('programmatic identity changes without an input event still discard a pending result',async()=>{
 const waiting=deferred(),fixture=setup([()=>waiting.promise]),ui=uiFixture(fixture.client),pending=ui.submit();
 ui.capabilityInput.value=otherCapability;waiting.resolve(json(earnings()));await pending;assert(ui.result.hidden);assert.match(ui.status.textContent,/Inputs changed/);
});

test('concurrent clicks produce one read, and an edited identity can begin a new read safely',async()=>{
 const first=deferred(),second=deferred(),fixture=setup([()=>first.promise,()=>second.promise]),ui=uiFixture(fixture.client);
 const old=ui.submit();await ui.submit();assert.equal(fixture.calls.length,1);
 ui.get('[data-earnings-tool]').value=otherTool;await ui.get('[data-earnings-tool]').emit('change');const next=ui.submit();assert.equal(fixture.calls.length,2);
 second.resolve(json(earnings('creator','0',{tool_id:otherTool})));await next;first.resolve(json(earnings()));await old;
 assert(!ui.result.hidden);assert(ui.result.textContent.includes(otherTool));assert(!ui.result.textContent.includes(toolId));assert(!ui.button.disabled);
});

test('referral UI uses no tool ID and clears private balances when the page is hidden',async()=>{
 const fixture=setup([json(earnings('referral'))],{kind:'referral'}),ui=uiFixture(fixture.client,'referral');
 await ui.submit();assert(!ui.result.hidden);assert.match(ui.result.textContent,/Referral share: 1%/);assert.match(ui.result.textContent,/first-party tools only/);assert.match(ui.result.textContent,/ref_11111111/);
 await ui.lifecycleTarget.emit('pagehide');assert(ui.result.hidden);assert.equal(ui.result.textContent,'');
});
