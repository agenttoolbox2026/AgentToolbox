for(const button of document.querySelectorAll('[data-copy]'))button.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(document.getElementById(button.dataset.copy).textContent);button.textContent='Copied';setTimeout(()=>{button.textContent='Copy JSON';},1800);}catch{button.textContent='Select text to copy';}
});
const counter=document.getElementById('paid-counter'),status=document.getElementById('counter-status');
if(counter){
 let running=false;
 const update=async()=>{if(document.hidden||running)return;running=true;
  try{const response=await fetch('/v1/stats',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();const data=await response.json();if(!Number.isSafeInteger(data.lifetime_paid_purchases)||data.lifetime_paid_purchases<0)throw new Error();counter.textContent=data.lifetime_paid_purchases.toLocaleString('en-US');status.textContent='LIVE';status.classList.remove('stale');}
  catch{status.textContent=counter.textContent==='—'?'UNAVAILABLE':'LAST VERIFIED';status.classList.add('stale');}finally{running=false;}
 };
 setInterval(update,30000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
}
