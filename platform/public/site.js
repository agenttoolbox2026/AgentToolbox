for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);button.textContent='Copied';setTimeout(()=>{button.textContent='Copy JSON';},1800);}catch{button.textContent='Select text to copy';}
});
const counter=document.getElementById('paid-counter'),status=document.getElementById('counter-status');
const feedbackForm=document.getElementById('feedback-form');
if(feedbackForm){
 const button=document.getElementById('feedback-submit'),status=document.getElementById('feedback-status');button.hidden=false;
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
