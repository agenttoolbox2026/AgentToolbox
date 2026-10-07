export const walletPath='/v1/referrals/me/payout-wallet';
const maxEnvelopeBytes=4096;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>isObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const capabilityPattern=/^atbf_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const addressPattern=/^0x[0-9a-fA-F]{40}$/;
const validAddress=value=>typeof value==='string'&&addressPattern.test(value)&&!/^0x0{40}$/i.test(value);
const validRevision=(value,max=2147483647)=>Number.isInteger(value)&&value>=0&&value<=max;
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
class WalletClientError extends Error{}
const fail=message=>{throw new WalletClientError(message);};
const capabilityValue=value=>typeof value==='string'&&capabilityPattern.test(value)?value:fail('Paste the original private referral capability from your registration.');
const sha256=async(value,cryptoImpl)=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
const envelopeError='Use an unchanged wallet retry request exported by this page. No claim was sent.';
const withoutCapability=(value,capability)=>{
 const text=JSON.stringify(value);
 // Request IDs accept the same characters as capabilities. Reject secret-shaped
 // substrings too, so copy/export remains safe even after the input changes.
 if((capability&&text.includes(capability))||/atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]/.test(text))fail('A retry request must not contain a private referral capability. No claim was sent.');
 return value;
};

export function validateWalletEnvelope(value){
 if(!exact(value,['api_version','kind','path','referral_secret_hash','body'])||value.api_version!=='1'||value.kind!=='referral_wallet_claim'||value.path!==walletPath||typeof value.referral_secret_hash!=='string'||!/^[0-9a-f]{64}$/.test(value.referral_secret_hash))fail(envelopeError);
 const body=value.body;
 if(!exact(body,['request_id','expected_revision','network','address'])||typeof body.request_id!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(body.request_id)||!validRevision(body.expected_revision,2147483646)||body.network!=='eip155:8453'||!validAddress(body.address))fail(envelopeError);
 if(new TextEncoder().encode(JSON.stringify(value)).length>maxEnvelopeBytes)fail(envelopeError);
 withoutCapability(value);
 return Object.freeze({...value,body:Object.freeze({...body})});
}

export function validateWalletView(value){
 const invalid=()=>fail('Wallet status is unavailable: the server returned an unexpected response.');
 if(!exact(value,['claim_id','revision','network','address','created_at','ownership_status','ownership_proof','owner_approval','payment_effect'])||typeof value.claim_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.claim_id)||!validRevision(value.revision)||value.revision===0||value.network!=='eip155:8453'||!validAddress(value.address)||!validDate(value.created_at)||value.payment_effect!=='none')invalid();
 if(value.ownership_status==='unverified'){if(value.ownership_proof!==null)invalid();}
 else if(value.ownership_status==='eoa_signature_verified'){
  if(!exact(value.ownership_proof,['verified_at','method','erc1271_supported'])||!validDate(value.ownership_proof.verified_at)||value.ownership_proof.method!=='eoa_erc191'||value.ownership_proof.erc1271_supported!==false)invalid();
 }else invalid();
 const approval=value.owner_approval;
 if(approval?.status==='pending'){if(!exact(approval,['status']))invalid();}
 else if(approval?.status==='approved'){if(!exact(approval,['status','approved_at'])||!validDate(approval.approved_at))invalid();}
 else invalid();
 return value;
}

export function walletStatusText(wallet,{current=true}={}){
 if(wallet===null)return 'Current wallet: none saved.\nCurrent revision: 0.\nNo payout initiated.';
 validateWalletView(wallet);
 return `${current?'Current wallet':'Saved claim result (may be an older revision)'}\nAddress: ${wallet.address}\nNetwork: Base (eip155:8453)\nRevision: ${wallet.revision}\nOwnership: ${wallet.ownership_status==='eoa_signature_verified'?'EOA signature verified by the backend':'UNVERIFIED'}\nOwner approval: ${wallet.owner_approval.status==='approved'?'approved':'pending'}\nNo payout initiated by this request.`;
}

const errorMessage=(status,code)=>{
 if(status===409)return 'Wallet conflict. Read current status. Keep this exact request; do not change its revision or request ID. A reserved payout can also prevent a wallet change.';
 if(status===403)return 'The existing referral capability was not accepted. Use the original capability from your referral registration.';
 if(status===429)return 'Wallet requests are temporarily limited. Keep the same request and retry later.';
 if(status===400&&code==='invalid_wallet_request')return 'The wallet request was rejected. Check the public Base address and its checksum; keep the original request for review.';
 return status>=500?'Wallet service is unavailable. Keep the exact request for a safe retry.':'The wallet request was not accepted. Keep the exact request and read current status.';
};

