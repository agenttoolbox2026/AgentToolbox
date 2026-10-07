import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,webcrypto} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {creatorWalletPage,creatorWalletScript} from '../src/creator-wallet-page.js';
import {header,headerStylesheet} from '../src/header.js';
import {agentStylesheet} from '../src/pages.js';
import {formsStylesheet} from '../src/workflow-theme.js';
import {walletPath,validateWalletEnvelope,validateWalletView,walletStatusText,createWalletClient,bindCreatorWallet} from '../public/creator-wallet.js';

const capability='atbc_'+'A'.repeat(43),otherCapability='atbc_'+'B'.repeat(42)+'A';
const address='0x'+'1'.repeat(40),otherAddress='0x'+'2'.repeat(40);
const claim=(revision=1,extra={})=>({claim_id:'00000000-0000-4000-8000-000000000001',revision,network:'eip155:8453',address,created_at:'2026-10-07T12:00:00.000Z',ownership_status:'unverified',ownership_proof:null,owner_approval:{status:'pending'},payment_effect:'none',...extra});
const history=(wallet=null,rows=[])=>({api_version:'1',wallet,history:rows,next_cursor:null});
const json=(data,status=200)=>Response.json(data,{status});
function setup(responses=[],options={}){
 const calls=[];let ids=0;
 const client=createWalletClient({cryptoImpl:{subtle:webcrypto.subtle,randomUUID:()=>`00000000-0000-4000-8000-${String(++ids).padStart(12,'0')}`},fetchImpl:async(path,init)=>{
  calls.push({path,...init});const next=responses.shift();
  if(next instanceof Error)throw next;
  if(typeof next==='function')return next(path,init);
  assert(next instanceof Response,'Unexpected request.');return next;
 },...options});
 return {client,calls,responses,ids:()=>ids};
}
async function prepared(extraResponses=[]){
 const fixture=setup([json(history()),...extraResponses]);
 await fixture.client.read(capability);const envelope=await fixture.client.prepare(address,capability);
 return {...fixture,envelope};
}
const postCalls=fixture=>fixture.calls.filter(call=>call.method==='POST');

test('wallet page uses the shared document theme, exact title and a POST-only native fallback without named credentials',async()=>{
 const html=creatorWalletPage();
 for(const expected of [header('agents'),headerStylesheet,agentStylesheet,formsStylesheet,creatorWalletScript])assert(html.includes(expected));
 assert.match(html,/<title>AgentToolbox<\/title>/);
 assert.match(html,/<main id="main" class="document workflow-document">/);
 assert.match(html,/<form data-creator-wallet method="post" action="\/v1\/creators\/me\/payout-wallet" autocomplete="off">/);
 const input=html.match(/<input[^>]*data-capability[^>]*>/)[0];
 assert.match(input,/type="password"/);assert.doesNotMatch(input,/\bname=/);
 assert.doesNotMatch(html,/<form[^>]*method="get"|Generate.*capability|<script[^>]*>[^<]/i);
 assert.match(html,/UNVERIFIED/);assert.match(html,/Owner approval is separate/);
 assert.match(html,/data-wallet-envelope[^>]*readonly/);
 assert.match(html,/data-read-status hidden/);assert.match(html,/data-prepare-wallet hidden/);
 const js=await readFile(new URL('../public/creator-wallet.js',import.meta.url),'utf8');
 assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|insertAdjacentHTML|personal_sign|eth_sendTransaction|eth_sign|window\.ethereum/);
 assert.doesNotMatch(js,/payout-wallet\/(?:challenge|verify)/);
 const hash=createHash('sha256').update(js).digest('hex').slice(0,12);
 assert.equal(creatorWalletScript,`<script type="module" src="/creator-wallet.js?v=${hash}"></script>`);
});

test('preparation requires a validated current read; null alone establishes revision zero without sending a claim',async()=>{
 const fixture=setup([json(history())]);
 await assert.rejects(fixture.client.prepare(address,capability),/Read current wallet status/);
 assert.equal(fixture.calls.length,0);
 assert.equal(await fixture.client.read(capability),null);
 const text=await fixture.client.prepare(address,capability),envelope=JSON.parse(text);
 assert.equal(envelope.body.expected_revision,0);
 assert.equal(envelope.creator_secret_hash,createHash('sha256').update(capability).digest('hex'));
 assert.equal(text.includes(capability),false);
 assert.deepEqual(Object.keys(envelope.body),['request_id','expected_revision','network','address']);
 assert.equal(await fixture.client.prepare(address,capability),text);
 assert.equal(fixture.ids(),1);assert.equal(postCalls(fixture).length,0);
});

