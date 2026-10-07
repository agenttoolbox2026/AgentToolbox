import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {walletProofSection} from '../src/wallet-proof-section.js';
import {proofOrigin,proofWalletPath,validateProofChallenge,validateProofEnvelope,createWalletProofClient,bindWalletProof} from '../public/wallet-proof.js';
import {canonical} from '../../platform/src/x402.js';
import {hash} from '../../platform/src/telemetry.js';
import {database} from '../../platform/scripts/local-db.js';
import {claimWallet,challengeWallet,getWallet,verifyWallet} from '../../platform/src/creator-wallets.js';

const cap='atbc_'+'A'.repeat(43),other='atbc_'+'B'.repeat(42)+'A',referral='atbf_'+'A'.repeat(43),signature='0x'+'12'.repeat(65),start=Date.parse('2026-10-07T12:00:00.000Z');
const address='0x'+'1'.repeat(40),id='00000000-0000-4000-8000-000000000001',challengeId='00000000-0000-4000-8000-000000000002';
const wallet=(extra={})=>({claim_id:id,revision:1,network:'eip155:8453',address,created_at:new Date(start).toISOString(),ownership_status:'unverified',ownership_proof:null,owner_approval:{status:'pending'},payment_effect:'none',...extra});
const binding=({claim_id,revision,network,address})=>({claim_id,revision,network,address});
const verified=(extra={})=>wallet({ownership_status:'eoa_signature_verified',ownership_proof:{verified_at:new Date(start+1000).toISOString(),method:'eoa_erc191',erc1271_supported:false},...extra});
const history=(v=wallet())=>({api_version:'1',wallet:v,history:[],next_cursor:null});
function challenge(kind='creator'){
 const referral=kind==='referral',expires_at=new Date(start+300000).toISOString();
 return {challenge_id:challengeId,claim_revision:1,address,message:`agi.agenttoolbox2026.workers.dev wants you to sign in with your Ethereum account:\n${address}\n\nProve ownership of an AGI ${referral?'referral ':''}payout destination. This does not authorize payment.\n\nURI: ${proofOrigin}\nVersion: 1\nChain ID: 8453\nNonce: ${'a'.repeat(32)}\nIssued At: ${new Date(start).toISOString()}\nExpiration Time: ${expires_at}\nRequest ID: ${challengeId}\nResources:\n- urn:agi:${referral?'referral:':''}action:payout-destination-proof\n- urn:agi:${referral?'referral:subject':'creator'}:${'b'.repeat(64)}\n- urn:agi:${referral?'referral:':''}wallet-claim:${id}:revision:1`,expires_at,method:'eoa_erc191',erc1271_supported:false,payment_effect:'none'};
}
const json=(body,status=200)=>Response.json(body,{status});
function setup(responses=[],options={}){
 let ids=0,time=start;const calls=[];
 const client=createWalletProofClient({cryptoImpl:{subtle:webcrypto.subtle,randomUUID:()=>`00000000-0000-4000-8000-${String(++ids+10).padStart(12,'0')}`},now:()=>time,fetchImpl:async(path,init)=>{calls.push({path,...init});const response=responses.shift();if(response instanceof Error)throw response;if(typeof response==='function')return response(path,init);assert(response instanceof Response,'Unexpected fetch');return response;},...options});
 return {client,calls,responses,advance:ms=>{time+=ms;},ids:()=>ids};
}
async function prepared(responses=[],options={}){const fixture=setup([json(history()),...responses],options),secret=options.kind==='referral'?referral:cap;await fixture.client.read(secret);await fixture.client.prepareChallenge(secret);return fixture;}
async function proofPrepared(responses=[],options={}){const fixture=await prepared([json(challenge(options.kind)),...responses],options),secret=options.kind==='referral'?referral:cap;await fixture.client.sendChallenge(secret);await fixture.client.prepareVerify(signature,secret);return fixture;}
const posts=f=>f.calls.filter(c=>c.method==='POST');

