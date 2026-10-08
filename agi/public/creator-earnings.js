const toolPattern=/^creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const referralPattern=/^ref_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const policies=Object.freeze({
 creator:Object.freeze({capability:/^atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,header:'X-Creator-Capability',share:9000,multiplier:9n,denominator:10n,fees:'platform_share_only; no creator deductions'}),
 referral:Object.freeze({capability:/^atbf_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/,header:'X-Referral-Capability',share:100,multiplier:100n,denominator:10000n,fees:'platform funds gas separately; no referral deductions'}),
});
const policyFor=kind=>{if(!Object.hasOwn(policies,kind))throw new Error('Unsupported earnings kind.');return policies[kind];};
const baseUsdc='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const fields=['api_version','tool_id','network','asset','share_bps','revenue_basis','gross_atomic','accrued_atomic','fractional_atom_numerator','fractional_atom_denominator','confirmed_paid_atomic','reserved_atomic','available_atomic','receipt_count','payout_count','execution_status','receipt_basis','payout_basis','fees','transfers_enabled','payment_effect'];
const amounts=['gross_atomic','accrued_atomic','fractional_atom_numerator','confirmed_paid_atomic','reserved_atomic','available_atomic'];
// The runtime bounds a complete snapshot to 5,000 uint256 receipt/payout rows.
// Its sum may exceed one uint256; never coerce these strings to Number.
const atomic=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,81})$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=5000;
class EarningsReadError extends Error{}
const fail=message=>{throw new EarningsReadError(message);};
const invalid=()=>fail('Earnings are unavailable: the server returned an unexpected or inconsistent response. No balance was assumed.');

export function validateCreatorEarnings(value,expectedToolId,{kind='creator'}={}){
 const policy=policyFor(kind),referral=kind==='referral',expectedFields=referral?fields.filter(key=>!['tool_id','execution_status'].includes(key)).concat('referral_code','terms_version'):fields;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==expectedFields.length||!expectedFields.every(key=>Object.hasOwn(value,key)))invalid();
 if(referral){if(!referralPattern.test(value.referral_code)||value.terms_version!=='first-party-referrals-2026-10-07.v1')invalid();}
 else if(!toolPattern.test(expectedToolId)||value.tool_id!==expectedToolId||!['installed_adapter','metadata_only_not_earning'].includes(value.execution_status))invalid();
 if(value.api_version!=='1'||value.network!=='eip155:8453'||typeof value.asset!=='string'||value.asset.toLowerCase()!==baseUsdc||value.share_bps!==policy.share||value.revenue_basis!=='gross'||value.fractional_atom_denominator!==String(policy.denominator)||!count(value.receipt_count)||!count(value.payout_count)||value.receipt_basis!=='facilitator_confirmed_not_independently_reconciled'||value.payout_basis!=='finalized_canonical_base_usdc_transfer'||value.fees!==policy.fees||value.transfers_enabled!==false||value.payment_effect!=='none'||!amounts.every(key=>atomic(value[key])))invalid();
 const gross=BigInt(value.gross_atomic),accrued=BigInt(value.accrued_atomic),carry=BigInt(value.fractional_atom_numerator),paid=BigInt(value.confirmed_paid_atomic),reserved=BigInt(value.reserved_atomic),available=BigInt(value.available_atomic);
 if(carry>=policy.denominator||gross*policy.multiplier!==accrued*policy.denominator+carry||paid+reserved+available!==accrued||(value.receipt_count===0)!==(gross===0n)||(value.payout_count===0&&(paid!==0n||reserved!==0n)))invalid();
 return Object.freeze({...value});
}

export function formatEarningsUsdc(value){
 if(!atomic(value))invalid();
 const amount=BigInt(value);
 return `${amount/1000000n}.${(amount%1000000n).toString().padStart(6,'0')} USDC`;
}

export function creatorEarningsText(value,{readAt,kind='creator'}={}){
 const earnings=validateCreatorEarnings(value,value?.tool_id,{kind}),referral=kind==='referral';
 if(typeof readAt!=='string'||!Number.isFinite(Date.parse(readAt)))invalid();
 return [
  referral?`Referral account: ${earnings.referral_code}`:`Tool: ${earnings.tool_id}`,
  referral?'Eligibility: first-party tools only; creator tools excluded.':`Execution: ${earnings.execution_status==='installed_adapter'?'reviewed adapter installed; earnings require successful paid sales':'metadata only; not currently installed to earn'}`,
  `Network: Base (eip155:8453). ${referral?'Referral share: 1% of eligible gross sales; no referral deductions.':'Creator share: 90% of gross sales; no creator deductions.'}`,
  `Gross sales: ${formatEarningsUsdc(earnings.gross_atomic)}`,
  `Accrued ${referral?'referral':'creator'} share: ${formatEarningsUsdc(earnings.accrued_atomic)}`,
  `Reserved: ${formatEarningsUsdc(earnings.reserved_atomic)}`,
  `Confirmed paid: ${formatEarningsUsdc(earnings.confirmed_paid_atomic)}`,
  `Available: ${formatEarningsUsdc(earnings.available_atomic)}`,
  `Fractional carry: ${earnings.fractional_atom_numerator}/${earnings.fractional_atom_denominator} of one atomic unit (1 atomic unit = 0.000001 USDC).`,
  `Sales receipts: ${earnings.receipt_count}. Payout records: ${earnings.payout_count}.`,
  'Sales receipts: facilitator-confirmed settlements; not independently reconciled.',
  'Confirmed payouts: finalized, canonical Base USDC transfers.',
  `Read at: ${readAt} (browser time). This snapshot does not update automatically.`,
  'Reading earnings initiates no payout.',
 ].join('\n');
}

