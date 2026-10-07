import {retryFingerprint,validateRetryEnvelope,retryBodyFingerprint} from './retry-envelope.js';
for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);button.textContent='Copied';setTimeout(()=>{button.textContent='Copy JSON';},1800);}catch{button.textContent='Select text to copy';}
});
const counter=document.getElementById('paid-counter'),status=document.getElementById('counter-status');
for(const feedbackForm of document.querySelectorAll('.feedback-form')){
 const button=feedbackForm.querySelector('button[type="submit"]'),status=feedbackForm.querySelector('[role="status"]');button.hidden=false;
 let lastBody=null,key=null;
 feedbackForm.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled)return;
  const values=new FormData(feedbackForm),body={product_id:values.get('product_id'),version:values.get('version')};
  for(const field of ['outcome','task_description','message']){const value=values.get(field)?.trim();if(value)body[field]=value;}
  if(values.get('rating'))body.rating=Number(values.get('rating'));
  if(values.get('helpful'))body.helpful=values.get('helpful')==='true';
  if(values.get('reference_id')?.trim())body.reference={kind:values.get('reference_kind'),id:values.get('reference_id').trim()};
  const serialized=JSON.stringify(body);if(serialized!==lastBody){key=crypto.randomUUID();lastBody=serialized;}
  button.disabled=true;status.textContent='Sending…';
  try{
   const response=await fetch('/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:serialized,signal:AbortSignal.timeout(10000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Feedback was not saved.');
   status.textContent='Saved. '+(data.evidence.link==='server_record_linked'?'Linked to the server execution record.':'Submitted without a verified execution link.');
  }catch(error){status.textContent=error.name==='TimeoutError'?'Response timed out. Retry the same feedback safely.':error.message;}
  finally{button.disabled=false;}
 });
}
if(counter){
 let running=false;
 const update=async()=>{if(document.hidden||running)return;running=true;
  try{const response=await fetch('/v1/stats',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();const data=await response.json();if(!Number.isSafeInteger(data.lifetime_paid_purchases)||data.lifetime_paid_purchases<0)throw new Error();counter.textContent=data.lifetime_paid_purchases.toLocaleString('en-US');status.textContent='LIVE';status.classList.remove('stale');}
  catch{status.textContent=counter.textContent==='—'?'UNAVAILABLE':'LAST VERIFIED';status.classList.add('stale');}finally{running=false;}
 };
 setInterval(update,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
}
for(const form of document.querySelectorAll('.review-form')){
 const button=form.querySelector('button[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 let key=null,lastBody=null;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;
  const values=new FormData(form),body={visibility:'public',display_name:values.get('display_name').trim(),message:values.get('message').trim()};
  for(const field of ['product_id','version','example_id','parent_reply_id'])if(values.get(field)?.trim())body[field]=values.get(field).trim();
  if(values.get('rating'))body.rating=Number(values.get('rating'));
  const operation=values.get('operation_id')?.trim(),secret=values.get('review_secret')?.trim();
  if(operation||secret)body.purchase_proof={operation_id:operation,secret};
  // Keep retry identity in memory only. Never persist capabilities in web storage.
  const serialized=JSON.stringify(body);if(serialized!==lastBody){key=crypto.randomUUID();lastBody=serialized;}
  button.disabled=true;status.textContent='Publishing…';
  try{
   const response=await fetch(form.dataset.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:serialized,signal:AbortSignal.timeout(10000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Not saved.');
   form.elements.review_secret.value='';lastBody=null;key=null;
   status.textContent=data.publicly_listed?'Published. ':'Saved, excluded from public lists. ';
   const link=document.createElement('a');link.href='/reviews/'+data.review_id;link.textContent='Read thread ↗';status.append(link);
  }catch(error){status.textContent=error.name==='TimeoutError'?'Response timed out. Retry unchanged to avoid a duplicate.':error.message;}
  finally{button.disabled=false;}
 });
}
for(const button of document.querySelectorAll('[data-reply-to]'))button.addEventListener('click',()=>{
 const details=document.getElementById('write-reply'),form=details.querySelector('form');details.open=true;
 form.elements.parent_reply_id.value=button.dataset.replyTo;form.querySelector('.reply-target').textContent='Replying to '+button.dataset.replyTo;
 form.elements.message.focus();
});
const newCapability=prefix=>prefix+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const commitment=async secret=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),v=>v.toString(16).padStart(2,'0')).join('');
const showResult=(form,data)=>{const result=form.querySelector('.workflow-result');result.textContent=JSON.stringify(data,null,2);result.hidden=false;};
const workflowError=error=>error.name==='TimeoutError'?'Response timed out. Keep the same input, capability and request ID for a safe retry.':error.message;
function creatorRetry(form,kind,build,restore){
 const area=form.querySelector('[data-request-envelope]'),details=area.closest('details'),status=form.querySelector('[role="status"]');let envelope=null;
 const display=()=>{area.value=JSON.stringify(envelope,null,2);details.open=true;};
 form.querySelector('[data-copy-request]').addEventListener('click',async()=>{try{if(!envelope)throw new Error();await navigator.clipboard.writeText(JSON.stringify(envelope,null,2));status.textContent='Private retry request copied. Save it with your capability stored separately.';}catch{status.textContent='Prepare a request first, then select and copy its JSON if the clipboard is unavailable.';}});
 form.querySelector('[data-restore-request]').addEventListener('click',async()=>{try{
  if(area.value.length>20000)throw new Error('Retry request is too large.');
  const value=validateRetryEnvelope(JSON.parse(area.value),kind),capability=form.elements.capability.value.trim();
  if(!/^atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(capability)||await commitment(capability)!==value.body.creator_secret_hash)throw new Error('Paste the original private capability separately before restoring this request.');
  restore(value,capability);envelope=value;display();status.textContent='Exact request restored. Review the proposal and accept its terms before sending. No request has been sent.';
 }catch(error){status.textContent=error.message;}});
 return async()=>{
  const {path,body,capability}=await build(),fingerprint=retryFingerprint({path,body});
  if(!envelope||retryBodyFingerprint(envelope)!==fingerprint){
   envelope=validateRetryEnvelope({api_version:'1',kind,path,body:{...body,request_id:crypto.randomUUID()}},kind);display();
   status.textContent='Request prepared; nothing sent. Copy and save the retry JSON, then click submit again. Keep your capability separately.';return null;
  }
  display();return {path:envelope.path,body:envelope.body,capability};
 };
}
const restoreProposal=(form,body)=>{for(const name of ['name','summary','endpoint_url'])form.elements[name].value=body.proposal[name];for(const name of ['input_schema','output_schema'])form.elements[name].value=JSON.stringify(body.proposal[name],null,2);form.elements.consent.checked=false;};
for(const form of document.querySelectorAll('.preview-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]'),copy=form.querySelector('[data-copy-preparation]');button.hidden=false;
 let previousInput=null,context=null,body=null;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Preparing limited preview…';
  try{
   const input=JSON.parse(form.elements.input.value),serialized=JSON.stringify(input);
   if(serialized!==previousInput){const capability=newCapability('atbp_');context={product_id:form.dataset.product,version:form.dataset.version,capability};body={version:form.dataset.version,input,request_id:crypto.randomUUID(),prepare_secret_hash:await commitment(capability)};previousInput=serialized;copy.hidden=true;}
   const response=await fetch('/v1/products/'+form.dataset.product+'/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Preparation-Capability':context.capability},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Preview unavailable.');
   context.prepared_id=data.prepared_id;context.expires_at=data.expires_at;showResult(form,data);copy.hidden=false;status.textContent='Limited preview ready. No payment requested.';
  }catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
 copy.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(JSON.stringify(context,null,2));status.textContent='Private context copied. Keep its capability secret.';}catch{status.textContent='Clipboard unavailable; keep this tab open or use the HTTP preparation workflow.';}});
}
for(const form of document.querySelectorAll('.submission-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 const request=creatorRetry(form,'creator_submission',async()=>{
  const values=new FormData(form),capability=values.get('capability').trim();
  return {path:'/v1/tool-submissions',capability,body:{terms_version:form.dataset.terms,creator_secret_hash:await commitment(capability),proposal:{name:values.get('name').trim(),summary:values.get('summary').trim(),endpoint_url:values.get('endpoint_url').trim(),input_schema:JSON.parse(values.get('input_schema')),output_schema:JSON.parse(values.get('output_schema'))}}};
 },value=>restoreProposal(form,value.body));
 form.querySelector('[data-generate-creator]').addEventListener('click',()=>{if(form.elements.capability.value){status.textContent='Keep the existing capability for retries. Clear it deliberately only to use a different creator capability.';return;}form.elements.capability.value=newCapability('atbc_');status.textContent='Capability generated in this tab only. Copy and save it privately before submitting.';});
 form.querySelector('[data-copy-creator]').addEventListener('click',async()=>{try{if(!form.elements.capability.value)throw new Error();await navigator.clipboard.writeText(form.elements.capability.value);status.textContent='Capability copied. Save it privately; it cannot be recovered.';}catch{status.textContent='Copy failed. Generate or paste a capability, then copy it using your browser.';}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Submitting private proposal…';
  try{
   const saved=await request();if(!saved){button.textContent='Submit saved request · free';return;}
   const response=await fetch(saved.path,{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':saved.capability},body:JSON.stringify(saved.body),signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Proposal was not saved.');showResult(form,result);status.textContent='Private proposal saved. Status: '+result.state+'. No fee charged. Keep the submission ID and capability.';
  }catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
}
for(const form of document.querySelectorAll('.submission-status-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Reading private status…';
  try{const values=new FormData(form),response=await fetch((form.dataset.statusPath??'/v1/tool-submissions/')+encodeURIComponent(values.get('submission_id').trim()),{headers:{'X-Creator-Capability':values.get('capability').trim()},cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Status unavailable.');showResult(form,data);status.textContent='Private status: '+data.state+'.';}catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
}

for(const form of document.querySelectorAll('.tool-update-form')){
 const load=form.querySelector('[data-load-approved]'),fields=form.querySelector('[data-update-fields]'),button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');load.hidden=false;
 let context=null;
 const request=creatorRetry(form,'creator_update',async()=>{
  const values=new FormData(form),capability=values.get('capability').trim(),tool=values.get('tool_id').trim();
  if(tool!==context.tool||capability!==context.capability)throw new Error('Read the approved version again or restore your exact retry request with this tool and capability.');
  return {path:'/v1/creator-tools/'+encodeURIComponent(tool)+'/updates',capability,body:{terms_version:context.terms_version,creator_secret_hash:await commitment(capability),base_version:values.get('base_version'),expected_head_revision:Number(values.get('expected_head_revision')),proposed_version:values.get('proposed_version').trim(),proposal:{name:values.get('name').trim(),summary:values.get('summary').trim(),endpoint_url:values.get('endpoint_url').trim(),input_schema:JSON.parse(values.get('input_schema')),output_schema:JSON.parse(values.get('output_schema'))}}};
 },(value,capability)=>{
  const tool=value.path.split('/')[3];context={tool,capability,terms_version:value.body.terms_version};form.elements.tool_id.value=tool;
  restoreProposal(form,value.body);for(const name of ['base_version','expected_head_revision','proposed_version'])form.elements[name].value=value.body[name];fields.hidden=false;button.textContent='Submit saved update';
 });
 for(const name of ['tool_id','capability'])form.elements[name].addEventListener('input',()=>{context=null;fields.hidden=true;});
 load.addEventListener('click',async()=>{
  if(load.disabled||!form.elements.tool_id.reportValidity()||!form.elements.capability.reportValidity())return;
  load.disabled=true;status.textContent='Reading approved metadata…';fields.hidden=true;context=null;
  try{
   const tool=form.elements.tool_id.value.trim(),capability=form.elements.capability.value.trim(),response=await fetch('/v1/creator-tools/'+encodeURIComponent(tool),{headers:{'X-Creator-Capability':capability},cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();
   if(!response.ok)throw new Error(data.error?.message??'Approved tool unavailable.');
   context={tool,capability,terms_version:data.terms.terms_version};form.elements.base_version.value=data.current_version;form.elements.expected_head_revision.value=data.head_revision;
   for(const name of ['name','summary','endpoint_url'])form.elements[name].value=data.proposal[name];
   for(const name of ['input_schema','output_schema'])form.elements[name].value=JSON.stringify(data.proposal[name],null,2);
   form.elements.proposed_version.value='';form.elements.consent.checked=false;fields.hidden=false;showResult(form,data);status.textContent='Approved metadata loaded. Propose a higher version for review.';
  }catch(error){status.textContent=workflowError(error);}finally{load.disabled=false;}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!context||!form.reportValidity())return;button.disabled=true;status.textContent='Submitting private update…';
  try{
   const saved=await request();if(!saved){button.textContent='Submit saved update';return;}
   const response=await fetch(saved.path,{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':saved.capability},body:JSON.stringify(saved.body),signal:AbortSignal.timeout(15000)}),result=await response.json();
   if(!response.ok)throw new Error(result.error?.message??'Update was not saved.');showResult(form,result);status.textContent='Private update saved. Status: '+result.state+'. '+(result.state==='approved'?'Approved metadata updated; installed execution is reviewed separately.':'Your approved version is retained.')+' Keep the update ID and original capability.';
  }catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
}