test('the real creator backend challenge passes exact frontend parsing without signing or network use',async()=>{
 const db=database();try{
  await db.prepare('INSERT INTO platform_creators VALUES(?,?,?)').bind('proof-ui-fixture',createHash('sha256').update(cap).digest('hex'),new Date(start).toISOString()).run();
  const saved=await claimWallet({db,capability:cap,now:()=>new Date(start),body:{request_id:'proof_ui_fixture_request_00000000001',expected_revision:0,network:'eip155:8453',address}});
  const result=await challengeWallet({db,capability:cap,origin:proofOrigin,now:()=>new Date(start),body:{request_id:'proof_ui_fixture_challenge_00000001',claim_revision:1}});
  assert.deepEqual(validateProofChallenge(result,binding(saved),{now:start}),result);
 }finally{db.close();}
});

test('creator and referral proofs use distinct allowlisted endpoints, headers, messages and exact bodies',async()=>{
 for(const kind of ['creator','referral']){
  const secret=kind==='creator'?cap:referral,fixture=await proofPrepared([json(verified())],{kind});
  const saved=fixture.client.snapshot().envelope;assert(!saved.includes(secret));
  assert.equal(JSON.parse(saved).creator_secret_hash,createHash('sha256').update(secret).digest('hex'));
  await fixture.client.sendVerify(secret);
  assert.equal(fixture.client.snapshot().phase,'verified');assert.equal(fixture.ids(),1);
  const path=kind==='creator'?proofWalletPath:'/v1/referrals/me/payout-wallet',header=kind==='creator'?'X-Creator-Capability':'X-Referral-Capability';
  assert.deepEqual(fixture.calls.map(c=>c.path),[path,path+'/challenge',path+'/verify']);
  assert.deepEqual(JSON.parse(posts(fixture)[0].body),JSON.parse(saved).challenge_request);
  assert.deepEqual(JSON.parse(posts(fixture)[1].body),{challenge_id:challengeId,signature});
  for(const call of fixture.calls){assert.equal(call.headers[header],secret);assert.equal(call.credentials,'omit');assert.equal(call.cache,'no-store');assert.equal(call.redirect,'error');assert.equal(call.referrerPolicy,'no-referrer');assert(!call.path.includes(secret));assert(!(call.body??'').includes(secret));}
 }
 for(const kind of ['__proto__','toString','custom','https://evil.invalid'])assert.throws(()=>createWalletProofClient({kind}));
});

test('a fresh authenticated saved wallet is required and malformed reads never fabricate a claim',async()=>{
 for(const response of [json(history(null)),json({wallet:wallet()}),json(history(wallet({network:'eip155:1'}))),json(history(wallet({ownership_status:'eoa_signature_verified'}))),json({error:{message:cap}},403)]){
  const f=setup([response]);await assert.rejects(f.client.prepareChallenge(cap));try{await f.client.read(cap);}catch{}await assert.rejects(f.client.prepareChallenge(cap));assert.equal(posts(f).length,0);assert.equal(f.client.snapshot().envelope,null);
 }
 const f=setup([json(history())]);await f.client.read(cap);f.client.clearRead();await assert.rejects(f.client.prepareChallenge(cap));
});

test('message parsing rejects changed origin, chain, claim, address, action, subject, nonce, time and extra instructions',()=>{
 const c=challenge(),w=binding(wallet()),changed=fn=>{const v=structuredClone(c);fn(v);return v;};
 const invalid=[changed(v=>v.message=v.message.replace('https://agi.agenttoolbox2026.workers.dev','https://evil.invalid')),changed(v=>v.message=v.message.replace('agi.agenttoolbox2026.workers.dev wants','evil.invalid wants')),changed(v=>v.message=v.message.replace('Chain ID: 8453','Chain ID: 1')),changed(v=>v.message=v.message.replace('revision:1','revision:2')),changed(v=>v.message=v.message.replace('urn:agi:creator:','urn:agi:referral:subject:')),changed(v=>v.message=v.message.replace('payout-destination-proof','transfer-authorization')),changed(v=>v.message=v.message.replace('a'.repeat(32),'short')),changed(v=>v.message=v.message.replace('b'.repeat(64),'not-a-hash')),changed(v=>v.message+='\nSend funds now'),changed(v=>v.message=v.message.replaceAll('\n','\r\n')),changed(v=>v.address='0x'+'2'.repeat(40)),changed(v=>v.claim_revision=2),changed(v=>v.challenge_id='invalid'),changed(v=>v.method='erc1271'),changed(v=>v.erc1271_supported=true),changed(v=>v.payment_effect='paid'),changed(v=>v.signature=signature),changed(v=>v.expires_at=new Date(start+301000).toISOString())];
 for(const value of invalid)assert.throws(()=>validateProofChallenge(value,w,{now:start}));
 assert.throws(()=>validateProofChallenge(c,w,{origin:'https://evil.invalid',now:start}));
 assert.throws(()=>validateProofChallenge(c,w,{now:start-1}));
 assert.throws(()=>validateProofChallenge(c,w,{now:start+300000}),/expired/);
 assert.throws(()=>validateProofChallenge(challenge('referral'),w,{now:start}));
 assert.throws(()=>validateProofChallenge(c,w,{kind:'referral',now:start}));
});