test('failed or malformed status cannot manufacture a zero revision; maximum revision cannot be extended',async()=>{
 for(const response of [json({error:{code:'unavailable'}},503),json({wallet:null}),new Response('not JSON')]){
  const fixture=setup([response]);await assert.rejects(fixture.client.read(capability));
  assert.equal(fixture.client.snapshot().revision,null);
  await assert.rejects(fixture.client.prepare(address,capability),/Read current wallet status/);
 }
 const fixture=setup([json(history(claim(2147483647)))]);
 await fixture.client.read(capability);await assert.rejects(fixture.client.prepare(address,capability),/revision limit/);
});

test('all requests use the fixed local endpoint and header capability; only the strict four-field body is posted',async()=>{
 const fixture=await prepared([json(claim())]);
 await fixture.client.send(capability);
 for(const call of fixture.calls){
  assert.equal(call.path,walletPath);assert.equal(call.headers['X-Creator-Capability'],capability);
  assert.equal(call.cache,'no-store');assert.equal(call.credentials,'omit');assert.equal(call.redirect,'error');assert.equal(call.referrerPolicy,'no-referrer');
  assert.equal(call.path.includes(capability),false);
 }
 const post=postCalls(fixture)[0];assert.equal(post.headers['Content-Type'],'application/json');
 assert.deepEqual(JSON.parse(post.body),JSON.parse(fixture.envelope).body);
 assert.equal(post.body.includes(capability),false);assert.equal(post.body.includes('creator_secret_hash'),false);
 assert.equal(fixture.client.snapshot().phase,'confirmed');assert.equal(fixture.client.snapshot().revision,null);
});

test('export/import across reload preserves exact body and request ID without a new read or credential export',async()=>{
 const source=await prepared(),reload=setup([json(claim())]);
 assert.equal(await reload.client.restore(source.envelope,capability),source.envelope);
 assert.equal(reload.calls.length,0);assert.equal(reload.ids(),0);
 assert.equal(reload.client.snapshot().phase,'uncertain');
 await reload.client.send(capability);
 assert.deepEqual(JSON.parse(postCalls(reload)[0].body),JSON.parse(source.envelope).body);
 assert.equal(reload.ids(),0);
});

test('an envelope stays bound to the separately retained capability during import, read, prepare and send',async()=>{
 const fixture=await prepared();
 const reload=setup();await assert.rejects(reload.client.restore(fixture.envelope,otherCapability),/original creator capability/);
 for(const operation of [()=>fixture.client.send(otherCapability),()=>fixture.client.read(otherCapability),()=>fixture.client.prepare(address,otherCapability)])await assert.rejects(operation(),/another creator capability/);
 assert.equal(postCalls(fixture).length,0);assert.equal(fixture.client.snapshot().envelope,fixture.envelope);
 assert.equal(fixture.client.snapshot().phase,'prepared');
});

test('malformed, oversized and redirected imports fail closed before any request',async()=>{
 const fixture=await prepared(),original=JSON.parse(fixture.envelope);
 const mutated=change=>{const value=structuredClone(original);change(value);return value;};
 const invalid=[
  {},mutated(value=>{value.capability=capability;}),mutated(value=>{value.path='https://example.com/collect';}),
  mutated(value=>{value.path=walletPath+'?capability='+capability;}),mutated(value=>{value.body.network='eip155:1';}),
  mutated(value=>{value.body.creator_secret_hash=value.creator_secret_hash;}),mutated(value=>{value.body.address='0x'+'0'.repeat(40);}),
  mutated(value=>{value.body.address='<script>alert(1)</script>';}),mutated(value=>{value.body.expected_revision=-1;}),
  mutated(value=>{value.body.expected_revision=2147483647;}),mutated(value=>{value.body.expected_revision=1.1;}),
  mutated(value=>{value.body.request_id='short';}),mutated(value=>{value.body.request_id='!'.repeat(32);}),
 ];
 for(const value of invalid){assert.throws(()=>validateWalletEnvelope(value));const target=setup();await assert.rejects(target.client.restore(JSON.stringify(value),capability));assert.equal(target.calls.length,0);}
 await assert.rejects(setup().client.restore(' '.repeat(4097),capability));
 await assert.rejects(setup().client.restore('{broken',capability));
 const frozen=validateWalletEnvelope(original);assert.throws(()=>{frozen.body.address=otherAddress;},TypeError);
});

