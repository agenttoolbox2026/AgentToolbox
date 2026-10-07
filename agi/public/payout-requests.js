import {validateWalletView} from './creator-wallet.js';
import {validateCreatorEarnings,formatEarningsUsdc} from './creator-earnings.js';

const policies=Object.freeze({creator:{header:'X-Creator-Capability',capability:/^atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,wallet:'/v1/creators/me/payout-wallet'},referral:{header:'X-Referral-Capability',capability:/^atbf_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,wallet:'/v1/referrals/me/payout-wallet'}});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,toolPattern=/^creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,referralPattern=/^ref_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const baseUsdc='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',network='eip155:8453',maxAmount=(1n<<256n)-1n,maxBytes=4096;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value),exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const revision=value=>Number.isInteger(value)&&value>0&&value<=2147483647,date=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d{2}-\d{2}T/.test(value)&&Number.isFinite(Date.parse(value));
const atomic=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)&&BigInt(value)<=maxAmount,cursor=value=>value===null||(typeof value==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(value)&&!/atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]/.test(value));
const hash=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value),quantity=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const validUuid=value=>typeof value==='string'&&uuid.test(value);
const states=['requested','reserved','awaiting_owner','submitted','unknown','paid','cancelled'];
class PayoutRequestError extends Error{}
const fail=message=>{throw new PayoutRequestError(message);},invalid=()=>fail('Payout status is unavailable: the response was unexpected or inconsistent. No payment was assumed.');
const policyFor=kind=>Object.hasOwn(policies,kind)?policies[kind]:fail('Unsupported payout kind.');
const subjectValid=(subject,kind)=>typeof subject==='string'&&(kind==='creator'?toolPattern:referralPattern).test(subject);
const requestPath=(kind,subject)=>kind==='referral'?'/v1/referrals/me/payout-requests':`/v1/creator-tools/${subject}/payout-requests`;
const earningsPath=(kind,tool)=>kind==='referral'?'/v1/referrals/me/earnings':`/v1/creator-tools/${tool}/earnings`;
const sha256=async(value,cryptoImpl)=>Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value))),byte=>byte.toString(16).padStart(2,'0')).join('');
function noSecret(value){if(/atb[cf]_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]/.test(JSON.stringify(value)))fail('A payout retry request must not contain any private capability. Nothing was sent.');return value;}
const envelopeError='Use an unchanged payout request exported by this page with the original capability kept separately.';

export function parsePayoutUsdc(value){
 if(typeof value!=='string'||value.length>85||!/^(0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value))fail('Enter a positive USDC amount with up to six decimal places; do not use commas or scientific notation.');
 const parts=value.split('.'),amount=(BigInt(parts[0])*1000000n+BigInt((parts[1]??'').padEnd(6,'0'))).toString();
 if(!atomic(amount))fail('Requested amount must be positive and fit the Base USDC uint256 limit.');
 return amount;
}

export function validatePayoutEnvelope(value,{kind='creator'}={}){
 policyFor(kind);noSecret(value);
 if(!exact(value,['api_version','kind','path','subject_id','claim_id','capability_hash','body'])||value.api_version!=='1'||value.kind!==`${kind}_payout_request`||!subjectValid(value.subject_id,kind)||value.path!==requestPath(kind,value.subject_id)||typeof value.claim_id!=='string'||!uuid.test(value.claim_id)||typeof value.capability_hash!=='string'||!/^[0-9a-f]{64}$/.test(value.capability_hash))fail(envelopeError);
 const body=value.body;
 if(!exact(body,['request_id','amount_atomic','claim_revision'])||typeof body.request_id!=='string'||!uuid.test(body.request_id)||!atomic(body.amount_atomic)||!revision(body.claim_revision)||new TextEncoder().encode(JSON.stringify(value)).length>maxBytes)fail(envelopeError);
 return Object.freeze({...value,body:Object.freeze({...body})});
}