export function createWalletClient({fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,timeoutMs=15000}={}){
 let envelope=null,revision=null,readIdentity=null,phase='empty',busy=false;
 const snapshot=()=>({envelope:envelope?JSON.stringify(withoutCapability(envelope),null,2):null,revision,phase,busy});
 const enter=()=>{if(busy)fail('Wait for the current wallet request to finish.');busy=true;};
 const identity=async capability=>sha256(capabilityValue(capability),cryptoImpl);
 const request=async(method,capability,body)=>{
  if(method==='POST')withoutCapability(body,capabilityValue(capability));
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(walletPath,{method,headers:{Accept:'application/json','X-Referral-Capability':capability,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(body)}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok){let data;try{data=await response.json();}catch{}const error=new WalletClientError(errorMessage(response.status,data?.error?.code));error.definite=[400,403,409,413,415,429].includes(response.status);error.invalidBody=response.status===400&&data?.error?.code==='invalid_wallet_request';throw error;}
   return await response.json();
  }finally{clearTimeout(timer);}
 };
 const bound=async capability=>{
  if(envelope)withoutCapability(envelope,capabilityValue(capability));
  const hash=await identity(capability);
  if(envelope&&hash!==envelope.referral_secret_hash)fail('This request belongs to another referral capability. Paste the original capability separately.');
  return hash;
 };
 return {
  snapshot,
  clearRead(){revision=null;readIdentity=null;},
  async read(capability){
   enter();revision=null;readIdentity=null;
   try{
    const hash=await bound(capability),data=await request('GET',capability);
    if(!exact(data,['api_version','wallet','history','next_cursor'])||data.api_version!=='1'||!Array.isArray(data.history)||data.history.length>20||!(data.next_cursor===null||typeof data.next_cursor==='string'))fail('Wallet status is unavailable: the server returned an unexpected response.');
    const wallet=data.wallet===null?null:validateWalletView(data.wallet);
    revision=wallet?.revision??0;readIdentity=hash;return wallet;
   }catch(error){if(error instanceof WalletClientError)throw error;fail('Wallet status is unavailable. Keep any exact retry request and try again.');}finally{busy=false;}
  },
  async prepare(address,capability){
   enter();
   try{
    const hash=await bound(capability);
    if(envelope){if(envelope.body.address!==address)fail('A request is already prepared. Keep it unchanged, or explicitly start a different claim after its outcome is known.');return snapshot().envelope;}
    if(readIdentity!==hash||revision===null)fail('Read current wallet status with this capability before preparing a claim.');
    if(!validAddress(address))fail('Enter a nonzero public Base wallet address: 0x followed by 40 hexadecimal characters.');
    if(!validRevision(revision,2147483646))fail('The wallet revision limit has been reached.');
    envelope=withoutCapability(validateWalletEnvelope({api_version:'1',kind:'referral_wallet_claim',path:walletPath,referral_secret_hash:hash,body:{request_id:cryptoImpl.randomUUID(),expected_revision:revision,network:'eip155:8453',address}}),capability);phase='prepared';return snapshot().envelope;
   }finally{busy=false;}
  },
  async restore(text,capability){
   enter();
   try{
    if(typeof text!=='string'||new TextEncoder().encode(text).length>maxEnvelopeBytes)fail(envelopeError);
    let parsed;try{parsed=JSON.parse(text);}catch{fail(envelopeError);}
    const saved=withoutCapability(validateWalletEnvelope(parsed),capabilityValue(capability)),hash=await identity(capability);
    if(hash!==saved.referral_secret_hash)fail('Paste the original referral capability separately before restoring this request.');
    if(envelope&&JSON.stringify(saved)!==JSON.stringify(envelope))fail('A different request is already retained. Resolve it before importing another request.');
    envelope=saved;revision=null;readIdentity=null;phase='uncertain';return snapshot().envelope;
   }finally{busy=false;}
  },
  async send(capability){
   enter();let attempted=false;const wasUncertain=phase==='uncertain';
   try{
    if(!envelope)fail('Prepare and save the exact request before sending.');
    await bound(capability);attempted=true;phase='uncertain';revision=null;readIdentity=null;
    const claim=validateWalletView(await request('POST',capability,envelope.body));
    if(claim.revision!==envelope.body.expected_revision+1||claim.address.toLowerCase()!==envelope.body.address.toLowerCase())fail('The response did not match the saved request. Keep it unchanged and retry.');
    phase='confirmed';return claim;
   }catch(error){
    if(attempted&&error.definite&&(!wasUncertain||error.invalidBody))phase='rejected';
    if(attempted&&!error.definite)throw new WalletClientError('The claim outcome is uncertain. Keep this exact request and capability; retry unchanged.');
    throw error;
   }finally{busy=false;}
  },
  startNew(){
   if(busy)fail('Wait for the current wallet request to finish.');
   if(phase==='uncertain')fail('The retained request may already have been recorded. Retry it unchanged to resolve its outcome before starting another claim.');
   envelope=null;revision=null;readIdentity=null;phase='empty';
  },
 };
}