test('network, timeout, server and malformed success responses retain the identical retry without replacing its identity',async()=>{
 const failures=[new Error('lost response'),new DOMException('timeout','AbortError'),json({error:{code:'timeout'}},408),json({error:{code:'offline'}},503),new Response('not JSON'),json(claim(2)),json(claim(1,{address:otherAddress}))];
 for(const failure of failures){
  const fixture=await prepared([failure,json(claim())]);
  await assert.rejects(fixture.client.send(capability),/outcome is uncertain/);
  assert.equal(fixture.client.snapshot().envelope,fixture.envelope);assert.equal(fixture.client.snapshot().phase,'uncertain');
  assert.throws(()=>fixture.client.startNew(),/may already have been recorded/);
  await assert.rejects(fixture.client.prepare(otherAddress,capability),/request is already prepared/);
  await fixture.client.send(capability);
  assert.equal(postCalls(fixture)[0].body,postCalls(fixture)[1].body);assert.equal(fixture.ids(),1);
 }
});

test('a later rate-limit or conflict cannot resolve an earlier uncertain write or authorize a replacement',async()=>{
 for(const status of [403,409,429]){
  const fixture=await prepared([new Error('lost'),json({error:{code:'rejected'}},status)]);
  await assert.rejects(fixture.client.send(capability));await assert.rejects(fixture.client.send(capability));
  assert.equal(fixture.client.snapshot().phase,'uncertain');assert.throws(()=>fixture.client.startNew());
  assert.equal(fixture.client.snapshot().envelope,fixture.envelope);
 }
});

test('definite rejection keeps request bytes and changing it requires an explicit reset plus fresh status read',async()=>{
 const fixture=await prepared([json({error:{code:'wallet_conflict',message:capability}},409),json(history(claim(3)))]);
 await assert.rejects(fixture.client.send(capability),error=>!error.message.includes(capability)&&/Wallet conflict/.test(error.message));
 assert.equal(fixture.client.snapshot().envelope,fixture.envelope);assert.equal(fixture.client.snapshot().phase,'rejected');
 fixture.client.startNew();await assert.rejects(fixture.client.prepare(otherAddress,capability),/Read current wallet status/);
 await fixture.client.read(capability);const next=JSON.parse(await fixture.client.prepare(otherAddress,capability));
 assert.equal(next.body.expected_revision,3);assert.notEqual(next.body.request_id,JSON.parse(fixture.envelope).body.request_id);
});

test('a restored invalid schema request can be corrected only after its deterministic backend rejection',async()=>{
 const source=await prepared(),fixture=setup([json({error:{code:'invalid_wallet_request'}},400)]);
 await fixture.client.restore(source.envelope,capability);assert.throws(()=>fixture.client.startNew());
 await assert.rejects(fixture.client.send(capability),/request was rejected/);
 assert.equal(fixture.client.snapshot().phase,'rejected');assert.equal(fixture.client.snapshot().envelope,source.envelope);
 fixture.client.startNew();await assert.rejects(fixture.client.prepare(address,capability),/Read current wallet status/);
});

test('old replay results stay distinct from the current head and history does not select the current revision',async()=>{
 const fixture=await prepared([json(history(claim(3),[claim(1)])),json(claim(1)),json(history(claim(3)))]);
 assert.equal((await fixture.client.read(capability)).revision,3);assert.equal(fixture.client.snapshot().revision,3);
 const result=await fixture.client.send(capability);
 assert.equal(result.revision,1);assert.match(walletStatusText(result,{current:false}),/may be an older revision/);
 assert.equal(fixture.client.snapshot().revision,null);
 assert.equal((await fixture.client.read(capability)).revision,3);
 assert.equal(JSON.parse(fixture.client.snapshot().envelope).body.expected_revision,0);
});

test('proof and owner approval display independently and malformed proof cannot be called verified',()=>{
 assert.match(walletStatusText(claim()),/Ownership: UNVERIFIED\nOwner approval: pending/);
 const verified=claim(1,{ownership_status:'eoa_signature_verified',ownership_proof:{verified_at:'2026-10-07T12:01:00Z',method:'eoa_erc191',erc1271_supported:false}});
 assert.match(walletStatusText(verified),/EOA signature verified by the backend\nOwner approval: pending/);
 assert.match(walletStatusText({...verified,owner_approval:{status:'approved',approved_at:'2026-10-07T12:02:00Z'}}),/Owner approval: approved\nNo payout initiated/);
 for(const value of [claim(1,{ownership_status:'eoa_signature_verified'}),claim(1,{payment_effect:'paid'}),claim(1,{address:'<script>bad</script>'}),claim(1,{owner_approval:{status:'paid'}})])assert.throws(()=>validateWalletView(value));
});

test('concurrent sends are rejected without another fetch or request identity',async()=>{
 let finish,entered;const fetching=new Promise(resolve=>{entered=resolve;});
 const fixture=await prepared([()=>new Promise(resolve=>{finish=resolve;entered();})]);
 const first=fixture.client.send(capability);
 await fetching;
 await assert.rejects(fixture.client.send(capability),/Wait for the current/);
 assert.equal(postCalls(fixture).length,1);assert.equal(fixture.ids(),1);
 finish(json(claim()));await first;
});

