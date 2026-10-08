import {retryFingerprint,validateRetryEnvelope,retryBodyFingerprint} from './retry-envelope.js';
const setBusy=(form,button,busy)=>{button.disabled=busy;button.setAttribute('aria-busy',String(busy));form.setAttribute('aria-busy',String(busy));};
const hideResult=form=>{const result=form.querySelector('.workflow-result');if(result){result.hidden=true;result.textContent='';}};
const proposalSchema=(form,name)=>{
 const field=form.elements[name],label=name==='input_schema'?'Input JSON Schema':'Output JSON Schema';let value;
 try{value=JSON.parse(field.value);}catch{field.focus();throw new Error(label+' must be valid JSON. Correct this field before preparing a request.');}
 if(value===null||typeof value!=='object'||Array.isArray(value)){field.focus();throw new Error(label+' must be a JSON object.');}
 if(new TextEncoder().encode(JSON.stringify(value)).length>4000){field.focus();throw new Error(label+' must be at most 4000 UTF-8 bytes.');}
 return value;
};
const creatorNextStep=data=>data.state==='approved'?'Metadata is approved; publication and execution require separate implementation review.':data.state==='rejected'?'Review the rejection reason below before preparing another proposal.':'Await metadata review. Approval alone does not publish or execute a tool.';
const creatorRecord=(data,key)=>data&&['pending','approved','rejected'].includes(data.state)&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data[key]??'');
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
  setBusy(feedbackForm,button,true);status.textContent='Sending…';
  try{
   const response=await fetch('/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:serialized,signal:AbortSignal.timeout(10000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Feedback was not saved.');
   status.textContent='Saved. '+(data.evidence.link==='server_record_linked'?'Linked to the server execution record.':'Submitted without a verified execution link.');
  }catch(error){status.textContent=error.name==='TimeoutError'?'Response timed out. Retry the same feedback safely.':error.message;}
  finally{setBusy(feedbackForm,button,false);}
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
  if(Boolean(operation)!==Boolean(secret)){status.textContent='To link a purchase, enter both its operation ID and review secret, or clear both to continue without purchase proof.';form.elements[operation?'review_secret':'operation_id'].focus();return;}
  if(operation||secret)body.purchase_proof={operation_id:operation,secret};
  // Keep retry identity in memory only. Never persist capabilities in web storage.
  const serialized=JSON.stringify(body);if(serialized!==lastBody){key=crypto.randomUUID();lastBody=serialized;}
  setBusy(form,button,true);status.textContent='Publishing…';
  try{
   const response=await fetch(form.dataset.endpoint,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:serialized,signal:AbortSignal.timeout(10000)});
   const data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Not saved.');
   form.elements.operation_id.value='';form.elements.review_secret.value='';lastBody=null;key=null;
   status.textContent=data.publicly_listed?'Published. ':'Saved, excluded from public lists. ';
   const link=document.createElement('a');link.href='/reviews/'+data.review_id;link.textContent='Read thread ↗';status.append(link);
  }catch(error){status.textContent=error.name==='TimeoutError'?'Response timed out. Retry unchanged to avoid a duplicate.':error.message;}
  finally{setBusy(form,button,false);}
 });
}
for(const button of document.querySelectorAll('[data-reply-to]')){button.hidden=false;button.addEventListener('click',()=>{
 const details=document.getElementById('write-reply'),form=details.querySelector('form');details.open=true;
 form.elements.parent_reply_id.value=button.dataset.replyTo;form.querySelector('.reply-target').textContent='Replying to '+(button.dataset.replyName?button.dataset.replyName+' ('+button.dataset.replyTo+')':button.dataset.replyTo);
 const clear=form.querySelector('[data-clear-reply]');if(clear)clear.hidden=false;
 form.elements.message.focus();
});}
for(const clear of document.querySelectorAll('[data-clear-reply]'))clear.addEventListener('click',()=>{
 const form=clear.closest('form');form.elements.parent_reply_id.value='';form.querySelector('.reply-target').textContent='Replying to the review';clear.hidden=true;form.elements.message.focus();
});
const newCapability=prefix=>prefix+btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
const commitment=async secret=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret))),v=>v.toString(16).padStart(2,'0')).join('');
const showResult=(form,data)=>{const result=form.querySelector('.workflow-result');result.textContent=JSON.stringify(data,null,2);result.hidden=false;};
const workflowError=error=>error.name==='TimeoutError'?'Response timed out. Keep the same input, capability and request ID for a safe retry.':error.message;
function creatorRetry(form,kind,build,restore){
 const area=form.querySelector('[data-request-envelope]'),details=area.closest('details'),status=form.querySelector('[role="status"]');let envelope=null,uncertain=false,priorUncertainty=false;
 const display=()=>{area.value=JSON.stringify(envelope,null,2);details.open=true;};
 for(const selector of ['[data-copy-request]','[data-restore-request]'])form.querySelector(selector).hidden=false;
 form.querySelector('[data-copy-request]').addEventListener('click',async()=>{try{if(!envelope)throw new Error();display();await navigator.clipboard.writeText(JSON.stringify(envelope,null,2));status.textContent='Private retry request copied. Save it with your capability stored separately.';}catch{status.textContent='Prepare a request first, then select and copy its JSON if the clipboard is unavailable.';}});
 form.querySelector('[data-restore-request]').addEventListener('click',async()=>{try{
  if(area.value.length>20000)throw new Error('Retry request is too large.');
  const value=validateRetryEnvelope(JSON.parse(area.value),kind),capability=form.elements.capability.value.trim();
  if(!/^atbc_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/.test(capability)||await commitment(capability)!==value.body.creator_secret_hash)throw new Error('Paste the original private capability separately before restoring this request.');
  if(uncertain&&envelope&&retryFingerprint(value)!==retryFingerprint(envelope)){display();throw new Error('The previous request may already be saved. Restore or retry that original request unchanged before replacing it.');}
  restore(value,capability);envelope=value;uncertain=true;hideResult(form);display();status.textContent='Exact request restored. Review the proposal and accept its terms before retrying. Nothing was sent by this restore; the original request may already be saved.';
 }catch(error){status.textContent=error.message;}});
 const request=async()=>{
  if(envelope){let visible;try{visible=JSON.parse(area.value);}catch{}if(retryFingerprint(visible)!==retryFingerprint(envelope))throw new Error('The retry JSON was edited. Restore an unchanged saved request before sending, or copy the retained request to recover its exact JSON. Nothing was sent.');}
  const {path,body,capability}=await build(),fingerprint=retryFingerprint({path,body});
  if(!envelope||retryBodyFingerprint(envelope)!==fingerprint){
   if(uncertain){display();throw new Error('The previous request may already be saved. Restore the original retry JSON and capability, then retry unchanged. No new request was prepared or sent.');}
   envelope=validateRetryEnvelope({api_version:'1',kind,path,body:{...body,request_id:crypto.randomUUID()}},kind);display();
   status.textContent='Request prepared; nothing sent. Copy and save the retry JSON, then click submit again. Keep your capability separately.';return null;
  }
  display();return {path:envelope.path,body:envelope.body,capability};
 };
 request.sending=()=>{priorUncertainty=uncertain;uncertain=true;};
 // A retry rejection cannot establish whether an earlier ambiguous send saved
 // this request. Only its validated success resolves pre-existing uncertainty.
 request.responded=status=>{if(status>=200&&status<300||!priorUncertainty&&[400,401,403,404,409,413,415,422,429].includes(status))uncertain=false;};
 return request;
}
const restoreProposal=(form,body)=>{for(const name of ['name','summary','endpoint_url'])form.elements[name].value=body.proposal[name];for(const name of ['input_schema','output_schema'])form.elements[name].value=JSON.stringify(body.proposal[name],null,2);form.elements.consent.checked=false;};
for(const form of document.querySelectorAll('.preview-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]'),copy=form.querySelector('[data-copy-preparation]'),restart=form.querySelector('[data-new-preparation]');button.hidden=false;
 let previousInput=null,context=null,body=null,successfulContext=null,successfulInput=null,latestSucceeded=false,fallback=null,terminal=false;
 const currentInput=()=>{try{return JSON.stringify(JSON.parse(form.elements.input.value));}catch{return null;}};
 const retainedContext=()=>successfulContext?.prepared_id&&successfulContext.expires_at&&successfulInput===currentInput()&&successfulContext.capability===context?.capability;
 const clearFallback=()=>{if(fallback){fallback.label.hidden=true;fallback.area.value='';}};
 const clearPreview=()=>{hideResult(form);copy.hidden=true;clearFallback();};
 restart.addEventListener('click',()=>{
  if(button.disabled||!terminal)return;
  previousInput=null;context=null;body=null;successfulContext=null;successfulInput=null;terminal=false;restart.hidden=true;clearPreview();
  status.textContent='New preparation selected; nothing sent. Run the free preview again for this input. Keep any saved earlier context with its original purchase request.';
 });
 form.elements.input.addEventListener('input',()=>{clearPreview();restart.hidden=!(terminal&&currentInput()===previousInput);status.textContent='Input changed. Run the preview again for this input.';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;clearPreview();latestSucceeded=false;setBusy(form,button,true);status.textContent='Preparing limited preview…';
  try{
   const input=JSON.parse(form.elements.input.value),serialized=JSON.stringify(input);
   if(serialized!==previousInput){const capability=newCapability('atbp_');context={product_id:form.dataset.product,version:form.dataset.version,capability};successfulContext=null;successfulInput=null;terminal=false;restart.hidden=true;body={version:form.dataset.version,input,request_id:crypto.randomUUID(),prepare_secret_hash:await commitment(capability)};previousInput=serialized;copy.hidden=true;}
   const response=await fetch('/v1/products/'+form.dataset.product+'/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Preparation-Capability':context.capability},body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});
   const data=await response.json();if(!response.ok){
    // Pending/unknown responses never authorize replacing the retained request.
    if(response.status===410&&data.error?.code==='preparation_expired'||response.status===422&&data.error?.code==='preparation_failed'){terminal=true;restart.hidden=currentInput()!==serialized;}
    throw new Error((data.error?.message??'Preview unavailable.')+(terminal?' Select “Start a new preparation” to preview the same input again.':''));
   }
   if(currentInput()!==serialized){status.textContent='Input changed while the preview was running. Run it again for this input.';return;}
   terminal=false;restart.hidden=true;context.prepared_id=data.prepared_id;context.expires_at=data.expires_at;successfulContext={...context};successfulInput=serialized;latestSucceeded=true;showResult(form,data);copy.hidden=!retainedContext();copy.textContent='Copy private preparation context';status.textContent='Limited preview ready. No payment requested. Save the private context, then follow the buyer preview guide for the full result. ';
   const link=document.createElement('a');link.href='/buy#optional-real-input-previews';link.textContent='Buyer preview guide ↗';status.append(link);
  }catch(error){clearPreview();const retained=retainedContext();copy.hidden=!retained;if(retained)copy.textContent='Copy earlier preparation context';status.textContent=workflowError(error)+(retained?' Earlier successful preparation context retained; latest attempt failed. Inspect its expiry before quoting.':'');}finally{setBusy(form,button,false);}
 });
 copy.addEventListener('click',async()=>{
  if(copy.hidden||!retainedContext()){clearFallback();copy.hidden=true;status.textContent='Private context is unavailable for the current input. Run its preview or use the HTTP preparation workflow.';return;}
  const savedContext=successfulContext,text=JSON.stringify(savedContext,null,2),earlier=latestSucceeded?'':' Earlier successful context retained; latest attempt failed. Inspect its expiry before quoting.',stillCurrent=()=>!copy.hidden&&retainedContext()&&successfulContext===savedContext;
  try{await navigator.clipboard.writeText(text);clearFallback();status.textContent=stillCurrent()?'Private context copied. Keep its capability secret.'+earlier:'Input changed while copying. Keep the earlier context private; run the preview again for the current input before quoting.';}
  catch{
   if(!stillCurrent()){clearFallback();copy.hidden=true;status.textContent='Input changed while copying. Run the preview again for the current input.';return;}
   if(!fallback){const label=document.createElement('label'),area=document.createElement('textarea');label.textContent='Private preparation context — keep its capability secret';area.readOnly=true;area.rows=6;area.autocomplete='off';area.spellcheck=false;label.append(area);form.append(label);fallback={label,area};}
   fallback.label.hidden=false;fallback.area.value=text;fallback.area.focus();fallback.area.select();status.textContent='Clipboard unavailable. Select and copy the read-only private context below; keep its capability secret.'+earlier;
  }
 });
}
for(const form of document.querySelectorAll('.submission-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 const request=creatorRetry(form,'creator_submission',async()=>{
  const values=new FormData(form),capability=values.get('capability').trim();
  return {path:'/v1/tool-submissions',capability,body:{terms_version:form.dataset.terms,creator_secret_hash:await commitment(capability),proposal:{name:values.get('name').trim(),summary:values.get('summary').trim(),endpoint_url:values.get('endpoint_url').trim(),input_schema:proposalSchema(form,'input_schema'),output_schema:proposalSchema(form,'output_schema')}}};
 },value=>{restoreProposal(form,value.body);button.textContent='Submit saved request · free';});
 for(const selector of ['[data-generate-creator]','[data-copy-creator]'])form.querySelector(selector).hidden=false;
 form.addEventListener('input',()=>hideResult(form));
 form.querySelector('[data-generate-creator]').addEventListener('click',()=>{if(form.elements.capability.value){status.textContent='Keep the existing capability for retries. Clear it deliberately only to use a different creator capability.';return;}form.elements.capability.value=newCapability('atbc_');status.textContent='Capability generated in this tab only. Copy and save it privately before submitting.';});
 form.querySelector('[data-copy-creator]').addEventListener('click',async()=>{try{if(!form.elements.capability.value)throw new Error();await navigator.clipboard.writeText(form.elements.capability.value);status.textContent='Capability copied. Save it privately; it cannot be recovered.';}catch{status.textContent='Copy failed. Generate or paste a capability, then copy it using your browser.';}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;hideResult(form);setBusy(form,button,true);status.textContent='Preparing or sending private proposal…';
  try{
   const saved=await request();if(!saved){button.textContent='Submit saved request · free';return;}
   request.sending();
   const response=await fetch(saved.path,{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':saved.capability},body:JSON.stringify(saved.body),signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(response.ok&&!creatorRecord(result,'submission_id'))throw new Error('The response did not confirm a saved proposal. Keep the original retry JSON and capability, then retry unchanged.');request.responded(response.status);if(!response.ok)throw new Error(result.error?.message??'Proposal was not saved.');showResult(form,result);status.textContent='Private proposal saved. Status: '+result.state+'. No fee charged. Keep the submission ID and capability. '+creatorNextStep(result);
  }catch(error){status.textContent=workflowError(error);}finally{setBusy(form,button,false);}
 });
}
for(const form of document.querySelectorAll('.submission-status-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 form.addEventListener('input',()=>{hideResult(form);status.textContent='Details changed. Read private status again.';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;hideResult(form);setBusy(form,button,true);status.textContent='Reading private status…';
  try{const values=new FormData(form),id=values.get('submission_id').trim(),capability=values.get('capability').trim(),response=await fetch((form.dataset.statusPath??'/v1/tool-submissions/')+encodeURIComponent(id),{headers:{'X-Creator-Capability':capability},cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Status unavailable.');if(form.elements.submission_id.value.trim()!==id||form.elements.capability.value.trim()!==capability){status.textContent='Details changed while reading. Read private status again.';return;}showResult(form,data);status.textContent='Private status: '+data.state+'. '+creatorNextStep(data);}catch(error){status.textContent=workflowError(error);}finally{setBusy(form,button,false);}
 });
}

for(const form of document.querySelectorAll('.tool-update-form')){
 const load=form.querySelector('[data-load-approved]'),fields=form.querySelector('[data-update-fields]'),button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');load.hidden=false;
 let context=null;
 const request=creatorRetry(form,'creator_update',async()=>{
  const values=new FormData(form),capability=values.get('capability').trim(),tool=values.get('tool_id').trim();
  if(!context||tool!==context.tool||capability!==context.capability)throw new Error('Read the approved version again or restore your exact retry request with this tool and capability.');
  return {path:'/v1/creator-tools/'+encodeURIComponent(tool)+'/updates',capability,body:{terms_version:context.terms_version,creator_secret_hash:await commitment(capability),base_version:values.get('base_version'),expected_head_revision:Number(values.get('expected_head_revision')),proposed_version:values.get('proposed_version').trim(),proposal:{name:values.get('name').trim(),summary:values.get('summary').trim(),endpoint_url:values.get('endpoint_url').trim(),input_schema:proposalSchema(form,'input_schema'),output_schema:proposalSchema(form,'output_schema')}}};
 },(value,capability)=>{
  const tool=value.path.split('/')[3];context={tool,capability,terms_version:value.body.terms_version};form.elements.tool_id.value=tool;
  restoreProposal(form,value.body);for(const name of ['base_version','expected_head_revision','proposed_version'])form.elements[name].value=value.body[name];fields.hidden=false;button.textContent='Submit saved update';
 });
 form.addEventListener('input',()=>hideResult(form));
 for(const name of ['tool_id','capability'])form.elements[name].addEventListener('input',()=>{context=null;fields.hidden=true;hideResult(form);status.textContent='Tool details changed. Read the approved version again or restore its exact retry request.';});
 load.addEventListener('click',async()=>{
  if(load.disabled||button.disabled||!form.elements.tool_id.reportValidity()||!form.elements.capability.reportValidity())return;
  setBusy(form,load,true);hideResult(form);status.textContent='Reading approved metadata…';fields.hidden=true;context=null;
  try{
   const tool=form.elements.tool_id.value.trim(),capability=form.elements.capability.value.trim(),response=await fetch('/v1/creator-tools/'+encodeURIComponent(tool),{headers:{'X-Creator-Capability':capability},cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();
   if(!response.ok)throw new Error(data.error?.message??'Approved tool unavailable.');
   if(form.elements.tool_id.value.trim()!==tool||form.elements.capability.value.trim()!==capability){status.textContent='Tool details changed while reading. Read the approved version again.';return;}
   context={tool,capability,terms_version:data.terms.terms_version};form.elements.base_version.value=data.current_version;form.elements.expected_head_revision.value=data.head_revision;
   for(const name of ['name','summary','endpoint_url'])form.elements[name].value=data.proposal[name];
   for(const name of ['input_schema','output_schema'])form.elements[name].value=JSON.stringify(data.proposal[name],null,2);
   form.elements.proposed_version.value='';form.elements.consent.checked=false;fields.hidden=false;showResult(form,data);status.textContent='Approved metadata loaded. Propose a higher version for review.';
  }catch(error){status.textContent=workflowError(error);}finally{setBusy(form,load,false);}
 });
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||load.disabled||!context||!form.reportValidity())return;hideResult(form);setBusy(form,button,true);status.textContent='Preparing or sending private update…';
  try{
   const saved=await request();if(!saved){button.textContent='Submit saved update';return;}
   request.sending();
   const response=await fetch(saved.path,{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':saved.capability},body:JSON.stringify(saved.body),signal:AbortSignal.timeout(15000)}),result=await response.json();
   if(response.ok&&!creatorRecord(result,'update_id'))throw new Error('The response did not confirm a saved update. Keep the original retry JSON and capability, then retry unchanged.');request.responded(response.status);if(!response.ok)throw new Error(result.error?.message??'Update was not saved.');showResult(form,result);status.textContent='Private update saved. Status: '+result.state+'. '+(result.state==='approved'?'Approved metadata updated; installed execution is reviewed separately.':'Your approved version is retained.')+' Keep the update ID and original capability. '+creatorNextStep(result);
  }catch(error){status.textContent=workflowError(error);}finally{setBusy(form,button,false);}
 });
}
