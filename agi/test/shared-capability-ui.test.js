import test from 'node:test';
import assert from 'node:assert/strict';
import {bindCreatorWallet} from '../public/creator-wallet.js';
import {bindWalletProof} from '../public/wallet-proof.js';

class Element{
 constructor(){this.value='';this.disabled=false;this.hidden=false;this.checked=false;this.attributes={};this.events=new Map();}
 setAttribute(name,value){this.attributes[name]=value;}
 addEventListener(name,fn){this.events.set(name,[...(this.events.get(name)??[]),fn]);}
 async emit(name){for(const fn of this.events.get(name)??[])await fn({preventDefault(){}});}
}
const section=(names,prefix)=>{
 const elements=new Map(names.map(name=>['['+prefix+name+']',new Element()]));elements.set('[role="status"]',new Element());
 const root=new Element();root.querySelector=selector=>elements.get(selector);root.querySelectorAll=()=>[...elements.values()];
 return {root,elements,get:name=>elements.get('['+prefix+name+']')};
};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

test('overlapping wallet and proof reads keep their shared capability busy until both complete in either order',async()=>{
 for(const order of [[0,1],[1,0]])for(const failFirst of [false,true]){
  const reads=[deferred(),deferred()],capability=new Element();capability.value='atbc_'+Buffer.alloc(32,7).toString('base64url');
  const wallet=section(['capability','wallet-address','wallet-current','current-revision','wallet-prepared','wallet-envelope','wallet-saved','wallet-result','wallet-import','new-wallet','read-status','prepare-wallet','restore-wallet','copy-wallet','export-wallet','wallet-file'],'data-');wallet.elements.set('[data-capability]',capability);
  const proof=section(['envelope','prepared','new','verify','signing','message','binding','saved','result','read','current','prepare','challenge','prepare-verify','signature','restore','import','copy','export','file','expired-recovery','retire'],'data-proof-');
  const snapshot=()=>({phase:'empty',envelope:null,revision:null});
  bindCreatorWallet(wallet.root,{client:{snapshot,read:()=>reads[0].promise,clearRead(){}}});
  bindWalletProof(proof.root,{capabilityInput:capability,client:{snapshot,read:()=>reads[1].promise,clearRead(){}}});
  const pending=[wallet.get('read-status').emit('click'),proof.get('read').emit('click')];
  assert.equal(capability.disabled,true);assert.equal(capability.attributes['aria-busy'],'true');
  if(failFirst)reads[order[0]].reject(Error('Local read failure'));else reads[order[0]].resolve(null);
  await pending[order[0]];
  assert.equal(capability.disabled,true,'other section still owns the shared lock');assert.equal(capability.attributes['aria-busy'],'true');
  reads[order[1]].resolve(null);await pending[order[1]];
  assert.equal(capability.disabled,false);assert.equal(capability.attributes['aria-busy'],'false');
  assert.equal(wallet.get('read-status').disabled,false);assert.equal(proof.get('read').disabled,false);
 }
});
