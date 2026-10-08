// A shared input stays locked until every section using it has finished.
const locks=new WeakMap();
export function holdBusyControls(controls){
 const held=[...new Set(controls)];
 for(const control of held){
  let lock=locks.get(control);
  if(!lock){lock={count:0,disabled:control.disabled};locks.set(control,lock);}
  lock.count++;control.disabled=true;control.setAttribute?.('aria-busy','true');
 }
 let released=false;
 return ()=>{
  if(released)return;released=true;
  for(const control of held){
   const lock=locks.get(control);
   if(--lock.count===0){control.disabled=lock.disabled;control.setAttribute?.('aria-busy','false');locks.delete(control);}
  }
 };
}
