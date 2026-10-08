import {holdBusyControls} from './busy-controls.js';
export const proofWalletPath='/v1/creators/me/payout-wallet';
export const proofOrigin='https://agi.agenttoolbox2026.workers.dev';
const maxBytes=8192;
const configurations=Object.freeze({creator:Object.freeze({path:proofWalletPath,header:'X-Creator-Capability',prefix:'atbc_',kind:'creator_wallet_ownership_proof',subject:'creator',action:'urn:agi:action:payout-destination-proof',resource:'urn:agi:wallet-claim:',statement:'Prove ownership of an AGI payout destination. This does not authorize payment.'}),referral:Object.freeze({path:'/v1/referrals/me/payout-wallet',header:'X-Referral-Capability',prefix:'atbf_',kind:'referral_wallet_ownership_proof',subject:'referral:subject',action:'urn:agi:referral:action:payout-destination-proof',resource:'urn:agi:referral:wallet-claim:',statement:'Prove ownership of an AGI referral payout destination. This does not authorize payment.'})});
const configuration=kind=>typeof kind==='string'&&Object.hasOwn(configurations,kind)?configurations[kind]:fail('Use the creator or referral proof flow.');
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const address=v=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&!/^0x0{40}$/i.test(v);
const revision=v=>Number.isInteger(v)&&v>=1&&v<=2147483647;
const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const iso=v=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
class WalletProofError extends Error {}
const fail=message=>{throw new WalletProofError(message);};
const capability=(value,config)=>typeof value==='string'&&value.startsWith(config.prefix)&&/^atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(value)?value:fail('Use the existing matching private capability above.');
const sha256=async(value,cryptoImpl)=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const safe=value=>{const text=JSON.stringify(value);if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes||/atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]/.test(text))fail('The retry request is oversized or contains a private capability. Nothing sent.');return value;};
const walletBinding=v=>exact(v,['claim_id','revision','network','address'])&&uuid(v.claim_id)&&revision(v.revision)&&v.network==='eip155:8453'&&address(v.address);
const pickWallet=v=>({claim_id:v.claim_id,revision:v.revision,network:v.network,address:v.address});
const sameWallet=(a,b)=>a.claim_id===b.claim_id&&a.revision===b.revision&&a.network===b.network&&a.address===b.address;
function walletView(v){
 if(!exact(v,['claim_id','revision','network','address','created_at','ownership_status','ownership_proof','owner_approval','payment_effect'])||!walletBinding(pickWallet(v))||!iso(v.created_at)||v.payment_effect!=='none')fail('Unexpected private wallet response. Read current status again.');
 if(v.ownership_status==='unverified'){if(v.ownership_proof!==null)fail('Unexpected ownership proof response.');}
 else if(v.ownership_status!=='eoa_signature_verified'||!exact(v.ownership_proof,['verified_at','method','erc1271_supported'])||!iso(v.ownership_proof.verified_at)||v.ownership_proof.method!=='eoa_erc191'||v.ownership_proof.erc1271_supported!==false)fail('Unexpected ownership proof response.');
 if(!(exact(v.owner_approval,['status'])&&v.owner_approval.status==='pending')&&!(exact(v.owner_approval,['status','approved_at'])&&v.owner_approval.status==='approved'&&iso(v.owner_approval.approved_at)))fail('Unexpected owner approval response.');
 return v;
}

