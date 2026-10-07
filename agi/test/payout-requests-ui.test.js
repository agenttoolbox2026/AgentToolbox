import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {payoutRequestSection} from '../src/payout-request-section.js';
import {parsePayoutUsdc,validatePayoutEnvelope,validatePayoutRequest,payoutRequestText,createPayoutRequestsClient,bindPayoutRequests} from '../public/payout-requests.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`,tool='creator-'+id(20),referral='ref_'+id(21),address='0x'+'1'.repeat(40),asset='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const caps={creator:'atbc_'+'A'.repeat(43),referral:'atbf_'+'A'.repeat(43)},otherCap='atbc_'+'B'.repeat(42)+'A';
const wallet=(extra={})=>({claim_id:id(2),revision:1,network:'eip155:8453',address,created_at:'2026-10-07T12:00:00.000Z',ownership_status:'unverified',ownership_proof:null,owner_approval:{status:'pending'},payment_effect:'none',...extra});
const wallets=(claim=wallet())=>({api_version:'1',wallet:claim,history:claim?[claim]:[],next_cursor:null});
const earnings=(kind='creator',extra={})=>({api_version:'1',...(kind==='creator'?{tool_id:tool,execution_status:'installed_adapter'}:{referral_code:referral,terms_version:'first-party-referrals-2026-10-07.v1'}),network:'eip155:8453',asset,share_bps:kind==='creator'?9000:100,revenue_basis:'gross',gross_atomic:kind==='creator'?'10000000':'900000000',accrued_atomic:'9000000',fractional_atom_numerator:'0',fractional_atom_denominator:kind==='creator'?'10':'10000',confirmed_paid_atomic:'0',reserved_atomic:'0',available_atomic:'9000000',receipt_count:1,payout_count:0,receipt_basis:'facilitator_confirmed_not_independently_reconciled',payout_basis:'finalized_canonical_base_usdc_transfer',fees:kind==='creator'?'platform_share_only; no creator deductions':'platform funds gas separately; no referral deductions',transfers_enabled:false,payment_effect:'none',...extra});
const response=(e,extra={})=>({api_version:'1',request_id:e.body.request_id,beneficiary_kind:e.kind.split('_')[0],subject_id:e.subject_id,amount_atomic:e.body.amount_atomic,network:'eip155:8453',asset,claim_id:e.claim_id,claim_revision:e.body.claim_revision,created_at:'2026-10-07T12:10:00.000Z',state:'requested',payout:null,payment_effect:'none',...extra});
const receipt=()=>({transaction_hash:'0x'+'1'.repeat(64),block_hash:'0x'+'2'.repeat(64),block_number:'0x1234',log_index:'0x0',checked_at:'2026-10-07T12:12:00.000Z',basis:'finalized_canonical_base_usdc_transfer'});
const paid=e=>response(e,{state:'paid',payout:{payout_id:id(3),batch_id:id(4),state:'paid',revision:3,amount_atomic:e.body.amount_atomic,created_at:'2026-10-07T12:11:00.000Z',receipt:receipt()}});
const json=(data,status=200)=>Response.json(data,{status});
function setup(responses=[],{kind='creator',...options}={}){
 let ids=0;const calls=[],client=createPayoutRequestsClient({kind,cryptoImpl:{subtle:webcrypto.subtle,randomUUID:()=>id(++ids)},fetchImpl:async(path,init)=>{calls.push({path,...init});const next=responses.shift();if(next instanceof Error)throw next;if(typeof next==='function')return next(path,init);assert(next instanceof Response,'Unexpected request '+path);return next;},...options});return {client,calls,responses,kind,ids:()=>ids};
}
async function prepared({kind='creator',responses=[]}={}){const f=setup([json(wallets()),json(earnings(kind)),...responses],{kind});await f.client.read(kind==='creator'?tool:null,caps[kind]);const text=await f.client.prepare('1.234567',kind==='creator'?tool:null,caps[kind]);return {...f,text,envelope:JSON.parse(text)};}
const posts=f=>f.calls.filter(c=>c.method==='POST');
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};