export function validatePayoutRequest(value,{kind='creator',subject,envelope=null}={}){
 policyFor(kind);
 if(!exact(value,['api_version','request_id','beneficiary_kind','subject_id','amount_atomic','network','asset','claim_id','claim_revision','created_at','state','payout','payment_effect'])||value.api_version!=='1'||!validUuid(value.request_id)||value.beneficiary_kind!==kind||!subjectValid(value.subject_id,kind)||value.subject_id!==subject||!atomic(value.amount_atomic)||value.network!==network||value.asset!==baseUsdc||!validUuid(value.claim_id)||!revision(value.claim_revision)||!date(value.created_at)||!states.includes(value.state)||value.payment_effect!=='none')invalid();
 if(envelope&&(value.request_id!==envelope.body.request_id||value.amount_atomic!==envelope.body.amount_atomic||value.claim_revision!==envelope.body.claim_revision||value.claim_id!==envelope.claim_id||value.subject_id!==envelope.subject_id))invalid();
 const p=value.payout;
 if(value.state==='requested'){if(p!==null)invalid();}
 else{
  if(!exact(p,['payout_id','batch_id','state','revision','amount_atomic','created_at','receipt'])||!validUuid(p.payout_id)||!validUuid(p.batch_id)||p.state!==value.state||!Number.isInteger(p.revision)||p.revision<0||p.revision>2147483647||p.amount_atomic!==value.amount_atomic||!date(p.created_at)||Date.parse(p.created_at)<Date.parse(value.created_at))invalid();
  const r=p.receipt;
  if(value.state==='paid'){
   if(!exact(r,['transaction_hash','block_hash','block_number','log_index','checked_at','basis'])||!hash(r.transaction_hash)||!hash(r.block_hash)||!quantity(r.block_number)||!quantity(r.log_index)||!date(r.checked_at)||Date.parse(r.checked_at)<Date.parse(p.created_at)||r.basis!=='finalized_canonical_base_usdc_transfer')invalid();
  }else if(r!==null)invalid();
 }
 return value;
}

export function payoutRequestText(value,{kind='creator',subject=value?.subject_id}={}){
 const request=validatePayoutRequest(value,{kind,subject}),lines=[`Request: ${request.request_id}`,`${kind==='creator'?'Tool':'Referral account'}: ${request.subject_id}`,`Requested: ${formatEarningsUsdc(request.amount_atomic)} (${request.amount_atomic} atomic units)`,`Network: Base (eip155:8453); USDC ${baseUsdc}`,`Wallet claim: ${request.claim_id}; revision ${request.claim_revision}`,`State: ${request.state}`,`Requested at: ${request.created_at}`];
 const descriptions={requested:'Request accepted. No funds held; wallet proof and owner approval are required before reservation.',reserved:'Funds reserved. Owner review and external signature are still required.',awaiting_owner:'Awaiting the owner’s external wallet signature. No confirmed payment.',submitted:'Transaction submitted for verification. No finalized payment has been confirmed.',unknown:'Transfer outcome uncertain. Reservation remains held; do not request a replacement transfer.',paid:'Paid: the backend verified a finalized canonical Base USDC transfer.',cancelled:'Reservation cancelled before signing authorization. This request stays linked to the cancelled payout.'};
 lines.push(descriptions[request.state]);
 if(request.payout){lines.push(`Payout: ${request.payout.payout_id}; revision ${request.payout.revision}`);if(request.payout.receipt){const r=request.payout.receipt;lines.push(`Transaction: ${r.transaction_hash}`,`Block: ${r.block_number}; hash ${r.block_hash}; log ${r.log_index}`,`Verified at: ${r.checked_at}`);}}
 lines.push('Status is a snapshot. Reading or retrying this request does not sign or send a transfer.');return lines.join('\n');
}