export function bindReferralWallet(form,{client=createWalletClient(),navigatorImpl=globalThis.navigator,documentImpl=globalThis.document,URLImpl=globalThis.URL,capabilityInput=null}={}){
 const find=selector=>form.querySelector(selector),capability=capabilityInput??find('[data-capability]'),address=find('[data-wallet-address]'),current=find('[data-wallet-current]'),revision=find('[data-current-revision]'),prepared=find('[data-wallet-prepared]'),area=find('[data-wallet-envelope]'),saved=find('[data-wallet-saved]'),status=find('[role="status"]'),result=find('[data-wallet-result]'),importArea=find('[data-wallet-import]');
 const controls=[...new Set([...form.querySelectorAll('button,input,textarea'),capability])].filter(control=>control!==area);let running=false;
 const display=()=>{const state=client.snapshot();area.value=state.envelope??'';prepared.hidden=!state.envelope;address.readOnly=!!state.envelope;revision.value=state.revision===null?'':String(state.revision);find('[data-new-wallet]').disabled=state.phase==='uncertain';};
 const run=async action=>{
  if(running||client.snapshot().busy)return;running=true;
  const previous=controls.map(control=>control.disabled);controls.forEach(control=>{control.disabled=true;});
  try{await action();}catch(error){status.textContent=error instanceof WalletClientError?error.message:'Wallet status is unavailable. Keep any exact retry request and try again.';}finally{controls.forEach((control,index)=>{control.disabled=previous[index];});running=false;display();}
 };
 const showEnvelope=()=>{saved.checked=false;display();status.textContent=client.snapshot().phase==='prepared'?'Exact request ready for review. Nothing sent. Copy or download it, then save your capability separately.':'Retained exact request. It may already have been recorded; keep it unchanged. Copy or download it and keep your capability separately.';};
 form.addEventListener('submit',event=>{event.preventDefault();return run(async()=>{
  if(!saved.checked)fail('Save the exact retry request and confirm the checkbox before sending.');
  if(area.value!==client.snapshot().envelope)fail('The displayed request changed. Restore the saved request before sending.');
  if(address.value.trim()!==JSON.parse(client.snapshot().envelope).body.address)fail('The visible address differs from the saved request. Restore the exact request before sending.');
  status.textContent='Sending the retained wallet claim…';current.hidden=true;
  const secret=capability.value.trim(),claim=await client.send(secret);
  if(capability.value.trim()!==secret)fail('Capability changed. Restore the matching capability before reading this claim.');
  result.textContent=walletStatusText(claim,{current:false});result.hidden=false;
  status.textContent='Claim recorded. Read current status to see the latest revision. Retain this request for retries.';
 });});
 find('[data-read-status]').addEventListener('click',()=>run(async()=>{current.hidden=true;status.textContent='Reading current wallet status…';const secret=capability.value.trim(),wallet=await client.read(secret);if(capability.value.trim()!==secret){client.clearRead();fail('Capability changed. Read current status again with the intended capability.');}current.textContent=walletStatusText(wallet);current.hidden=false;status.textContent='Current status read. Ownership proof and owner approval are separate.';}));
 find('[data-prepare-wallet]').addEventListener('click',()=>run(async()=>{await client.prepare(address.value.trim(),capability.value.trim());showEnvelope();}));
 find('[data-restore-wallet]').addEventListener('click',()=>run(async()=>{await client.restore(importArea.value,capability.value.trim());address.value=JSON.parse(client.snapshot().envelope).body.address;current.hidden=true;showEnvelope();status.textContent='Exact request restored without sending. It may already have been recorded; save it and retry unchanged to resolve its outcome.';}));
 find('[data-new-wallet]').addEventListener('click',()=>run(async()=>{client.startNew();saved.checked=false;result.hidden=true;current.hidden=true;status.textContent='Read current status before preparing a different claim. Keep your saved copy of the previous request.';}));
 find('[data-copy-wallet]').addEventListener('click',()=>run(async()=>{const text=client.snapshot().envelope;if(!text)fail('Prepare a request first.');try{await navigatorImpl.clipboard.writeText(text);status.textContent='Retry request copied. Save it with your capability kept separately.';}catch{area.focus();area.select();status.textContent='Clipboard unavailable. Copy the selected JSON and save it before sending.';}}));
 find('[data-export-wallet]').addEventListener('click',()=>run(async()=>{const text=client.snapshot().envelope;if(!text)fail('Prepare a request first.');const url=URLImpl.createObjectURL(new Blob([text+'\n'],{type:'application/json'})),link=documentImpl.createElement('a');link.href=url;link.download='agenttoolbox-referral-wallet-request.json';documentImpl.body.append(link);link.click();link.remove();setTimeout(()=>URLImpl.revokeObjectURL(url),1000);status.textContent='Retry request download requested. Keep your capability separately.';}));
 find('[data-wallet-file]').addEventListener('change',()=>run(async()=>{const file=find('[data-wallet-file]').files?.[0];if(!file)return;if(file.size>maxEnvelopeBytes)fail('Retry request file is too large.');importArea.value=await file.text();status.textContent='File loaded for review. Paste the original capability, then restore the exact request.';}));
 capability.addEventListener('input',()=>{client.clearRead();current.hidden=true;result.hidden=true;revision.value='';saved.checked=false;});
 address.addEventListener('input',()=>{saved.checked=false;});
 globalThis.addEventListener?.('pagehide',()=>{capability.value='';});
 form.noValidate=true;
 for(const selector of ['[data-read-status]','[data-prepare-wallet]','[data-restore-wallet]'])find(selector).hidden=false;
 return client;
}