test('shared sections provide exact export/import, distinct IDs, no native credential form and no-JS header guidance',async()=>{
 for(const kind of ['creator','referral']){const html=payoutRequestSection({kind});assert.match(html,/data-payout-requests/);assert.match(html,/data-payout-envelope[^>]*readonly/);assert.match(html,/data-payout-read hidden/);assert.match(html,/data-payout-prepare hidden/);assert.match(html,/A request holds no funds/);assert.match(html,/proof and separate owner approval/);assert.match(html,/<noscript>.*OpenAPI/);assert.doesNotMatch(html,/<form|name=".*cap|<script|localStorage/);assert.equal(html.includes('data-payout-tool'),kind==='creator');assert.match(html,new RegExp('X-'+(kind==='creator'?'Creator':'Referral')+'-Capability'));}
 const js=await readFile(new URL('../public/payout-requests.js',import.meta.url),'utf8');assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|document\.cookie|innerHTML|insertAdjacentHTML|personal_sign|eth_sendTransaction|eth_sign|window\.ethereum/);assert.doesNotMatch(js,/document\.querySelectorAll/);assert.throws(()=>payoutRequestSection({kind:'admin'}));
});

test('USDC uses exact BigInt amounts, six decimals and uint256 boundaries',()=>{
 for(const [input,expected] of [['0.000001','1'],['1','1000000'],['1.2','1200000'],['9007199254740993.123456','9007199254740993123456']])assert.equal(parsePayoutUsdc(input),expected);
 const max=(1n<<256n)-1n,decimal=`${max/1000000n}.${(max%1000000n).toString().padStart(6,'0')}`;assert.equal(parsePayoutUsdc(decimal),String(max));
 for(const invalid of ['0','0.000000','01','1.0000001','-1','+1','1e6','1,000',' 1','1.','NaN',1,`${(max+1n)/1000000n}.${((max+1n)%1000000n).toString().padStart(6,'0')}`])assert.throws(()=>parsePayoutUsdc(invalid));
});

test('preparation requires validated current wallet and exact consistent earnings without sending',async()=>{
 const f=setup();await assert.rejects(f.client.prepare('1',tool,caps.creator),/Read a saved current wallet/);assert.equal(f.calls.length,0);
 for(const [walletValue,balance] of [[wallets(null),earnings()],[wallets(),earnings('creator',{available_atomic:'9000001'})],[wallets(wallet({revision:0})),earnings()]]){
  const bad=setup([json(walletValue),json(balance)]);try{await bad.client.read(tool,caps.creator);}catch{}await assert.rejects(bad.client.prepare('1',tool,caps.creator));assert.equal(posts(bad).length,0);
 }
 const ready=await prepared();assert.equal(ready.envelope.body.amount_atomic,'1234567');assert.equal(ready.envelope.claim_id,id(2));assert.equal(ready.envelope.capability_hash,createHash('sha256').update(caps.creator).digest('hex'));assert(!ready.text.includes(caps.creator));assert.equal(posts(ready).length,0);
 ready.client.startNew();await ready.client.read(tool,caps.creator).catch(()=>{});await assert.rejects(ready.client.prepare('1',tool,caps.creator));
});

test('both kinds use fixed private paths, headers and exact three-field body with capability resolved referral identity',async()=>{
 for(const kind of ['creator','referral']){
  const f=await prepared({kind});f.responses.push(json(response(f.envelope)));await f.client.send(caps[kind]);
  for(const c of f.calls){assert(c.path.startsWith(kind==='creator'?'/v1/creat':'/v1/referrals/me/'));assert.equal(c.headers[kind==='creator'?'X-Creator-Capability':'X-Referral-Capability'],caps[kind]);assert.equal(c.cache,'no-store');assert.equal(c.credentials,'omit');assert.equal(c.redirect,'error');assert.equal(c.referrerPolicy,'no-referrer');assert(!c.path.includes(caps[kind]));}
  assert.deepEqual(JSON.parse(posts(f)[0].body),f.envelope.body);assert.deepEqual(Object.keys(JSON.parse(posts(f)[0].body)),['request_id','amount_atomic','claim_revision']);assert.equal(f.client.snapshot().phase,'confirmed');assert.equal(f.client.snapshot().current,null);
 }
});

test('amount above available and malformed paths, capabilities, or referral subject do not create requests',async()=>{
 const f=setup([json(wallets()),json(earnings())]);await f.client.read(tool,caps.creator);await assert.rejects(f.client.prepare('9.000001',tool,caps.creator),/exceeds/);assert.equal(f.ids(),0);
 const g=setup();for(const bad of ['../../collect',tool+'?x=1','https://example.com'])await assert.rejects(g.client.read(bad,caps.creator));for(const cap of [caps.referral,otherCap+'A',''])await assert.rejects(g.client.read(tool,cap));assert.equal(g.calls.length,0);
 const referralClient=setup([],{kind:'referral'});await assert.rejects(referralClient.client.read(referral,caps.referral));assert.equal(referralClient.calls.length,0);
});

test('export/import across reload is bound by kind, subject, claim and capability without POST or a replacement UUID',async()=>{
 const original=await prepared(),reload=setup();assert.equal(await reload.client.restore(original.text,caps.creator),original.text);assert.equal(reload.calls.length,0);assert.equal(reload.ids(),0);assert.equal(reload.client.snapshot().phase,'uncertain');assert.throws(()=>reload.client.startNew(),/may already exist/);
 reload.responses.push(json(response(original.envelope)));await reload.client.send(caps.creator);assert.deepEqual(JSON.parse(posts(reload)[0].body),original.envelope.body);assert.equal(reload.ids(),0);
 await assert.rejects(setup().client.restore(original.text,otherCap));await assert.rejects(setup([],{kind:'referral'}).client.restore(original.text,caps.referral));
 for(const mutate of [e=>{e.path='https://example.com';},e=>{e.kind='referral_payout_request';},e=>{e.subject_id='../../collect';},e=>{e.body.amount_atomic='01';},e=>{e.body.claim_revision=0;},e=>{e.body.request_id=caps.creator;},e=>{e.address=address;},e=>{e.body.capability=caps.creator;},e=>{e.capability_hash='x'.repeat(64);}]){const e=structuredClone(original.envelope);mutate(e);const f=setup();await assert.rejects(f.client.restore(JSON.stringify(e),caps.creator));assert.equal(f.calls.length,0);assert.equal(f.client.snapshot().envelope,null);}
 await assert.rejects(setup().client.restore(' '.repeat(4097),caps.creator));await assert.rejects(setup().client.restore('{',caps.creator));
});

test('uncertain POST retains exact request; later 409 or 404 cannot unlock replacement; GET resolution confirms old amount and claim',async()=>{
 const f=await prepared();f.responses.push(new Error('lost'));await assert.rejects(f.client.send(caps.creator),/uncertain/);assert.equal(f.client.snapshot().envelope,f.text);assert.throws(()=>f.client.startNew());
 f.responses.push(json({},409));await assert.rejects(f.client.send(caps.creator));assert.equal(f.client.snapshot().phase,'uncertain');f.responses.push(json({},404));await assert.rejects(f.client.resolve(caps.creator));assert.equal(f.client.snapshot().phase,'uncertain');assert.throws(()=>f.client.startNew());
 f.responses.push(json(response(f.envelope)));await f.client.resolve(caps.creator);assert.equal(f.client.snapshot().phase,'confirmed');assert.equal(f.calls.at(-1).path,`${f.envelope.path}/${f.envelope.body.request_id}`);assert(posts(f).every(call=>call.body===JSON.stringify(f.envelope.body)));assert.equal(f.ids(),1);
});

test('a definite first rejection allows an explicit new request but never silently retries a fresh ID',async()=>{
 const f=await prepared();f.responses.push(json({},409));await assert.rejects(f.client.send(caps.creator));assert.equal(f.client.snapshot().phase,'rejected');assert.equal(f.ids(),1);f.client.startNew();assert.equal(f.client.snapshot().envelope,null);assert.equal(f.ids(),1);
});

test('response amount, request, claim, subject, chain and asset must match saved request before confirmation',async()=>{
 const base=await prepared();
 for(const extra of [{amount_atomic:'1'},{request_id:id(50)},{claim_id:id(51)},{claim_revision:2},{subject_id:'creator-'+id(52)},{beneficiary_kind:'referral'},{network:'eip155:1'},{asset:'0x'+'3'.repeat(40)},{payment_effect:'sent'},{request_id:[base.envelope.body.request_id]}]){
  const f=setup([json(response(base.envelope,extra))]);await f.client.restore(base.text,caps.creator);await assert.rejects(f.client.send(caps.creator),/uncertain/);assert.equal(f.client.snapshot().phase,'uncertain');assert.throws(()=>f.client.startNew());
 }
});

test('all payout states are explained; paid is rendered only with exact finalized receipt and consistent payout',async()=>{
 const f=await prepared(),p=paid(f.envelope);assert.equal(validatePayoutRequest(p,{kind:'creator',subject:tool}).state,'paid');assert.match(payoutRequestText(p),/backend verified a finalized/);
 for(const state of ['reserved','awaiting_owner','submitted','unknown','cancelled']){const v=structuredClone(p);v.state=state;v.payout.state=state;v.payout.receipt=null;assert.match(payoutRequestText(v),new RegExp('State: '+state));}
 for(const mutate of [v=>{v.payout=null;},v=>{v.payout.receipt=null;},v=>{v.payout.state='submitted';},v=>{v.payout.amount_atomic='1';},v=>{v.payout.receipt.basis='confirmed';},v=>{v.payout.receipt.transaction_hash='https://bad';},v=>{v.payout.receipt.block_hash=null;},v=>{v.payout.receipt.block_number=123;},v=>{v.payout.receipt.log_index='0x00';},v=>{v.payout.receipt.checked_at='2020-01-01T00:00:00Z';},v=>{v.payout.receipt.url='https://bad';}]){const v=structuredClone(p);mutate(v);assert.throws(()=>payoutRequestText(v));}
 const nonpaid=structuredClone(p);nonpaid.state='submitted';nonpaid.payout.state='submitted';assert.throws(()=>payoutRequestText(nonpaid));
});

test('bounded history rejects duplicates, malformed states, oversized pages and unsafe opaque cursors before exposing records',async()=>{
 const f=await prepared(),row=response(f.envelope),page={api_version:'1',requests:[row],next_cursor:'Ab_c-1',payment_effect:'none'};
 f.responses.push(json(earnings()),json(page));assert.equal((await f.client.history(tool,caps.creator)).requests.length,1);assert.match(f.calls.at(-1).path,/\?limit=20$/);
 f.responses.push(json(earnings()),json({...page,next_cursor:null}));await f.client.history(tool,caps.creator,'Ab_c-1');assert.match(f.calls.at(-1).path,/cursor=Ab_c-1$/);
 for(const value of [{...page,requests:[row,row]},{...page,requests:Array(21).fill(row)},{...page,next_cursor:'x'.repeat(513)},{...page,next_cursor:caps.creator},{...page,next_cursor:'https://bad'},{...page,requests:[{...row,state:'paid'}]}]){const g=setup([json(earnings()),json(value)]);await assert.rejects(g.client.history(tool,caps.creator));}
 for(const bad of ['a/b','x'.repeat(513),caps.creator]){const g=setup();await assert.rejects(g.client.history(tool,caps.creator,bad));assert.equal(g.calls.length,0);}
});

test('late wallet/earnings and history responses cannot revive an invalidated account; timeouts keep POST uncertain',async()=>{
 const pending=deferred(),f=setup([()=>pending.promise,json(earnings())]);const read=f.client.read(tool,caps.creator);await new Promise(resolve=>setTimeout(resolve,0));f.client.clearRead();pending.resolve(json(wallets()));await assert.rejects(read,/Inputs changed/);assert.equal(f.client.snapshot().current,null);await assert.rejects(f.client.prepare('1',tool,caps.creator));
 const g=await prepared();g.responses.push(()=>new Promise(()=>{}));const timeoutClient=setup(g.responses,{timeoutMs:5});await timeoutClient.client.restore(g.text,caps.creator);await assert.rejects(timeoutClient.client.send(caps.creator),/uncertain/);assert(timeoutClient.calls[0].signal.aborted);assert.equal(timeoutClient.client.snapshot().phase,'uncertain');
});

test('concurrent send cannot create a second POST or UUID and identity changes during hashing abort before POST',async()=>{
 const wait=deferred(),reached=deferred(),f=await prepared();f.responses.push(()=>{reached.resolve();return wait.promise;});const one=f.client.send(caps.creator);await reached.promise;await assert.rejects(f.client.send(caps.creator),/Wait/);assert.equal(posts(f).length,1);wait.resolve(json(response(f.envelope)));await one;assert.equal(f.ids(),1);
 const digest=deferred(),g=setup([],{cryptoImpl:{subtle:{digest:()=>digest.promise},randomUUID:()=>id(1)}});const restored=g.client.restore(f.text,caps.creator);digest.resolve(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(caps.creator)));await restored;
 const send=g.client.send(caps.creator);g.client.clearRead();await assert.rejects(send,/Inputs changed before sending/);assert.equal(g.calls.length,0);
});

