import {bindReferralWallet} from './referral-wallet.js';
import {bindWalletProof} from './wallet-proof.js';
import {bindCreatorEarnings} from './creator-earnings.js';
import {bindPayoutRequests} from './payout-requests.js';

export const registrationPath='/v1/referrals';
export const accountPath='/v1/referrals/me';
const capabilityPattern=/^atbf_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;
const secretPattern=/atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]/;
const referralPattern=/^ref_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>isObject(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
class ReferralClientError extends Error{}
const fail=message=>{throw new ReferralClientError(message);};
const privateCapability=value=>typeof value==='string'&&capabilityPattern.test(value)?value:fail('Use your original private referral capability, or generate and save one before registration.');
const safeEnvelope=value=>{if(secretPattern.test(JSON.stringify(value)))fail('A retry request must not contain a private capability. Nothing was sent.');return value;};
const hash=async(value,cryptoImpl)=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');

export function generateReferralCapability(cryptoImpl=globalThis.crypto){
 const bytes=cryptoImpl.getRandomValues(new Uint8Array(32));
 return 'atbf_'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}

export function validateRegistrationEnvelope(value,termsVersion){
 if(!exact(value,['api_version','kind','path','referral_secret_hash','body'])||value.api_version!=='1'||value.kind!=='referral_registration'||value.path!==registrationPath||typeof value.referral_secret_hash!=='string'||!/^[0-9a-f]{64}$/.test(value.referral_secret_hash)||!exact(value.body,['terms_version'])||value.body.terms_version!==termsVersion||typeof termsVersion!=='string'||!termsVersion)fail('Use an unchanged registration request exported for the published referral terms. Nothing was sent.');
 safeEnvelope(value);
 return Object.freeze({...value,body:Object.freeze({...value.body})});
}

export function validateReferralAccount(value){
 if(!isObject(value)||value.api_version!=='1'||typeof value.referral_code!=='string'||!referralPattern.test(value.referral_code)||typeof value.created_at!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.created_at)||!Number.isFinite(Date.parse(value.created_at))||value.payment_effect!=='none'||!isObject(value.terms)||typeof value.terms.terms_version!=='string'||!/^first-party-referrals-[A-Za-z0-9.-]{1,80}$/.test(value.terms.terms_version)||value.terms.share_bps!==100||value.terms.creator_tools_eligible!==false)fail('Referral account status is unavailable: the server returned an unexpected response.');
 // Only these public, bounded fields reach the page. Never render raw errors,
 // historical payout copy, arbitrary terms fields, or private server objects.
 return Object.freeze({referral_code:value.referral_code,created_at:value.created_at,terms_version:value.terms.terms_version});
}

export function referralAccountText(account){
 return `Registered referral account\nPublic referral code: ${account.referral_code}\nRegistered: ${account.created_at}\nTerms: ${account.terms_version}\nShare: 1% of qualifying first-party gross sales. Creator tools are excluded.\nInclude only this public code in the original paid invocation's referral_code field.\nRegistration does not initiate a payout.`;
}