class Element{
 constructor(){this.value='';this.textContent='';this.hidden=true;this.disabled=false;this.checked=false;this.events={};}
 addEventListener(event,handler){this.events[event]=handler;}
 emit(event,value={}){return this.events[event]?.(value);}
 focus(){this.focused=true;}
 select(){this.selected=true;}
}
function formFixture(client){
 const selectors=['data-capability','data-wallet-address','data-wallet-current','data-current-revision','data-wallet-prepared','data-wallet-envelope','data-wallet-saved','data-wallet-result','data-wallet-import','data-new-wallet','data-read-status','data-prepare-wallet','data-restore-wallet','data-copy-wallet','data-export-wallet','data-wallet-file','data-send-wallet'];
 const elements=new Map(selectors.map(key=>['['+key+']',new Element()]));elements.set('[role="status"]',new Element());
 const form=new Element();form.querySelector=selector=>{assert(elements.has(selector),selector);return elements.get(selector);};form.querySelectorAll=()=>[...elements.values()];
 const copied=[];bindCreatorWallet(form,{client,navigatorImpl:{clipboard:{writeText:async text=>{copied.push(text);}}}});
 const get=name=>elements.get('['+name+']');get('data-capability').value=capability;get('data-wallet-address').value=address;
 return {form,get,copied,status:elements.get('[role="status"]')};
}

test('the form reveals and copies the envelope before an acknowledged send, and import never posts',async()=>{
 const fixture=setup([json(history()),json(claim())]),ui=formFixture(fixture.client);
 await ui.get('data-read-status').emit('click');await ui.get('data-prepare-wallet').emit('click');
 assert.equal(ui.get('data-wallet-prepared').hidden,false);assert.equal(postCalls(fixture).length,0);
 await ui.get('data-copy-wallet').emit('click');assert.equal(ui.copied[0],fixture.client.snapshot().envelope);assert.equal(ui.copied[0].includes(capability),false);
 let prevented=false;await ui.form.emit('submit',{preventDefault(){prevented=true;}});assert(prevented);assert.equal(postCalls(fixture).length,0);
 ui.get('data-wallet-saved').checked=true;await ui.form.emit('submit',{preventDefault(){}});assert.equal(postCalls(fixture).length,1);
 assert.match(ui.get('data-wallet-result').textContent,/may be an older revision/);
 await ui.get('data-prepare-wallet').emit('click');
 assert.match(ui.status.textContent,/may already have been recorded/);assert.doesNotMatch(ui.status.textContent,/Nothing sent/);
 const restored=setup(),restoredUi=formFixture(restored.client);restoredUi.get('data-wallet-import').value=ui.copied[0];
 await restoredUi.get('data-restore-wallet').emit('click');assert.equal(restored.calls.length,0);assert.equal(restoredUi.get('data-wallet-envelope').value,ui.copied[0]);
 assert.equal(restoredUi.get('data-new-wallet').disabled,true);
 assert.match(restoredUi.status.textContent,/may already have been recorded/);
});

test('capability controls lock during reads and a changed identity cannot expose or reuse the old status',async()=>{
 let finish,entered;const fetching=new Promise(resolve=>{entered=resolve;});
 const fixture=setup([()=>new Promise(resolve=>{finish=resolve;entered();})]),ui=formFixture(fixture.client);
 const pending=ui.get('data-read-status').emit('click');
 await fetching;assert.equal(ui.get('data-capability').disabled,true);
 ui.get('data-capability').value=otherCapability;ui.get('data-capability').emit('input');finish(json(history(claim(4))));await pending;
 assert.equal(ui.get('data-wallet-current').hidden,true);assert.equal(ui.get('data-current-revision').value,'');
 assert.equal(fixture.client.snapshot().revision,null);
 await assert.rejects(fixture.client.prepare(address,otherCapability),/Read current wallet status/);
});

test('the visible address is readonly while retained and a changed display cannot send another address silently',async()=>{
 const fixture=setup([json(history())]),ui=formFixture(fixture.client);
 await ui.get('data-read-status').emit('click');await ui.get('data-prepare-wallet').emit('click');
 assert.equal(ui.get('data-wallet-address').readOnly,true);
 ui.get('data-wallet-saved').checked=true;ui.get('data-wallet-address').value=otherAddress;
 await ui.form.emit('submit',{preventDefault(){}});assert.equal(postCalls(fixture).length,0);assert.match(ui.status.textContent,/visible address differs/);
 ui.get('data-wallet-address').emit('input');assert.equal(ui.get('data-wallet-saved').checked,false);
});
