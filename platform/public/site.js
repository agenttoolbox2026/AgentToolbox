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
 let requestId=null,previousBody=null;
 form.querySelector('[data-generate-creator]').addEventListener('click',()=>{if(form.elements.capability.value){status.textContent='Keep the existing capability for retries. Clear it deliberately only to use a different creator capability.';return;}form.elements.capability.value=newCapability('atbc_');status.textContent='Capability generated in this tab only. Copy and save it privately before submitting.';});
 form.querySelector('[data-copy-creator]').addEventListener('click',async()=>{try{if(!form.elements.capability.value)throw new Error();await navigator.clipboard.writeText(form.elements.capability.value);status.textContent='Capability copied. Save it privately; it cannot be recovered.';}catch{status.textContent='Copy failed. Generate or paste a capability, then copy it using your browser.';}});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Submitting private proposal…';
  try{
   const values=new FormData(form),capability=values.get('capability').trim();
   const data={terms_version:form.dataset.terms,creator_secret_hash:await commitment(capability),proposal:{name:values.get('name').trim(),summary:values.get('summary').trim(),endpoint_url:values.get('endpoint_url').trim(),input_schema:JSON.parse(values.get('input_schema')),output_schema:JSON.parse(values.get('output_schema'))}};
   const serialized=JSON.stringify(data);if(serialized!==previousBody){requestId=crypto.randomUUID();previousBody=serialized;}
   const response=await fetch('/v1/tool-submissions',{method:'POST',headers:{'Content-Type':'application/json','X-Creator-Capability':capability},body:JSON.stringify({...data,request_id:requestId}),signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(!response.ok)throw new Error(result.error?.message??'Proposal was not saved.');showResult(form,result);status.textContent='Private proposal saved for owner review. No fee charged. Keep the submission ID and capability.';
  }catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
}
for(const form of document.querySelectorAll('.submission-status-form')){
 const button=form.querySelector('[type="submit"]'),status=form.querySelector('[role="status"]');button.hidden=false;
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;status.textContent='Reading private status…';
  try{const values=new FormData(form),response=await fetch('/v1/tool-submissions/'+encodeURIComponent(values.get('submission_id').trim()),{headers:{'X-Creator-Capability':values.get('capability').trim()},cache:'no-store',signal:AbortSignal.timeout(10000)}),data=await response.json();if(!response.ok)throw new Error(data.error?.message??'Status unavailable.');showResult(form,data);status.textContent='Private status: '+data.state+'.';}catch(error){status.textContent=workflowError(error);}finally{button.disabled=false;}
 });
}