// creator_id is private: its resource digest is authenticated by challenge replay,
// not derived from the capability digest (the two hashes have different inputs).
export function validateProofChallenge(value,wallet,{kind='creator',origin=proofOrigin,now=Date.now(),allowExpired=false}={}){
 const config=configuration(kind);
 let url;try{url=new URL(origin);}catch{fail('Use the canonical HTTPS proof origin.');}
 if(origin!==proofOrigin||url.protocol!=='https:'||url.origin!==origin)fail('Use the canonical HTTPS proof origin.');
 if(!walletBinding(wallet)||!exact(value,['challenge_id','claim_revision','address','message','expires_at','method','erc1271_supported','payment_effect'])||!uuid(value.challenge_id)||value.claim_revision!==wallet.revision||value.address!==wallet.address||!iso(value.expires_at)||value.method!=='eoa_erc191'||value.erc1271_supported!==false||value.payment_effect!=='none'||typeof value.message!=='string'||value.message.length>2048)fail('The challenge does not match the saved wallet. Nothing signed or sent.');
 const lines=value.message.split('\n'),issued=lines[9]?.slice('Issued At: '.length),nonce=lines[8]?.slice('Nonce: '.length),creator=lines[14]?.slice(('- urn:agi:'+config.subject+':').length);
 if(!iso(issued)||!/^[0-9a-f]{32}$/.test(nonce??'')||!digest(creator)||Date.parse(value.expires_at)-Date.parse(issued)!==300000)fail('The challenge message or five-minute expiry is invalid.');
 const expected=`${url.host} wants you to sign in with your Ethereum account:\n${wallet.address}\n\n${config.statement}\n\nURI: ${origin}\nVersion: 1\nChain ID: 8453\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${value.expires_at}\nRequest ID: ${value.challenge_id}\nResources:\n- ${config.action}\n- urn:agi:${config.subject}:${creator}\n- ${config.resource}${wallet.claim_id}:revision:${wallet.revision}`;
 if(value.message!==expected||Date.parse(issued)>now)fail('The challenge message has invalid domain, chain, identity or time bindings.');
 if(!allowExpired&&Date.parse(value.expires_at)<=now)fail('The challenge expired. Start a new proof after resolving any uncertain request.');
 safe(value);return Object.freeze({challenge_id:value.challenge_id,claim_revision:value.claim_revision,address:value.address,message:value.message,expires_at:value.expires_at,method:value.method,erc1271_supported:value.erc1271_supported,payment_effect:value.payment_effect});
}

export function validateProofEnvelope(v,{kind='creator',now=Date.now()}={}){
 const config=configuration(kind);
 safe(v);
 if(!exact(v,['api_version','kind','origin','creator_secret_hash','wallet','challenge_request','challenge_response','verify_body'])||v.api_version!=='1'||v.kind!==config.kind||v.origin!==proofOrigin||!digest(v.creator_secret_hash)||!walletBinding(v.wallet)||!exact(v.challenge_request,['request_id','claim_revision'])||typeof v.challenge_request.request_id!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(v.challenge_request.request_id)||v.challenge_request.claim_revision!==v.wallet.revision)fail('Use an unchanged proof retry request exported by this page. Nothing sent.');
 const challenge=v.challenge_response===null?null:validateProofChallenge(v.challenge_response,v.wallet,{kind,now,allowExpired:true});
 if(v.verify_body!==null&&(!challenge||!exact(v.verify_body,['challenge_id','signature'])||v.verify_body.challenge_id!==challenge.challenge_id||typeof v.verify_body.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(v.verify_body.signature)))fail('The saved proof body does not match its challenge. Nothing sent.');
 return Object.freeze({...v,wallet:Object.freeze({...v.wallet}),challenge_request:Object.freeze({...v.challenge_request}),challenge_response:challenge,verify_body:v.verify_body?Object.freeze({...v.verify_body}):null});
}