export function createPayoutRequestsClient({kind='creator',fetchImpl=globalThis.fetch,cryptoImpl=globalThis.crypto,timeoutMs=15000}={}){
 const policy=policyFor(kind);let envelope=null,current=null,readIdentity=null,phase='empty',busy=false,generation=0;
 const snapshot=()=>({envelope:envelope?JSON.stringify(envelope,null,2):null,current,phase,busy});
 const enter=()=>{if(busy)fail('Wait for the current payout request to finish.');busy=true;};
 const identity=async capability=>{if(typeof capability!=='string'||!policy.capability.test(capability))fail(`Paste the original private ${kind} capability in the wallet section above.`);return sha256(capability,cryptoImpl);};
 const bound=async capability=>{const result=await identity(capability);if(envelope&&result!==envelope.capability_hash)fail('This retained request belongs to another capability. Restore the original capability separately.');return result;};
 const toolValue=tool=>{if(kind==='creator'&&!subjectValid(tool,kind))fail('Enter the exact creator tool ID from your approved submission.');if(kind==='referral'&&tool!==null)fail('The referral account is resolved by capability.');return tool;};
 const clearRead=()=>{generation++;current=null;readIdentity=null;};
 async function request(path,method,capability,body){
  const controller=new AbortController();let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new PayoutRequestError('The payout request timed out.'));},timeoutMs);});
  try{return await Promise.race([timeout,(async()=>{
   const response=await fetchImpl(path,{method,headers:{Accept:'application/json',[policy.header]:capability,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(noSecret(body))}:{}),cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
   if(!response.ok){const error=new PayoutRequestError(response.status===404?'This request was not found. Its earlier outcome may still be uncertain; keep the exact saved request.':response.status===403?'The capability did not authorize this private payout account.':response.status===409?'The payout request conflicts with the current wallet or available earnings. Retain the exact request and read its status.':response.status===429?'Payout requests are temporarily limited. Keep the exact request and retry later.':'Payout service is unavailable or rejected the request. Keep the exact request for review.');error.definite=[400,403,409,413,415,429].includes(response.status);throw error;}
   return response.json();
  })()]);}catch(error){if(error instanceof PayoutRequestError)throw error;fail('Payout service could not be read. Keep the exact request and try again.');}finally{clearTimeout(timer);}
 }
 async function earnings(tool,capability){return validateCreatorEarnings(await request(earningsPath(kind,tool),'GET',capability),tool,{kind});}
 return {
  snapshot,clearRead,
  async read(tool,capability){
   enter();clearRead();const stamp=generation;
   try{
    toolValue(tool);const commitment=await bound(capability),data=await request(policy.wallet,'GET',capability);
    if(!exact(data,['api_version','wallet','history','next_cursor'])||data.api_version!=='1'||!Array.isArray(data.history)||data.history.length>20||!cursor(data.next_cursor))invalid();
    data.history.forEach(validateWalletView);const wallet=data.wallet===null?null:validateWalletView(data.wallet),balance=await earnings(tool,capability);
    if(stamp!==generation)fail('Inputs changed while reading. Read wallet and earnings again.');
    current=Object.freeze({wallet:wallet?Object.freeze({...wallet}):null,earnings:balance});readIdentity=commitment;return current;
   }finally{busy=false;}
  },
  async prepare(amount,tool,capability){
   enter();const stamp=generation;
   try{
    toolValue(tool);const commitment=await bound(capability),amountAtomic=parsePayoutUsdc(amount);
    if(envelope){if(envelope.body.amount_atomic!==amountAtomic||(kind==='creator'&&envelope.subject_id!==tool))fail('A different request is retained. Resolve it before starting another request.');return snapshot().envelope;}
    if(stamp!==generation||!current||readIdentity!==commitment||!current.wallet||(kind==='creator'&&current.earnings.tool_id!==tool))fail('Read a saved current wallet and available earnings with this capability before preparing a request.');
    if(BigInt(amountAtomic)>BigInt(current.earnings.available_atomic))fail('The requested amount exceeds the available earnings snapshot.');
    const subject=kind==='creator'?tool:current.earnings.referral_code;
    envelope=validatePayoutEnvelope({api_version:'1',kind:`${kind}_payout_request`,path:requestPath(kind,subject),subject_id:subject,claim_id:current.wallet.claim_id,capability_hash:commitment,body:{request_id:cryptoImpl.randomUUID(),amount_atomic:amountAtomic,claim_revision:current.wallet.revision}},{kind});phase='prepared';return snapshot().envelope;
   }finally{busy=false;}
  },
  async restore(text,capability){
   enter();
   try{
    if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes)fail(envelopeError);
    let value;try{value=JSON.parse(text);}catch{fail(envelopeError);}
    const imported=validatePayoutEnvelope(value,{kind}),commitment=await identity(capability);
    if(imported.capability_hash!==commitment)fail('Use the original capability for this saved request.');
    if(envelope&&JSON.stringify(imported)!==JSON.stringify(envelope))fail('A different request is retained. Resolve it before importing another request.');
    envelope=imported;clearRead();phase='uncertain';return snapshot().envelope;
   }finally{busy=false;}
  },
  async send(capability){
   enter();let attempted=false;const wasUncertain=phase==='uncertain',stamp=generation;
   try{
    if(!envelope)fail('Prepare and save an exact payout request first.');await bound(capability);if(stamp!==generation)fail('Inputs changed before sending. Restore the original capability and retry the retained request.');
    attempted=true;phase='uncertain';clearRead();
    const result=validatePayoutRequest(await request(envelope.path,'POST',capability,envelope.body),{kind,subject:envelope.subject_id,envelope});phase='confirmed';return result;
   }catch(error){if(attempted&&error.definite&&!wasUncertain)phase='rejected';if(attempted&&!error.definite)fail('The payout request outcome is uncertain. Retain this exact request and capability; retry unchanged or read its status.');throw error;}
   finally{busy=false;}
  },
  async resolve(capability){
   enter();
   try{if(!envelope)fail('Prepare or restore the exact request before reading its status.');await bound(capability);const result=validatePayoutRequest(await request(`${envelope.path}/${envelope.body.request_id}`,'GET',capability),{kind,subject:envelope.subject_id,envelope});phase='confirmed';return result;}finally{busy=false;}
  },
  async history(tool,capability,nextCursor=null){
   enter();const stamp=generation;
   try{toolValue(tool);await bound(capability);if(!cursor(nextCursor))fail('Use only the returned private history cursor.');const balance=await earnings(tool,capability),subject=kind==='creator'?tool:balance.referral_code;
    const data=await request(`${requestPath(kind,subject)}?limit=20${nextCursor===null?'':`&cursor=${encodeURIComponent(nextCursor)}`}`,'GET',capability);
    if(!exact(data,['api_version','requests','next_cursor','payment_effect'])||data.api_version!=='1'||data.payment_effect!=='none'||!Array.isArray(data.requests)||data.requests.length>20||!cursor(data.next_cursor)||new Set(data.requests.map(r=>r?.request_id)).size!==data.requests.length)invalid();
    data.requests.forEach(row=>validatePayoutRequest(row,{kind,subject}));if(stamp!==generation)fail('Inputs changed while reading. Read history again.');return data;
   }finally{busy=false;}
  },
  startNew(){if(busy)fail('Wait for the current payout request to finish.');if(phase==='uncertain')fail('The retained request may already exist. Retry unchanged or resolve its status before starting another request.');envelope=null;clearRead();phase='empty';},
 };
}

