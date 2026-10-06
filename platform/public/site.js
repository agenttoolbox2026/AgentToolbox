document.querySelectorAll('[data-copy]').forEach(button=>{
  button.addEventListener('click',async()=>{
    const value=document.getElementById(button.dataset.copy)?.textContent;
    if(!value)return;
    try{await navigator.clipboard.writeText(value);button.textContent='Copied';button.setAttribute('aria-live','polite');}
    catch{button.textContent='Select the text to copy';}
  });
});