export function createWalletProofClient({kind='creator',fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,now=Date.now,timeoutMs=15000}={}){
 const config=configuration(kind);
 let envelope=null,current=null,readHash=null,readStartedAt=null,phase='empty',busy=false,authenticated=false,generation=0;
 const expiredRecovery=()=>{
  if(phase!=='verify_uncertain'||!authenticated||!envelope?.verify_body||!current||readHash!==envelope.creator_secret_hash||readStartedAt===null||readStartedAt<Date.parse(envelope.challenge_response.expires_at)||now()<Date.parse(envelope.challenge_response.expires_at))return null;
  if(sameWallet(current,envelope.wallet))return current.ownership_status==='unverified'?'same_wallet_unverified':'same_wallet_verified';
  return current.revision>envelope.wallet.revision&&current.claim_id!==envelope.wallet.claim_id?'superseded_claim':null;
 };
 const clearCurrent=()=>{current=null;readHash=null;readStartedAt=null;};
 const snapshot=()=>({envelope:envelope?JSON.stringify(safe(envelope),null,2):null,current:current?pickWallet(current):null,phase,busy,authenticated,expiredRecovery:expiredRecovery(),challengeExpired:!!envelope?.challenge_response&&Date.parse(envelope.challenge_response.expires_at)<=now(),challenge:authenticated?envelope?.challenge_response:null});
 const enter=()=>{if(busy)fail('Wait for the current proof request to finish.');busy=true;return generation;};
 const hash=async secret=>sha256(capability(secret,config),cryptoImpl);
 const bound=async secret=>{const identity=await hash(secret);if(envelope&&identity!==envelope.creator_secret_hash)fail('This proof belongs to another capability. Restore the original capability separately.');return identity;};
 const unchanged=version=>{if(version!==generation)fail('Capability changed. Read current status again with the intended capability.');};
 const request=async(path,secret,body)=>{
  capability(secret,config);if(body)safe(body);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(path,{method:body?'POST':'GET',headers:{Accept:'application/json',[config.header]:secret,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok){const error=new WalletProofError(response.status===409?'Proof conflict. Keep any uncertain request unchanged; read current wallet status.':response.status===403?'The capability or private challenge was not accepted.':response.status===429?'Proof requests are temporarily limited. Retain and retry the exact request.':'The proof request was not accepted. Retain the exact request for retry.');error.definite=[400,403,409,413,415,429].includes(response.status);throw error;}
   return await response.json();
  }catch(error){if(error instanceof WalletProofError)throw error;throw new WalletProofError('The proof service response is unavailable. Retain the exact request for retry.');}finally{clearTimeout(timer);}
 };
 const retain=value=>{envelope=validateProofEnvelope(value,{kind,now:now()});};
 return {
  snapshot,
  clearRead(){generation++;clearCurrent();authenticated=false;},
  async read(secret){const version=enter();clearCurrent();try{const identity=await bound(secret),started=now(),data=await request(config.path,secret);if(!exact(data,['api_version','wallet','history','next_cursor'])||data.api_version!=='1'||!Array.isArray(data.history)||data.history.length>20||!(data.next_cursor===null||typeof data.next_cursor==='string'))fail('Unexpected private wallet response.');const wallet=data.wallet===null?null:walletView(data.wallet);unchanged(version);current=wallet;readHash=identity;readStartedAt=started;return wallet;}finally{busy=false;}},
  async prepareChallenge(secret){const version=enter();try{const identity=await bound(secret);unchanged(version);if(envelope)fail('A proof request is already retained. Resolve it before starting another.');if(!current||readHash!==identity)fail('Read the saved current wallet with this capability before preparing proof.');retain({api_version:'1',kind:config.kind,origin:proofOrigin,creator_secret_hash:identity,wallet:pickWallet(current),challenge_request:{request_id:cryptoImpl.randomUUID(),claim_revision:current.revision},challenge_response:null,verify_body:null});phase='challenge_prepared';return snapshot().envelope;}finally{busy=false;}},
  async sendChallenge(secret){const version=enter();let attempted=false;const uncertain=phase==='challenge_uncertain'||phase==='verify_uncertain',previous=phase;try{if(!envelope)fail('Prepare and save the exact challenge request first.');await bound(secret);unchanged(version);attempted=true;clearCurrent();if(!envelope.verify_body)phase='challenge_uncertain';const challenge=validateProofChallenge(await request(config.path+'/challenge',secret,envelope.challenge_request),envelope.wallet,{kind,now:now(),allowExpired:true});if(envelope.challenge_response&&JSON.stringify(challenge)!==JSON.stringify(envelope.challenge_response))fail('The authenticated challenge differs from the saved request.');unchanged(version);retain({...envelope,challenge_response:challenge});authenticated=true;phase=envelope.verify_body?previous:Date.parse(challenge.expires_at)<=now()?'expired':'challenge_ready';return challenge;}catch(error){authenticated=false;if(attempted&&!error.definite){if(!envelope.verify_body)phase='challenge_uncertain';throw new WalletProofError('The challenge outcome is uncertain. Retain and retry the exact request.');}if(attempted&&!uncertain&&!envelope.verify_body)phase='rejected';throw error;}finally{busy=false;}},
  async prepareVerify(signature,secret){const version=enter();try{await bound(secret);unchanged(version);if(!authenticated||!envelope?.challenge_response)fail('Replay the exact challenge to authenticate its message first.');if(envelope.verify_body)fail('An exact proof is already retained. Retry it unchanged.');validateProofChallenge(envelope.challenge_response,envelope.wallet,{kind,now:now()});if(typeof signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(signature))fail('Paste the externally produced 65-byte EOA signature.');retain({...envelope,verify_body:{challenge_id:envelope.challenge_response.challenge_id,signature}});phase='verify_prepared';return snapshot().envelope;}finally{busy=false;}},
  async sendVerify(secret){const version=enter();let attempted=false;const uncertain=phase==='verify_uncertain';try{if(!envelope?.verify_body)fail('Prepare and save the exact proof request first.');await bound(secret);unchanged(version);if(!authenticated)fail('Replay the exact challenge to authenticate its message before retrying this proof.');validateProofChallenge(envelope.challenge_response,envelope.wallet,{kind,now:now(),allowExpired:uncertain||phase==='verified'});attempted=true;clearCurrent();phase='verify_uncertain';const wallet=walletView(await request(config.path+'/verify',secret,envelope.verify_body));if(!sameWallet(wallet,envelope.wallet)||wallet.ownership_status!=='eoa_signature_verified')fail('The proof response does not match the saved wallet.');unchanged(version);phase='verified';clearCurrent();return wallet;}catch(error){if(attempted&&!error.definite)throw new WalletProofError('The proof outcome is uncertain. Keep the exact signature request private and retry unchanged.');if(attempted&&!uncertain)phase='rejected';throw error;}finally{busy=false;}},
  async restore(text,secret){const version=enter();try{if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes)fail('Saved proof request is too large.');let value;try{value=JSON.parse(text);}catch{fail('Use saved proof request JSON.');}const saved=validateProofEnvelope(value,{kind,now:now()});if(saved.creator_secret_hash!==await hash(secret))fail('Restore the original matching capability separately.');unchanged(version);if(envelope&&JSON.stringify(envelope)!==JSON.stringify(saved))fail('A different proof is already retained. Resolve it before importing another.');envelope=saved;clearCurrent();authenticated=false;phase=saved.verify_body?'verify_uncertain':'challenge_uncertain';return snapshot().envelope;}finally{busy=false;}},
  async retireExpiredProof(secret){const version=enter();try{await bound(secret);unchanged(version);if(!expiredRecovery())fail('Replay the expired challenge, then read the current wallet with the same capability before retiring this proof.');envelope=null;clearCurrent();authenticated=false;phase='empty';}finally{busy=false;}},
  startNew(){if(busy)fail('Wait for the current proof request to finish.');if(phase.endsWith('_uncertain'))fail('This request may already be recorded. Retry unchanged before starting a new proof.');envelope=null;clearCurrent();authenticated=false;phase='empty';},
 };
}