export function createReferralAccountClient({termsVersion,fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,timeoutMs=15000}={}){
 let envelope=null,phase='empty',busy=false;
 const snapshot=()=>({envelope:envelope?JSON.stringify(safeEnvelope(envelope),null,2):null,phase,busy});
 const enter=()=>{if(busy)fail('Wait for the current referral request to finish.');busy=true;};
 const identity=async capability=>hash(privateCapability(capability),cryptoImpl);
 const bound=async capability=>{const commitment=await identity(capability);if(envelope&&envelope.referral_secret_hash!==commitment)fail('This request belongs to another referral capability. Restore the original capability separately.');return commitment;};
 const request=async(method,capability,body)=>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetchImpl(method==='POST'?registrationPath:accountPath,{method,headers:{Accept:'application/json','X-Referral-Capability':privateCapability(capability),...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(safeEnvelope(body))}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok){
    const message=response.status===403?'This referral capability was not accepted. Use the original saved capability, or prepare its registration.':response.status===429?'Referral requests are temporarily limited. Retain the same capability and request, then retry later.':response.status===400?'The published referral terms were not accepted. Keep the exact request for review.':'Referral service is unavailable. Keep the exact request and capability for a safe retry.';
    const error=new ReferralClientError(message);error.definite=[400,403,413,415,429].includes(response.status);throw error;
   }
   return validateReferralAccount(await response.json());
  }finally{clearTimeout(timer);}
 };
 return {
  snapshot,
  async prepare(capability){enter();try{const commitment=await bound(capability);if(!envelope){envelope=validateRegistrationEnvelope({api_version:'1',kind:'referral_registration',path:registrationPath,referral_secret_hash:commitment,body:{terms_version:termsVersion}},termsVersion);phase='prepared';}return snapshot().envelope;}finally{busy=false;}},
  async restore(text,capability){enter();try{if(typeof text!=='string'||new TextEncoder().encode(text).length>4096)fail('Registration request is too large. Nothing was sent.');let parsed;try{parsed=JSON.parse(text);}catch{fail('Use valid exported registration JSON. Nothing was sent.');}const saved=validateRegistrationEnvelope(parsed,termsVersion),commitment=await identity(capability);if(saved.referral_secret_hash!==commitment)fail('Restore the original referral capability separately before importing this request.');if(envelope&&JSON.stringify(saved)!==JSON.stringify(envelope))fail('A different registration request is retained. Resolve it before importing another.');envelope=saved;phase='uncertain';return snapshot().envelope;}finally{busy=false;}},
  async read(capability){enter();try{await bound(capability);const account=await request('GET',capability);if(envelope)phase='confirmed';return account;}catch(error){if(error instanceof ReferralClientError)throw error;fail('Referral account status is unavailable. Keep your original capability and exact request, then retry.');}finally{busy=false;}},
  async send(capability){enter();let attempted=false;const uncertain=phase==='uncertain';try{if(!envelope)fail('Prepare and save the exact registration request first.');await bound(capability);attempted=true;phase='uncertain';const account=await request('POST',capability,envelope.body);phase='confirmed';return account;}catch(error){if(attempted&&error.definite&&!uncertain)phase='rejected';if(attempted&&!error.definite)throw new ReferralClientError('Registration outcome is uncertain. Keep this exact request and capability; read status or retry unchanged.');throw error;}finally{busy=false;}},
  startNew(){if(busy)fail('Wait for the current referral request to finish.');if(phase==='uncertain')fail('This registration may already exist. Read status or retry unchanged before replacing it.');envelope=null;phase='empty';},
 };
}