test('challenge timeout retains exact identity; later conflicts cannot permit replacement',async()=>{
 const f=await prepared([new Error('lost'),json({},409),json(challenge())]),saved=f.client.snapshot().envelope;
 for(let i=0;i<2;i++){await assert.rejects(f.client.sendChallenge(cap));assert.equal(f.client.snapshot().envelope,saved);assert.equal(f.client.snapshot().phase,'challenge_uncertain');assert.throws(()=>f.client.startNew());await assert.rejects(f.client.prepareChallenge(cap));}
 await f.client.sendChallenge(cap);assert.equal(f.client.snapshot().phase,'challenge_ready');assert.equal(new Set(posts(f).map(c=>c.body)).size,1);assert.equal(f.ids(),1);
});

test('network, timeout, server and malformed proof responses preserve unchanged private proof retries',async()=>{
 for(const failure of [new Error(signature),new DOMException('timeout','AbortError'),json({},408),json({},503),new Response('bad'),json(wallet()),json(verified({address:'0x'+'2'.repeat(40)})),json(verified({owner_approval:{status:'paid'}}))]){
  const f=await proofPrepared([failure,json(verified())]),saved=f.client.snapshot().envelope;
  await assert.rejects(f.client.sendVerify(cap),e=>/outcome is uncertain/.test(e.message)&&!e.message.includes(signature));
  assert.equal(f.client.snapshot().envelope,saved);assert.equal(f.client.snapshot().phase,'verify_uncertain');assert.throws(()=>f.client.startNew());await assert.rejects(f.client.prepareVerify('0x'+'34'.repeat(65),cap));
  await f.client.sendVerify(cap);assert.equal(posts(f).at(-1).body,posts(f).at(-2).body);
 }
});

test('expired challenges cannot create new proofs, but uncertain exact proofs can resolve after expiry',async()=>{
 const fresh=await prepared([json(challenge())]);await fresh.client.sendChallenge(cap);fresh.advance(300000);await assert.rejects(fresh.client.prepareVerify(signature,cap),/expired/);assert.equal(posts(fresh).length,1);
 const unsent=await proofPrepared();unsent.advance(300000);await assert.rejects(unsent.client.sendVerify(cap),/expired/);assert.equal(posts(unsent).length,1);unsent.client.startNew();
 const uncertain=await proofPrepared([new Error('lost'),json(verified())]);await assert.rejects(uncertain.client.sendVerify(cap));uncertain.advance(600000);await uncertain.client.sendVerify(cap);assert.equal(uncertain.client.snapshot().phase,'verified');assert.equal(posts(uncertain).at(-1).body,posts(uncertain).at(-2).body);
});