const boundRoots=new WeakSet();
export function bindWalletProof(root,{kind='creator',client=createWalletProofClient({kind}),capabilityInput=globalThis.document?.querySelector(kind==='creator'?'#creator-wallet-capability':'#referral-capability'),navigatorImpl=globalThis.navigator,documentImpl=globalThis.document,URLImpl=globalThis.URL}={}){
 if(boundRoots.has(root))return;boundRoots.add(root);
 if(!capabilityInput)throw new Error('The proof section requires the existing matching capability input.');
 const get=name=>root.querySelector('[data-proof-'+name+']'),status=root.querySelector('[role="status"]'),controls=[...root.querySelectorAll('button,input,textarea'),capabilityInput],area=get('envelope');let running=false,presentationBound=false,presentationSecret=null,identityGeneration=0;
 const clearResult=()=>{get('result').hidden=true;get('result').textContent='';};
 const clearPresentation=()=>{presentationBound=false;presentationSecret=null;get('current').hidden=true;get('current').textContent='';clearResult();get('prepared').hidden=true;area.value='';get('signing').hidden=true;get('message').value='';get('binding').textContent='';get('signature').value='';get('saved').checked=false;get('expired-recovery').hidden=true;};
 const invalidate=()=>{identityGeneration++;client.clearRead();clearPresentation();status.textContent='Capability changed. Read current status; retained requests stay bound to the original identity.';};
 const display=()=>{
  const s=client.snapshot();get('new').disabled=s.phase.endsWith('_uncertain');get('verify').hidden=!s.envelope||!JSON.parse(s.envelope).verify_body;
  if(!presentationBound){clearPresentation();return;}
  area.value=s.envelope??'';get('prepared').hidden=!s.envelope;get('signing').hidden=!s.authenticated||!s.challenge||s.challengeExpired;get('expired-recovery').hidden=!s.expiredRecovery;
  if(s.challenge){get('message').value=s.challenge.message;get('binding').textContent=`Domain: ${proofOrigin}\nAddress: ${s.challenge.address}\nChain: Base (8453)\nClaim revision: ${s.challenge.claim_revision}\nChallenge: ${s.challenge.challenge_id}\nExpires: ${s.challenge.expires_at}`;}
 };
 // Inputs can change without dispatching an event. Every asynchronous boundary
 // checks the actual field value as well as the input/change event generation.
 const run=async(action,pendingMessage)=>{
  if(running)return;if(presentationBound&&presentationSecret!==capabilityInput.value)invalidate();running=true;const priorFocus=documentImpl?.activeElement,original=capabilityInput.value,version=identityGeneration,release=holdBusyControls(controls);
  if(pendingMessage)status.textContent=pendingMessage;
  const check=()=>{if(identityGeneration!==version||capabilityInput.value!==original){invalidate();fail('Capability changed. Read current status again with the intended capability.');}};
  const wait=async promise=>{const result=await promise;check();return result;};
  const reveal=()=>{check();presentationBound=true;presentationSecret=original;};
  try{await action({secret:original.trim(),wait,reveal,check});check();}catch(error){try{check();}catch(changed){error=changed;}status.textContent=error instanceof WalletProofError?error.message:'The proof service response is unavailable. Retain the exact request for retry.';}
  finally{release();running=false;try{check();display();}catch{clearPresentation();}if(documentImpl?.activeElement===documentImpl?.body&&priorFocus&&!priorFocus.disabled&&!priorFocus.hidden)priorFocus.focus();}
 };
 const saved=()=>{if(!presentationBound||!get('saved').checked||area.value!==client.snapshot().envelope)fail('Save the exact displayed retry request and confirm the checkbox before sending.');};
 get('read').addEventListener('click',()=>run(async({secret,wait,reveal})=>{get('current').hidden=true;get('current').textContent='';const wallet=await wait(client.read(secret));reveal();get('current').textContent=wallet?`Current address: ${wallet.address}\nClaim revision: ${wallet.revision}\nOwnership: ${wallet.ownership_status}\nOwner approval: ${wallet.owner_approval.status}`:'No saved wallet. Save a destination above first.';get('current').hidden=false;status.textContent=client.snapshot().expiredRecovery?'Current wallet checked. You may retry the exact expired proof or explicitly retire it below. This does not confirm the old proof succeeded.':'Current wallet read. Proof and owner approval are separate.';},'Reading the current wallet for ownership proof…'));
 get('prepare').addEventListener('click',()=>run(async({secret,wait,reveal})=>{await wait(client.prepareChallenge(secret));reveal();get('saved').checked=false;clearResult();status.textContent='Challenge request prepared. Save it before sending.';}));
 get('challenge').addEventListener('click',()=>run(async({secret,wait,reveal})=>{saved();clearResult();await wait(client.sendChallenge(secret));reveal();get('saved').checked=false;status.textContent=client.snapshot().challengeExpired?'Expired challenge authenticated. Retry a retained proof unchanged, or read the current wallet to check whether this ownership proof can be retired.':'Exact message authenticated. Check its bindings and sign it externally before expiry. Save the updated retry JSON.';},'Sending the retained challenge request…'));
 get('prepare-verify').addEventListener('click',()=>run(async({secret,wait,reveal})=>{await wait(client.prepareVerify(get('signature').value.trim(),secret));reveal();get('signature').value='';get('saved').checked=false;status.textContent='Exact proof prepared. Save the private retry JSON before sending.';}));
 get('verify').addEventListener('click',()=>run(async({secret,wait,reveal})=>{saved();clearResult();const wallet=await wait(client.sendVerify(secret));reveal();get('result').textContent=`EOA ownership verified for claim revision ${wallet.revision}.\nAddress: ${wallet.address}\nOwner approval: ${wallet.owner_approval.status}.\nThis result may be an older claim. Read current wallet status.\nNo payout initiated; proof authorizes no payment.`;get('result').hidden=false;get('current').hidden=true;status.textContent='Ownership proof verified. Owner approval remains a separate step.';},'Sending the retained ownership proof…'));
 get('restore').addEventListener('click',()=>run(async({secret,wait,reveal})=>{await wait(client.restore(get('import').value,secret));reveal();get('saved').checked=false;get('signature').value='';get('current').hidden=true;clearResult();status.textContent='Request restored without sending. Save it, then replay the exact challenge to authenticate its message.';}));
 const resetPresentation=()=>{get('signature').value='';get('message').value='';get('binding').textContent='';get('saved').checked=false;get('current').hidden=true;get('current').textContent='';clearResult();};
 get('new').addEventListener('click',()=>run(async()=>{client.startNew();resetPresentation();status.textContent='Read the current wallet before preparing a new proof.';}));
 get('retire').addEventListener('click',()=>run(async({secret,wait,reveal})=>{saved();await wait(client.retireExpiredProof(secret));reveal();resetPresentation();status.textContent='Expired ownership proof retired locally. Its old outcome is not confirmed. Keep the saved request; read the current wallet before preparing a new proof.';}));
 get('copy').addEventListener('click',()=>run(async({wait,check})=>{const text=client.snapshot().envelope;if(!presentationBound||!text)fail('Read status with the matching capability or restore the exact request first.');try{await wait(navigatorImpl.clipboard.writeText(text));status.textContent='Request copied. Keep signature-containing copies private and capability separate.';}catch(error){check();area.disabled=false;area.focus();area.select();status.textContent='Copy the selected JSON. Keep signature-containing copies private.';}}));
 get('export').addEventListener('click',()=>run(async()=>{const text=client.snapshot().envelope;if(!presentationBound||!text)fail('Read status with the matching capability or restore the exact request first.');const url=URLImpl.createObjectURL(new Blob([text+'\n'],{type:'application/json'})),link=documentImpl.createElement('a');link.href=url;link.download='agenttoolbox-wallet-proof-request.json';documentImpl.body.append(link);link.click();link.remove();setTimeout(()=>URLImpl.revokeObjectURL(url),1000);status.textContent='Request download requested. Keep signature-containing files private and capability separate.';}));
 get('file').addEventListener('change',()=>run(async({wait})=>{const file=get('file').files?.[0];if(!file)return;if(file.size>maxBytes)fail('Saved proof request is too large.');get('import').value=await wait(file.text());status.textContent='File loaded. Restore it with the original capability; nothing sent.';}));
 capabilityInput.addEventListener('input',invalidate);capabilityInput.addEventListener('change',invalidate);
 get('signature').addEventListener('input',()=>{get('saved').checked=false;});
 globalThis.addEventListener?.('pagehide',()=>{capabilityInput.value='';invalidate();});
 for(const name of ['read','prepare','restore'])get(name).hidden=false;
 display();return client;
}