export function bindReferralAccount(section,{client=createReferralAccountClient({termsVersion:section.dataset.termsVersion}),cryptoImpl=globalThis.crypto,navigatorImpl=globalThis.navigator,documentImpl=globalThis.document,URLImpl=globalThis.URL}={}){
 const find=selector=>section.querySelector(selector),capability=find('[data-capability]'),capabilitySaved=find('[data-referral-capability-saved]'),termsAccepted=find('[data-referral-terms-accepted]'),prepared=find('[data-registration-prepared]'),envelope=find('[data-registration-envelope]'),requestSaved=find('[data-registration-saved]'),status=find('[data-account-status]'),result=find('[data-account-result]'),importArea=find('[data-registration-import]'),form=find('[data-referral-registration]');
 const controls=[...section.querySelectorAll('[data-referral-account-control]')];let running=false;
 const display=()=>{const state=client.snapshot();envelope.value=state.envelope??'';prepared.hidden=!state.envelope;find('[data-new-registration]').disabled=state.phase==='uncertain';find('[data-generate-referral]').disabled=state.phase!=='empty';};
 const run=async(action,pendingMessage)=>{if(running||client.snapshot().busy)return;running=true;const priorFocus=documentImpl?.activeElement,disabled=controls.map(control=>control.disabled);controls.forEach(control=>{control.disabled=true;control.setAttribute?.('aria-busy','true');});if(pendingMessage)status.textContent=pendingMessage;try{await action();}catch(error){status.textContent=error instanceof ReferralClientError?error.message:'Referral account status is unavailable. Keep your original capability and exact request, then retry.';}finally{controls.forEach((control,index)=>{control.disabled=disabled[index];control.setAttribute?.('aria-busy','false');});running=false;display();if(documentImpl?.activeElement===documentImpl?.body&&priorFocus&&!priorFocus.disabled&&!priorFocus.hidden)priorFocus.focus();}};
 const changed=()=>{capabilitySaved.checked=false;requestSaved.checked=false;result.hidden=true;};
 for(const event of ['input','change'])capability.addEventListener(event,changed);
 find('[data-generate-referral]').addEventListener('click',()=>run(async()=>{if(client.snapshot().phase!=='empty')fail('Keep the capability matching your retained request.');capability.value=generateReferralCapability(cryptoImpl);capability.dispatchEvent(new Event('input',{bubbles:true}));status.textContent='New private referral capability generated locally. Reveal or copy it and save it privately before registration. No account was created.';}));
 find('[data-reveal-referral]').addEventListener('click',()=>{capability.type=capability.type==='password'?'text':'password';find('[data-reveal-referral]').textContent=capability.type==='password'?'Reveal capability':'Hide capability';});
 find('[data-copy-referral]').addEventListener('click',()=>run(async()=>{const value=privateCapability(capability.value.trim());try{await navigatorImpl.clipboard.writeText(value);status.textContent='Private capability copied. Save it securely and separately from request JSON. Do not share it.';}catch{capability.disabled=false;capability.type='text';find('[data-reveal-referral]').textContent='Hide capability';capability.focus();capability.select();status.textContent='Clipboard unavailable. Copy the selected private capability, then save it securely. Hide it after copying.';}}));
 const showAccount=async action=>{result.hidden=true;const original=capability.value.trim(),account=await action(original);if(original!==capability.value.trim())fail('Capability changed. Read status again with the intended capability.');result.textContent=referralAccountText(account);result.hidden=false;status.textContent='Referral account read. Only the public referral code belongs in paid calls.';};
 find('[data-read-referral]').addEventListener('click',()=>run(()=>showAccount(secret=>client.read(secret)),'Reading the private referral account…'));
 find('[data-prepare-registration]').addEventListener('click',()=>run(async()=>{if(!capabilitySaved.checked||!termsAccepted.checked)fail('Save your capability privately and accept the published terms before preparing registration.');await client.prepare(capability.value.trim());requestSaved.checked=false;status.textContent=client.snapshot().phase==='prepared'?'Exact registration ready. Save the JSON before sending; keep the capability separately.':'Retained registration request. It may already exist; retry unchanged.';}));
 form.addEventListener('submit',event=>{event.preventDefault();return run(async()=>{if(!capabilitySaved.checked||!termsAccepted.checked||!requestSaved.checked)fail('Save the private capability and exact request, and accept the published terms before sending.');if(envelope.value!==client.snapshot().envelope)fail('The displayed request changed. Restore the exact request before sending.');await showAccount(secret=>client.send(secret));},'Sending the retained registration request…');});
 find('[data-copy-registration]').addEventListener('click',()=>run(async()=>{const value=client.snapshot().envelope;if(!value)fail('Prepare registration first.');try{await navigatorImpl.clipboard.writeText(value);status.textContent='Registration request copied. Keep the capability separately.';}catch{envelope.disabled=false;envelope.focus();envelope.select();status.textContent='Clipboard unavailable. Copy the selected request JSON.';}}));
 find('[data-export-registration]').addEventListener('click',()=>run(async()=>{const value=client.snapshot().envelope;if(!value)fail('Prepare registration first.');const url=URLImpl.createObjectURL(new Blob([value+'\n'],{type:'application/json'})),link=documentImpl.createElement('a');link.href=url;link.download='agenttoolbox-referral-registration.json';documentImpl.body.append(link);link.click();link.remove();setTimeout(()=>URLImpl.revokeObjectURL(url),1000);status.textContent='Registration request download requested. Keep the capability separately.';}));
 find('[data-restore-registration]').addEventListener('click',()=>run(async()=>{await client.restore(importArea.value,capability.value.trim());requestSaved.checked=false;status.textContent='Exact registration restored without sending. Read status or retry unchanged to resolve its outcome.';}));
 find('[data-registration-file]').addEventListener('change',()=>run(async()=>{const file=find('[data-registration-file]').files?.[0];if(!file)return;if(file.size>4096)fail('Registration request file is too large.');importArea.value=await file.text();status.textContent='File loaded for review. Restore it with the separately saved capability.';}));
 find('[data-new-registration]').addEventListener('click',()=>run(async()=>{client.startNew();requestSaved.checked=false;result.hidden=true;status.textContent='Previous request cleared from this page. Keep its saved copy and original capability.';}));
 globalThis.addEventListener?.('pagehide',()=>{capability.value='';capability.type='password';});
 for(const element of section.querySelectorAll('[data-referral-enhanced]'))element.hidden=false;
 form.noValidate=true;display();return client;
}

if(typeof document!=='undefined')for(const page of document.querySelectorAll('[data-referral-page]')){
 const capabilityInput=page.querySelector('[data-capability]');
 bindReferralAccount(page.querySelector('[data-referral-account]'));
 bindReferralWallet(page.querySelector('[data-referral-wallet]'),{capabilityInput});
 bindWalletProof(page.querySelector('[data-wallet-proof]'),{kind:'referral',capabilityInput});
 bindCreatorEarnings(page.querySelector('[data-creator-earnings]'),{kind:'referral',capabilityInput});
 bindPayoutRequests(page.querySelector('[data-payout-requests]'),{kind:'referral',capabilityInput});
}