class Element{constructor(){this.value='';this.textContent='';this.hidden=true;this.disabled=false;this.checked=false;this.events={};}addEventListener(type,fn){(this.events[type]??=[]).push(fn);}async emit(type,value={}){for(const fn of this.events[type]??[])await fn(value);}focus(){}select(){}}
function uiFixture(client,kind='creator'){
 const names=['tool','amount','read','history','prepare','current','prepared','envelope','summary','saved','send','resolve','new','copy','export','import','restore','file','result','history-result','more'],nodes=new Map(names.map(name=>[name,new Element()])),status=new Element(),capabilityInput=new Element(),lifecycleTarget=new Element();if(kind==='referral')nodes.delete('tool');
 const root={querySelector:selector=>selector==='[role="status"]'?status:nodes.get(selector.slice(13,-1))??null,querySelectorAll:()=>[...nodes.values()]};const copied=[];capabilityInput.value=caps[kind];if(kind==='creator')nodes.get('tool').value=tool;nodes.get('amount').value='1.234567';bindPayoutRequests(root,{kind,client,capabilityInput,lifecycleTarget,navigatorImpl:{clipboard:{writeText:async text=>{copied.push(text);}}}});return {get:name=>nodes.get(name),status,capabilityInput,lifecycleTarget,copied};
}