async function realProofFixture(){
 const db=database(),creator='proof-recovery-fixture',calls=[];let time=start,denyReads=false,dropVerify=false;
 await db.prepare('INSERT INTO platform_creators VALUES(?,?,?)').bind(creator,await hash(cap),new Date(start).toISOString()).run();
 const claim=await claimWallet({db,capability:cap,now:()=>new Date(time),body:{request_id:crypto.randomUUID(),expected_revision:0,network:'eip155:8453',address}});
 const fetchImpl=async(path,init)=>{
  calls.push({path,...init});if(denyReads&&init.method==='GET')return json({},403);
  const args={db,capability:init.headers['X-Creator-Capability'],origin:proofOrigin,now:()=>new Date(time),...(init.body?{body:JSON.parse(init.body)}:{})};
  let result;try{result=path===proofWalletPath?await getWallet(args):path.endsWith('/challenge')?await challengeWallet(args):await verifyWallet(args);}catch(error){return json({error:{code:error.code}},error.status??500);}
  if(dropVerify&&path.endsWith('/verify')){dropVerify=false;throw new Error('Lost successful response');}return json(result);
 };
 const makeClient=()=>createWalletProofClient({cryptoImpl:webcrypto,fetchImpl,now:()=>time});
 const source=makeClient();await source.read(cap);await source.prepareChallenge(cap);await source.sendChallenge(cap);await source.prepareVerify(signature,cap);
 return {db,source,claim,calls,makeClient,advance:ms=>{time+=ms;},denyReads:()=>{denyReads=true;},dropVerify:()=>{dropVerify=true;},seedRecordedProof:async()=>{
  const envelope=JSON.parse(source.snapshot().envelope),proofHash=await hash(canonical({...envelope.verify_body,signature:signature.toLowerCase(),origin:proofOrigin}));
  // Fixture for an already recorded proof: exercise real backend replay without
  // introducing keys or signing. Cryptographic verification has backend tests.
  await db.prepare('INSERT INTO platform_creator_wallet_proofs VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),creator,claim.claim_id,envelope.verify_body.challenge_id,proofHash,new Date(start+1000).toISOString()).run();
 }};
}

test('real backend: an expired unused imported proof can be consciously retired after fresh authenticated status',async()=>{
 const f=await realProofFixture();try{
  const saved=f.source.snapshot().envelope;f.advance(300001);const restored=f.makeClient();await restored.restore(saved,cap);await restored.sendChallenge(cap);
  await assert.rejects(restored.sendVerify(cap),/Proof conflict/);assert.equal(restored.snapshot().phase,'verify_uncertain');assert.equal(restored.snapshot().expiredRecovery,null);await assert.rejects(restored.retireExpiredProof(cap));
  assert.equal((await restored.read(cap)).ownership_status,'unverified');assert.equal(restored.snapshot().expiredRecovery,'same_wallet_unverified');assert.equal(restored.snapshot().phase,'verify_uncertain');
  assert.throws(()=>restored.startNew());await restored.retireExpiredProof(cap);assert.equal(restored.snapshot().phase,'empty');assert.equal(restored.snapshot().envelope,null);await assert.rejects(restored.prepareChallenge(cap),/Read the saved current wallet/);
  await restored.read(cap);const next=JSON.parse(await restored.prepareChallenge(cap));assert.notEqual(next.challenge_request.request_id,JSON.parse(saved).challenge_request.request_id);
  assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_wallet_proofs').get().n,0);
 }finally{f.db.close();}
});

test('real backend: a recorded proof with a lost successful replay still resolves unchanged after expiry',async()=>{
 const f=await realProofFixture();try{
  await f.seedRecordedProof();f.dropVerify();const saved=f.source.snapshot().envelope;await assert.rejects(f.source.sendVerify(cap),/outcome is uncertain/);f.advance(600000);
  const verified=await f.source.sendVerify(cap);assert.equal(verified.ownership_status,'eoa_signature_verified');assert.equal(verified.owner_approval.status,'pending');assert.equal(f.source.snapshot().phase,'verified');assert.equal(f.source.snapshot().envelope,saved);assert.equal(f.source.snapshot().expiredRecovery,null);
  const requests=f.calls.filter(call=>call.path.endsWith('/verify'));assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_wallet_proofs').get().n,1);
 }finally{f.db.close();}
});

test('real backend: expired proof recovery follows a superseding current claim without claiming verification',async()=>{
 const f=await realProofFixture();try{
  const saved=f.source.snapshot().envelope;await claimWallet({db:f.db,capability:cap,now:()=>new Date(start+1000),body:{request_id:crypto.randomUUID(),expected_revision:1,network:'eip155:8453',address:'0x'+'2'.repeat(40)}});f.advance(600000);
  const restored=f.makeClient();await restored.restore(saved,cap);await restored.sendChallenge(cap);await assert.rejects(restored.sendVerify(cap),/Proof conflict/);const current=await restored.read(cap);assert.equal(current.revision,2);assert.equal(current.ownership_status,'unverified');assert.equal(restored.snapshot().expiredRecovery,'superseded_claim');
  await restored.retireExpiredProof(cap);await restored.read(cap);assert.equal(JSON.parse(await restored.prepareChallenge(cap)).wallet.revision,2);assert.equal(f.db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_wallet_proofs').get().n,0);
 }finally{f.db.close();}
});

test('expired retirement requires authenticated replay and a fresh post-expiry read; failed authentication cannot release it',async()=>{
 const source=await proofPrepared(),saved=source.client.snapshot().envelope;
 const f=setup([json(history()),json(challenge()),json(history()),json({},403)]);await f.client.restore(saved,cap);await f.client.read(cap);await assert.rejects(f.client.retireExpiredProof(cap));await f.client.sendChallenge(cap);await f.client.read(cap);await assert.rejects(f.client.retireExpiredProof(cap));
 f.advance(600000);assert.equal(f.client.snapshot().expiredRecovery,null);await assert.rejects(f.client.retireExpiredProof(cap));await assert.rejects(f.client.read(cap));assert.equal(f.client.snapshot().expiredRecovery,null);await assert.rejects(f.client.retireExpiredProof(cap));assert.equal(f.client.snapshot().envelope,saved);
 const actual=await realProofFixture();try{const restored=actual.makeClient();await restored.restore(actual.source.snapshot().envelope,cap);actual.advance(600000);await restored.sendChallenge(cap);actual.denyReads();await assert.rejects(restored.read(cap));await assert.rejects(restored.retireExpiredProof(cap));assert.equal(restored.snapshot().phase,'verify_uncertain');}finally{actual.db.close();}
});

test('expired retirement is private to the retained capability and is revoked by further proof attempts or changed status',async()=>{
 const f=await proofPrepared([new Error('lost'),json(history()),json({},409),json(history())]);await assert.rejects(f.client.sendVerify(cap));f.advance(600000);await f.client.read(cap);assert.equal(f.client.snapshot().expiredRecovery,'same_wallet_unverified');await assert.rejects(f.client.retireExpiredProof(other));assert.equal(f.client.snapshot().phase,'verify_uncertain');
 await assert.rejects(f.client.sendVerify(cap));assert.equal(f.client.snapshot().expiredRecovery,null);await f.client.read(cap);f.client.clearRead();assert.equal(f.client.snapshot().expiredRecovery,null);await assert.rejects(f.client.retireExpiredProof(cap));
});

test('proof export/import preserves signature bytes and requires authenticated replay before accepting an imported message',async()=>{
 const source=await proofPrepared(),saved=source.client.snapshot().envelope,target=setup([json(challenge()),json(verified())]);target.advance(600000);
 assert.equal(await target.client.restore(saved,cap),saved);assert.equal(target.calls.length,0);assert.equal(target.ids(),0);assert.equal(target.client.snapshot().challenge,null);
 await assert.rejects(target.client.sendVerify(cap),/Replay the exact challenge/);assert.equal(target.calls.length,0);
 await target.client.sendChallenge(cap);await target.client.sendVerify(cap);assert.deepEqual(JSON.parse(posts(target)[1].body),JSON.parse(saved).verify_body);assert.equal(target.client.snapshot().phase,'verified');
});

test('imported identity resource digest is authenticated by replay, never trusted solely from file contents',async()=>{
 const source=await prepared([json(challenge())]);await source.client.sendChallenge(cap);const tampered=JSON.parse(source.client.snapshot().envelope);tampered.challenge_response.message=tampered.challenge_response.message.replace('b'.repeat(64),'c'.repeat(64));
 const target=setup([json(challenge())]);await target.client.restore(JSON.stringify(tampered),cap);await assert.rejects(target.client.prepareVerify(signature,cap),/Replay/);await assert.rejects(target.client.sendChallenge(cap));assert.equal(target.client.snapshot().authenticated,false);assert.equal(target.client.snapshot().challenge,null);assert.throws(()=>target.client.startNew());
});

test('capability and kind binding rejects imports and operations across private identities before any POST',async()=>{
 const source=await proofPrepared(),saved=source.client.snapshot().envelope;
 for(const secret of [other,referral]){const target=setup();await assert.rejects(target.client.restore(saved,secret));assert.equal(target.calls.length,0);await assert.rejects(source.client.sendVerify(secret));}
 const target=setup([],{kind:'referral'});await assert.rejects(target.client.restore(saved,referral));assert.equal(target.calls.length,0);
 const ref=await proofPrepared([],{kind:'referral'});await assert.rejects(source.client.restore(ref.client.snapshot().envelope,cap));
 for(const fn of [()=>source.client.read(other),()=>source.client.prepareVerify(signature,other),()=>source.client.sendChallenge(other)])await assert.rejects(fn(),/another capability/);
 assert.equal(posts(source).length,1);
});

test('capability-shaped substrings, oversized data, arbitrary paths and extra properties never enter retry storage',async()=>{
 const source=await prepared(),original=JSON.parse(source.client.snapshot().envelope),mutate=fn=>{const value=structuredClone(original);fn(value);return value;};
 const invalid=[mutate(v=>v.origin='https://evil.invalid'),mutate(v=>v.path='https://evil.invalid'),mutate(v=>v.wallet.address='<img src=x onerror=alert(1)>'),mutate(v=>v.wallet.network='eip155:1'),mutate(v=>v.challenge_request.claim_revision=2),mutate(v=>v.verify_body={challenge_id:challengeId,signature}),mutate(v=>v.creator_secret_hash=cap),mutate(v=>v.challenge_request.request_id='x'.repeat(8193))];
 for(const secret of [cap,other,referral])invalid.push(mutate(v=>v.challenge_request.request_id='prefix_'+secret+'_suffix'));
 for(const value of invalid){assert.throws(()=>validateProofEnvelope(value,{now:start}));const target=setup();await assert.rejects(target.client.restore(JSON.stringify(value),cap),e=>!e.message.includes(cap));assert.equal(target.client.snapshot().envelope,null);assert.equal(target.calls.length,0);}
 const target=setup();for(const text of [' '.repeat(8193),'{broken'])await assert.rejects(target.client.restore(text,cap));
 const frozen=validateProofEnvelope(original,{now:start});assert.throws(()=>{frozen.wallet.address=address;},TypeError);
});

test('a capability-shaped generated request ID cannot be retained or sent',async()=>{
 const f=setup([json(history())],{cryptoImpl:{subtle:webcrypto.subtle,randomUUID:()=>cap}});await f.client.read(cap);await assert.rejects(f.client.prepareChallenge(cap));assert.equal(f.client.snapshot().envelope,null);assert.equal(posts(f).length,0);
});

test('an uncertain verification remains held after later private rejection or rate limit',async()=>{
 for(const status of [400,403,409,429]){const f=await proofPrepared([new Error('lost'),json({error:{message:signature}},status)]);await assert.rejects(f.client.sendVerify(cap));await assert.rejects(f.client.sendVerify(cap),e=>!e.message.includes(signature));assert.equal(f.client.snapshot().phase,'verify_uncertain');assert.throws(()=>f.client.startNew());}
});

test('actual abort timeout retains the exact challenge request and request ID',async()=>{
 const f=await prepared([(_path,init)=>new Promise((_resolve,reject)=>{init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')));})],{timeoutMs:5}),saved=f.client.snapshot().envelope;
 await assert.rejects(f.client.sendChallenge(cap),/outcome is uncertain/);assert.equal(f.client.snapshot().envelope,saved);assert.equal(f.ids(),1);assert.equal(f.client.snapshot().phase,'challenge_uncertain');
});

test('challenge replay tolerates JSON property ordering without allowing changed message content',async()=>{
 const f=await proofPrepared(),saved=f.client.snapshot().envelope,reordered=Object.fromEntries(Object.entries(challenge()).reverse()),target=setup([json(reordered),json(verified())]);
 await target.client.restore(saved,cap);await target.client.sendChallenge(cap);await target.client.sendVerify(cap);assert.equal(target.client.snapshot().phase,'verified');
});

test('concurrent requests and identity changes cannot publish stale private status',async()=>{
 let finish,entered;const fetching=new Promise(resolve=>{entered=resolve;}),f=setup([()=>new Promise(resolve=>{finish=resolve;entered();})]);const reading=f.client.read(cap);await fetching;
 await assert.rejects(f.client.read(cap),/Wait/);f.client.clearRead();finish(json(history()));await assert.rejects(reading,/Capability changed/);assert.equal(f.client.snapshot().current,null);assert.equal(f.calls.length,1);await assert.rejects(f.client.prepareChallenge(other));
});

class Element {constructor(){this.value='';this.textContent='';this.disabled=false;this.hidden=true;this.checked=false;this.events={};}addEventListener(name,fn){this.events[name]=fn;}emit(name,event={}){return this.events[name]?.(event);}focus(){}select(){}}
function ui(client){
 const names=['envelope','prepared','new','verify','signing','message','binding','saved','result','read','current','prepare','challenge','prepare-verify','signature','restore','import','copy','export','file','expired-recovery','retire'];const elements=new Map(names.map(n=>['[data-proof-'+n+']',new Element()])),status=new Element(),root=new Element(),capabilityInput=new Element();capabilityInput.value=cap;elements.set('[role="status"]',status);root.querySelector=s=>{assert(elements.has(s),s);return elements.get(s);};root.querySelectorAll=()=>[...elements.values()];const copied=[];
 bindWalletProof(root,{client,capabilityInput,navigatorImpl:{clipboard:{writeText:async text=>copied.push(text)}}});return {get:name=>elements.get('[data-proof-'+name+']'),status,capabilityInput,copied};
}

test('UI demands saved JSON at both POST stages, hides raw signature in results and clears stale identity display',async()=>{
 const f=setup([json(history()),json(challenge()),json(verified())]),view=ui(f.client);
 await view.get('read').emit('click');await view.get('prepare').emit('click');await view.get('challenge').emit('click');assert.equal(posts(f).length,0);
 await view.get('copy').emit('click');assert(!view.copied[0].includes(cap));view.get('saved').checked=true;await view.get('challenge').emit('click');assert.equal(view.get('signing').hidden,false);assert.equal(view.get('message').value,challenge().message);
 view.get('signature').value=signature;await view.get('prepare-verify').emit('click');assert.equal(view.get('signature').value,'');await view.get('verify').emit('click');assert.equal(posts(f).length,1);
 view.get('saved').checked=true;await view.get('verify').emit('click');assert.equal(posts(f).length,2);assert(!view.get('result').textContent.includes(signature));assert.match(view.get('result').textContent,/Owner approval: pending/);assert.match(view.get('result').textContent,/No payout initiated/);
 view.capabilityInput.value=other;view.capabilityInput.emit('input');assert.equal(view.get('result').hidden,true);assert.equal(view.get('result').textContent,'');assert.equal(view.get('current').textContent,'');assert.equal(view.get('message').value,'');assert.equal(view.get('signing').hidden,true);assert.equal(view.get('saved').checked,false);
});

test('change-only and event-free capability swaps during a GET cannot render another identity’s wallet',async()=>{
 for(const mode of ['change','silent','same-value-event']){
  let finish,entered;const fetching=new Promise(resolve=>{entered=resolve;}),f=setup([()=>new Promise(resolve=>{finish=resolve;entered();})]),view=ui(f.client),pending=view.get('read').emit('click');await fetching;
  if(mode!=='same-value-event')view.capabilityInput.value=other;if(mode!=='silent')view.capabilityInput.emit('change');finish(json(history()));await pending;
  assert.equal(view.get('current').hidden,true);assert.equal(view.get('current').textContent,'');assert.equal(view.get('result').hidden,true);assert.equal(f.client.snapshot().current,null);assert.equal(view.get('envelope').value,'');assert.match(view.status.textContent,/Capability changed/);
 }
});

test('change-only and event-free swaps during verification hide proof results and clear client read identity',async()=>{
 for(const mode of ['change','silent']){
  let finish,entered;const fetching=new Promise(resolve=>{entered=resolve;}),f=setup([json(history()),json(challenge()),()=>new Promise(resolve=>{finish=resolve;entered();})]),view=ui(f.client);
  await view.get('read').emit('click');await view.get('prepare').emit('click');view.get('saved').checked=true;await view.get('challenge').emit('click');view.get('signature').value=signature;await view.get('prepare-verify').emit('click');view.get('saved').checked=true;
  const pending=view.get('verify').emit('click');await fetching;view.capabilityInput.value=other;if(mode==='change')view.capabilityInput.emit('change');finish(json(verified()));await pending;
  assert.equal(view.get('result').hidden,true);assert.equal(view.get('result').textContent,'');assert.equal(view.get('current').hidden,true);assert.equal(view.get('message').value,'');assert.equal(view.get('envelope').value,'');assert.equal(f.client.snapshot().authenticated,false);assert.equal(f.client.snapshot().current,null);assert.match(view.status.textContent,/Capability changed/);
 }
});

test('UI exposes explicit expired retirement only after fresh status and retains the save-before-reset step',async()=>{
 const source=await proofPrepared(),f=setup([json(challenge()),json({},409),json(history())]);f.advance(600000);const view=ui(f.client);view.get('import').value=source.client.snapshot().envelope;
 await view.get('restore').emit('click');view.get('saved').checked=true;await view.get('challenge').emit('click');view.get('saved').checked=true;await view.get('verify').emit('click');assert.equal(view.get('expired-recovery').hidden,true);assert.equal(view.get('result').hidden,true);assert.equal(view.get('signing').hidden,true);
 await view.get('read').emit('click');assert.equal(view.get('expired-recovery').hidden,false);assert.equal(view.get('new').disabled,true);view.get('saved').checked=false;await view.get('retire').emit('click');assert.equal(f.client.snapshot().phase,'verify_uncertain');
 view.get('saved').checked=true;await view.get('retire').emit('click');assert.equal(f.client.snapshot().phase,'empty');assert.equal(view.get('expired-recovery').hidden,true);assert.equal(view.get('result').hidden,true);assert.match(view.status.textContent,/old outcome is not confirmed/);
});

test('untrusted server text and fetch errors never appear in private status messages',async()=>{
 for(const response of [new Error(cap+' '+signature),new Response('{broken '+cap+' '+signature),json({error:{message:cap+' '+signature}},500)]){
  const f=setup([response]),view=ui(f.client);await view.get('read').emit('click');assert(!view.status.textContent.includes(cap));assert(!view.status.textContent.includes(signature));assert.equal(view.get('current').hidden,true);assert.equal(f.client.snapshot().current,null);
 }
 const view=ui({snapshot:()=>({envelope:null,phase:'empty',authenticated:false}),read:async()=>{throw new Error(cap);}});await view.get('read').emit('click');assert(!view.status.textContent.includes(cap));
});

test('no-JS section uses OpenAPI, explains external EOA proof, contains no capability field or wallet control',async()=>{
 for(const kind of ['creator','referral']){const html=walletProofSection({kind});assert.match(html,/<noscript>.*href="\/openapi.json"/);assert.match(html,new RegExp('Use the private '+kind+' wallet challenge'));assert.match(html,/ERC-1271/);assert.match(html,/Owner approval|owner approval/);assert.match(html,/keep this file private/);assert(!html.includes('name="'));assert(!html.includes('type="password"'));assert.match(html,new RegExp(kind==='creator'?'X-Creator-Capability':'X-Referral-Capability'));}
 const js=await readFile(new URL('../public/wallet-proof.js',import.meta.url),'utf8');assert.doesNotMatch(js,/localStorage|sessionStorage|indexedDB|innerHTML|window\.ethereum|signMessage\(|signTransaction\(|privateKeyToAccount|console\.|document\.querySelectorAll/);
});