export function bindPayoutRequests(root,{kind='creator',capabilityInput,client=createPayoutRequestsClient({kind}),navigatorImpl=globalThis.navigator,documentImpl=globalThis.document,URLImpl=globalThis.URL,lifecycleTarget=globalThis}={}){
 policyFor(kind);if(!capabilityInput)fail('Payout requests require the shared capability input.');
 const requestsEnabled=root.dataset?.payoutRequestsEnabled!=='false';
 const get=name=>root.querySelector(`[data-payout-${name}]`),status=root.querySelector('[role="status"]'),tool=get('tool'),amount=get('amount'),area=get('envelope'),controls=[...root.querySelectorAll('button,input,textarea')];let running=false,generation=0,nextCursor=null;
 const toolValue=()=>kind==='creator'?tool.value.trim():null;
 const hideResults=()=>{for(const name of ['current','result','history-result']){get(name).hidden=true;get(name).textContent='';}nextCursor=null;get('more').hidden=true;};
 const display=()=>{const state=client.snapshot();area.value=state.envelope??'';get('prepared').hidden=!state.envelope;amount.readOnly=!!state.envelope;if(tool)tool.readOnly=!!state.envelope;get('new').disabled=state.phase==='uncertain';get('send').disabled=!requestsEnabled;
  if(state.envelope){const e=JSON.parse(state.envelope);get('summary').textContent=`Exact requested amount: ${formatEarningsUsdc(e.body.amount_atomic)} (${e.body.amount_atomic} atomic units)\nWallet claim: ${e.claim_id}; revision ${e.body.claim_revision}\n${state.current?.wallet?.claim_id===e.claim_id?'Validated current address: '+state.current.wallet.address:'Re-read the current wallet to verify its address; this saved request names a claim and revision.'}\nRequest acceptance holds no funds. Owner approval and external signing remain separate.`;}
 };
 const run=async action=>{if(running||client.snapshot().busy)return;running=true;const prior=controls.map(c=>c.disabled);controls.forEach(c=>{c.disabled=true;});const stamp=generation,secret=capabilityInput.value.trim(),subject=toolValue(),stillCurrent=()=>stamp===generation&&capabilityInput.value.trim()===secret&&toolValue()===subject;
  try{await action(secret,subject,stillCurrent);}catch(error){if(stillCurrent())status.textContent=error instanceof PayoutRequestError?error.message:'Payout information is unavailable. Keep the exact request and try again.';}finally{controls.forEach((c,i)=>{c.disabled=prior[i];});running=false;display();}
 };
 const showResult=(value,label)=>{get('result').textContent=payoutRequestText(value,{kind});get('result').hidden=false;status.textContent=label;};
 const invalidate=()=>{generation++;client.clearRead();hideResults();get('saved').checked=false;get('summary').textContent='';status.textContent='Inputs changed. Retained requests stay bound to the original account; read current details again.';display();};
 for(const input of [capabilityInput,tool].filter(Boolean))for(const event of ['input','change'])input.addEventListener(event,invalidate);
 lifecycleTarget.addEventListener?.('pagehide',()=>{capabilityInput.value='';invalidate();});
 get('read').addEventListener('click',()=>run(async(secret,subject,stillCurrent)=>{get('current').hidden=true;const current=await client.read(subject,secret);if(!stillCurrent()){client.clearRead();return;}const w=current.wallet;get('current').textContent=[w?`Current wallet: ${w.address}\nClaim: ${w.claim_id}; revision ${w.revision}\nOwnership: ${w.ownership_status}; owner approval: ${w.owner_approval.status}`:'Current wallet: none saved. Save an address before preparing a payout request.',`Available: ${formatEarningsUsdc(current.earnings.available_atomic)}`,`Account: ${kind==='creator'?current.earnings.tool_id:current.earnings.referral_code}`,'Snapshot only; owner reservation rechecks current wallet and funds.'].join('\n');get('current').hidden=false;status.textContent='Current wallet and earnings read. Nothing sent.';}));
 get('prepare').addEventListener('click',()=>run(async(secret,subject,stillCurrent)=>{await client.prepare(amount.value.trim(),subject,secret);if(!stillCurrent())return;get('saved').checked=false;get('result').hidden=true;status.textContent=client.snapshot().phase==='prepared'?'Exact request prepared. Nothing sent. Save it with your capability kept separately.':'Retained exact request. It may already have been recorded; keep it unchanged and read its status.';}));
 get('send').addEventListener('click',()=>run(async(secret,subject,stillCurrent)=>{if(!requestsEnabled)fail('Payout requests are temporarily unavailable. Keep the exact request and read its status.');if(!get('saved').checked)fail('Save the exact request and confirm the checkbox before sending.');if(area.value!==client.snapshot().envelope)fail('The displayed request differs from the retained request. Restore the exact saved JSON.');const e=JSON.parse(client.snapshot().envelope);if(parsePayoutUsdc(amount.value.trim())!==e.body.amount_atomic||(kind==='creator'&&subject!==e.subject_id))fail('The displayed amount or tool differs from the retained request. Restore the exact request.');get('result').hidden=true;get('current').hidden=true;const result=await client.send(secret);if(stillCurrent())showResult(result,'Request recorded. Keep its exact JSON. Read status to follow owner review and finalized payment.');}));
 get('resolve').addEventListener('click',()=>run(async(secret,subject,stillCurrent)=>{get('result').hidden=true;const result=await client.resolve(secret);if(stillCurrent())showResult(result,'Retained request status read. This result does not change the current wallet or earnings snapshot.');}));
 const showHistory=async(secret,subject,stillCurrent,more)=>{get('history-result').hidden=true;const result=await client.history(subject,secret,more?nextCursor:null);if(!stillCurrent())return;get('history-result').textContent=result.requests.length?result.requests.map(row=>payoutRequestText(row,{kind})).join('\n\n—\n\n'):'No payout requests in this page.';get('history-result').hidden=false;nextCursor=result.next_cursor;get('more').hidden=nextCursor===null;status.textContent='Private request history read. Each page contains at most 20 requests.';};
 get('history').addEventListener('click',()=>run((secret,subject,stillCurrent)=>showHistory(secret,subject,stillCurrent,false)));
 get('more').addEventListener('click',()=>run((secret,subject,stillCurrent)=>showHistory(secret,subject,stillCurrent,true)));
 get('restore').addEventListener('click',()=>run(async(secret,subject,stillCurrent)=>{await client.restore(get('import').value,secret);if(!stillCurrent())return;const e=JSON.parse(client.snapshot().envelope);if(tool)tool.value=e.subject_id;amount.value=formatEarningsUsdc(e.body.amount_atomic).replace(' USDC','');get('saved').checked=false;hideResults();status.textContent='Exact request restored. Nothing sent. Its earlier outcome is unknown; save it and retry unchanged or read its status.';}));
 get('new').addEventListener('click',()=>run(async()=>{client.startNew();get('saved').checked=false;hideResults();status.textContent='Read current wallet and earnings before a new explicit request. Earlier accepted requests may still be pending.';}));
 get('copy').addEventListener('click',()=>run(async()=>{const text=client.snapshot().envelope;if(!text)fail('Prepare a request first.');try{await navigatorImpl.clipboard.writeText(text);status.textContent='Exact request copied. Keep your capability separately.';}catch{area.focus();area.select();status.textContent='Copy the selected exact JSON. Keep your capability separately.';}}));
 get('export').addEventListener('click',()=>run(async()=>{const text=client.snapshot().envelope;if(!text)fail('Prepare a request first.');const url=URLImpl.createObjectURL(new Blob([text+'\n'],{type:'application/json'})),link=documentImpl.createElement('a');link.href=url;link.download=`agenttoolbox-${kind}-payout-request.json`;documentImpl.body.append(link);link.click();link.remove();setTimeout(()=>URLImpl.revokeObjectURL(url),1000);status.textContent='Request download requested. Keep your capability separately.';}));
 get('file').addEventListener('change',()=>run(async()=>{const file=get('file').files?.[0];if(!file)return;if(file.size>maxBytes)fail('The saved payout request is too large.');get('import').value=await file.text();status.textContent='File loaded. Restore with its original capability; nothing sent.';}));
 amount.addEventListener('input',()=>{get('saved').checked=false;});
 for(const name of ['read','history','prepare','restore'])get(name).hidden=false;display();return client;
}