test('UI shows wallet, amount, export and acknowledgement before posting; visible mismatch prevents send',async()=>{
 const f=setup([json(wallets()),json(earnings())]),ui=uiFixture(f.client);await ui.get('read').emit('click');assert.match(ui.get('current').textContent,new RegExp(address));assert.match(ui.get('current').textContent,/9.000000 USDC/);await ui.get('prepare').emit('click');assert.equal(ui.get('prepared').hidden,false);assert.match(ui.get('summary').textContent,/1.234567 USDC/);assert.match(ui.get('summary').textContent,new RegExp(address));
 await ui.get('copy').emit('click');assert.equal(ui.copied[0],f.client.snapshot().envelope);assert(!ui.copied[0].includes(caps.creator));await ui.get('send').emit('click');assert.equal(posts(f).length,0);ui.get('saved').checked=true;ui.get('amount').value='2';await ui.get('send').emit('click');assert.equal(posts(f).length,0);assert.match(ui.status.textContent,/differs/);
 ui.get('amount').value='1.234567';f.responses.push(json(response(JSON.parse(f.client.snapshot().envelope))));await ui.get('send').emit('click');assert.equal(posts(f).length,1);assert.match(ui.get('result').textContent,/Request accepted/);await ui.get('prepare').emit('click');assert.match(ui.status.textContent,/may already have been recorded/);assert.doesNotMatch(ui.status.textContent,/Nothing sent/);
});