const responseError=(status,kind)=>status===403?(kind==='referral'?'The referral capability did not match a referral account. No balance was assumed.':'The creator capability and tool ID did not match an approved entitlement. No balance was assumed.'):status===429?'Earnings reads are temporarily limited. Retry later; no balance was assumed.':status>=500?'A complete earnings snapshot is unavailable. Retry later; no balance was assumed.':'The earnings read was rejected. Check your capability and account details; no balance was assumed.';

export function createCreatorEarningsClient({kind='creator',fetchImpl=globalThis.fetch,timeoutMs=15000,now=()=>new Date()}={}){
 const policy=policyFor(kind),referral=kind==='referral';
 let generation=0,active=null;
 const clear=()=>{generation++;active?.abort();active=null;};
 return {
  clear,
  async read(toolId,capability){
   clear();
   if(!referral&&(typeof toolId!=='string'||!toolPattern.test(toolId)))fail('Enter the exact creator tool ID from your approved submission.');
   if(referral&&toolId!==null)fail('Referral earnings use the account resolved by your capability.');
   if(typeof capability!=='string'||!policy.capability.test(capability))fail(`Paste your original private ${kind} capability in the wallet section above.`);
   const current=generation,controller=new AbortController();active=controller;
   let timedOut=false;
   const interrupted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new EarningsReadError(timedOut?'The earnings read timed out. Retry to read a current snapshot; no balance was assumed.':'The earnings read was cancelled.')), {once:true}));
   const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
   try{
    const result=await Promise.race([interrupted,(async()=>{
     const response=await fetchImpl(referral?'/v1/referrals/me/earnings':`/v1/creator-tools/${toolId}/earnings`,{method:'GET',headers:{Accept:'application/json',[policy.header]:capability},cache:'no-store',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
     if(!response.ok)fail(responseError(response.status,kind));
     const earnings=validateCreatorEarnings(await response.json(),toolId,{kind}),readAt=now().toISOString();
     return Object.freeze({earnings,readAt});
    })()]);
    return current===generation?result:null;
   }catch(error){
    if(current!==generation)return null;
    if(error instanceof EarningsReadError)throw error;
    fail('Earnings could not be read. Retry to read a current snapshot; no balance was assumed.');
   }finally{clearTimeout(timer);if(current===generation)active=null;}
  },
 };
}

// The page entrypoint supplies the existing password input. This module neither
// owns that field nor retains a capability beyond the active request.
export function bindCreatorEarnings(root,{kind='creator',capabilityInput,client=createCreatorEarningsClient({kind}),lifecycleTarget=globalThis,documentImpl=globalThis.document}={}){
 policyFor(kind);
 const form=root.querySelector('[data-creator-earnings-form]'),tool=root.querySelector('[data-earnings-tool]'),button=root.querySelector('[data-read-earnings]'),status=root.querySelector('[role="status"]'),result=root.querySelector('[data-earnings-result]');
 if(!capabilityInput)throw new Error('Earnings requires the shared capability input.');
 let generation=0,running=false;
 const hide=()=>{result.hidden=true;result.textContent='';};
 const invalidate=()=>{generation++;client.clear();running=false;button.disabled=false;button.setAttribute?.('aria-busy','false');hide();status.textContent='Inputs changed. Read earnings again for the intended account.';};
 for(const input of [capabilityInput,tool].filter(Boolean))for(const event of ['input','change'])input.addEventListener(event,invalidate);
 lifecycleTarget.addEventListener?.('pagehide',invalidate);
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(running)return;
  const priorFocus=documentImpl?.activeElement;
  running=true;button.disabled=true;button.setAttribute?.('aria-busy','true');hide();status.textContent='Reading private earnings…';
  const current=++generation,capability=capabilityInput.value.trim(),toolId=kind==='referral'?null:tool.value.trim();
  const stillCurrent=()=>current===generation&&capabilityInput.value.trim()===capability&&(kind==='referral'||tool.value.trim()===toolId);
  try{
   const snapshot=await client.read(toolId,capability);
   if(!stillCurrent()){if(current===generation)invalidate();return;}
   if(!snapshot)return;
   result.textContent=creatorEarningsText(snapshot.earnings,{readAt:snapshot.readAt,kind});result.hidden=false;
   status.textContent='Private earnings read. No payout initiated.';
  }catch(error){
   if(stillCurrent()){hide();status.textContent=error instanceof EarningsReadError?error.message:'Earnings could not be read. No balance was assumed.';}
   else if(current===generation)invalidate();
  }finally{if(current===generation){running=false;button.disabled=false;button.setAttribute?.('aria-busy','false');if(documentImpl?.activeElement===documentImpl?.body&&priorFocus&&!priorFocus.disabled&&!priorFocus.hidden)priorFocus.focus();}}
 });
 form.noValidate=true;button.hidden=false;
 return {clear:invalidate};
}