test('UI import sends nothing and exposes no unvalidated destination; changed capability hides current and historical results',async()=>{
 const original=await prepared(),f=setup(),ui=uiFixture(f.client);ui.get('import').value=original.text;await ui.get('restore').emit('click');assert.equal(f.calls.length,0);assert.equal(ui.get('new').disabled,true);assert.doesNotMatch(ui.get('summary').textContent,new RegExp(address));assert.match(ui.get('summary').textContent,/Re-read/);
 f.responses.push(json(response(original.envelope)));await ui.get('resolve').emit('click');assert.equal(ui.get('result').hidden,false);ui.capabilityInput.value=otherCap;await ui.capabilityInput.emit('input');assert.equal(ui.get('result').hidden,true);assert.equal(ui.get('result').textContent,'');assert.equal(ui.get('saved').checked,false);
 await ui.lifecycleTarget.emit('pagehide');assert.equal(ui.capabilityInput.value,'');
});

test('UI shared capability changes during status read never expose the previous account',async()=>{
 const pending=deferred(),f=setup([()=>pending.promise,json(earnings())]),ui=uiFixture(f.client);const read=ui.get('read').emit('click');await new Promise(resolve=>setTimeout(resolve,0));ui.capabilityInput.value=otherCap;await ui.capabilityInput.emit('change');pending.resolve(json(wallets()));await read;assert.equal(ui.get('current').hidden,true);assert.equal(ui.get('current').textContent,'');assert.equal(f.client.snapshot().current,null);
});

test('fetch and malformed JSON error text never leaks private capabilities into client or UI status',async()=>{
 for(const bad of [new Error('network URL leaked '+caps.creator),new Response('{'+caps.creator)]){
  const f=setup([bad]),ui=uiFixture(f.client);await ui.get('read').emit('click');assert.match(ui.status.textContent,/could not be read/);assert(!ui.status.textContent.includes(caps.creator));assert.equal(ui.get('current').hidden,true);
 }
 const original=await prepared(),f=setup(),ui=uiFixture(f.client);ui.get('import').value=original.text;await ui.get('restore').emit('click');f.responses.push(new Error(caps.creator));await ui.get('resolve').emit('click');assert(!ui.status.textContent.includes(caps.creator));assert.equal(ui.get('result').hidden,true);assert.equal(f.client.snapshot().phase,'uncertain');
 const direct=setup([new Error(caps.creator)]);await assert.rejects(direct.client.read(tool,caps.creator),error=>!error.message.includes(caps.creator));
});
