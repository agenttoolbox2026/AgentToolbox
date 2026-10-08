import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {webcrypto} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {retryFingerprint,validateRetryEnvelope,retryBodyFingerprint} from '../public/retry-envelope.js';

const script=readFileSync(new URL('../public/site.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
const capability='atbc_'+Buffer.alloc(32,21).toString('base64url');
const tool='creator-00000000-0000-4000-8000-000000000001';
const savedSubmission={submission_id:'00000000-0000-4000-8000-000000000002',state:'pending'};
const savedUpdate={update_id:'00000000-0000-4000-8000-000000000003',state:'pending'};
class Element{
 constructor(value=''){this.value=value;this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.dataset={};this.attributes={};this.handlers=new Map();this.children=[];}
 addEventListener(name,fn){this.handlers.set(name,[...(this.handlers.get(name)??[]),fn]);}
 async emit(name){for(const fn of this.handlers.get(name)??[])await fn({preventDefault(){}});}
 setAttribute(name,value){this.attributes[name]=value;}
 focus(){this.focused=true;}
 select(){this.selected=true;}
 reportValidity(){return true;}
 append(node){this.children.push(node);}
 closest(){return this.parent;}
}
function form(kind,values={}){
 const f=new Element();f.elements=Object.fromEntries(Object.entries(values).map(([k,v])=>[k,new Element(v)]));f.dataset={};
 const button=new Element(),status=new Element(),result=new Element();button.hidden=true;result.hidden=true;
 const nodes={'[type="submit"]':button,'button[type="submit"]':button,'[role="status"]':status,'.workflow-result':result};
 if(kind==='preview'){for(const name of ['copy-preparation','new-preparation']){nodes['[data-'+name+']']=new Element();nodes['[data-'+name+']'].hidden=true;}f.dataset={product:'contract-cases',version:'0.1.0'};}
 if(kind==='submission'||kind==='update'){
  f.dataset.terms='creator-promo-2026-10-07.v1';const area=new Element(),details=new Element();area.parent=details;nodes['[data-request-envelope]']=area;
  for(const name of ['copy-request','restore-request','generate-creator','copy-creator','load-approved','update-fields']){nodes['[data-'+name+']']=new Element();nodes['[data-'+name+']'].hidden=true;}
 }
 f.querySelector=selector=>nodes[selector]??null;return {form:f,button,status,result,nodes};
}
const proposal=()=>({name:'LOCAL fixture',summary:'Synthetic metadata',endpoint_url:'https://tool.example/api',input_schema:'{"type":"object"}',output_schema:'{"type":"object"}',capability,consent:'on'});
const seller=()=>form('submission',proposal());
const update=()=>form('update',{...proposal(),tool_id:tool,base_version:'',expected_head_revision:'',proposed_version:''});
const preview=()=>form('preview',{input:'{"n":1}'});
const review=()=>{const f=form('review',{display_name:'Synthetic reviewer',message:'Local fixture',product_id:'contract-cases',version:'0.1.0',rating:'',example_id:'',parent_reply_id:'',operation_id:'',review_secret:''});f.form.dataset.endpoint='/v1/reviews';return f;};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function setup(fixtures,responses=[],extras={}){
 const calls=[],copied=[],created=[];
 const groups=Object.fromEntries(fixtures.map(([selector,f])=>[selector,[f.form]]));
 const document={getElementById:()=>null,querySelectorAll:selector=>groups[selector]??[],createElement:tag=>{const element=new Element();element.tagName=tag;created.push(element);return element;},...extras.document};
 class FormData{constructor(f){this.values=Object.fromEntries(Object.entries(f.elements).map(([k,v])=>[k,v.value]));}get(name){return this.values[name]??null;}}
 const fetch=async(path,init)=>{calls.push({path,init});const item=responses.shift();if(item instanceof Error)throw item;return typeof item==='function'?item(path,init):item??json({});};
 runInNewContext(script,{document,FormData,crypto:webcrypto,TextEncoder,Uint8Array,AbortSignal,JSON,Error,fetch,navigator:extras.navigator??{clipboard:{writeText:async text=>copied.push(text)}},btoa:value=>Buffer.from(value,'binary').toString('base64'),setTimeout,retryFingerprint,validateRetryEnvelope,retryBodyFingerprint});
 return {calls,copied,created};
}
const envelope=f=>JSON.parse(f.nodes['[data-request-envelope]'].value);
const head=()=>({current_version:'0.1.0',head_revision:0,terms:{terms_version:'creator-promo-2026-10-07.v1'},proposal:{name:'Approved local fixture',summary:'Approved metadata',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}});

test('known terminal previews offer an explicit fresh preparation without changing unchanged retry identity first',async()=>{
 for(const [status,code] of [[410,'preparation_expired'],[422,'preparation_failed']]){
  const f=preview(),ready={prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'},s=setup([['.preview-form',f]],[json(ready),json({error:{code,message:'Terminal preview'}},status),json({error:{code:'preparation_unavailable',message:'Retained state'}},409),json({...ready,prepared_id:'new-local-preview'})]);
  await f.form.emit('submit');await f.form.emit('submit');
  assert.equal(f.nodes['[data-new-preparation]'].hidden,false);assert.equal(s.calls[0].init.body,s.calls[1].init.body);
  await f.form.emit('submit');assert.equal(s.calls[0].init.body,s.calls[2].init.body);
  await f.nodes['[data-new-preparation]'].emit('click');assert.equal(s.calls.length,3,'explicit reset does not send');
  await f.form.emit('submit');
  assert.notEqual(JSON.parse(s.calls[0].init.body).request_id,JSON.parse(s.calls[3].init.body).request_id);
  assert.notEqual(s.calls[0].init.headers['X-Preparation-Capability'],s.calls[3].init.headers['X-Preparation-Capability']);
  assert.equal(f.result.hidden,false);assert.equal(f.nodes['[data-new-preparation]'].hidden,true);
 }
});

test('uncertain previews and ambiguous unavailable or unrelated errors never offer a replacement request',async()=>{
 for(const response of [json({error:{code:'preparation_unavailable'}},409),json({error:{code:'other'}},410),json({error:{code:'other'}},422)]){
  const f=preview(),s=setup([['.preview-form',f]],[new DOMException('Local timeout','TimeoutError'),response,json({prepared_id:'replayed',expires_at:'2026-10-08T01:00:00Z'})]);
  await f.form.emit('submit');await f.form.emit('submit');assert.equal(f.nodes['[data-new-preparation]'].hidden,true);
  await f.nodes['[data-new-preparation]'].emit('click');await f.form.emit('submit');
  assert.equal(s.calls[0].init.body,s.calls[1].init.body);assert.equal(s.calls[0].init.body,s.calls[2].init.body);
  assert.equal(s.calls[0].init.headers['X-Preparation-Capability'],s.calls[2].init.headers['X-Preparation-Capability']);
 }
});

test('preview hides obsolete output and keeps earlier context recovery after an unchanged failed retry with exact identity',async()=>{
 const f=preview(),ready={prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'},s=setup([['.preview-form',f]],[json(ready),new DOMException('Local timeout','TimeoutError'),json(ready)]);
 await f.form.emit('submit');assert.equal(f.result.hidden,false);assert.equal(f.nodes['[data-copy-preparation]'].hidden,false);assert.match(f.status.textContent,/buyer preview guide/);
 await f.form.elements.input.emit('input');assert.equal(f.result.hidden,true);assert.equal(f.result.textContent,'');assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);
 await f.form.emit('submit');assert.equal(f.result.hidden,true);assert.equal(f.nodes['[data-copy-preparation]'].hidden,false);assert.match(f.status.textContent,/timed out/);assert.match(f.status.textContent,/Earlier successful preparation context retained; latest attempt failed/);
 await f.form.emit('submit');assert.equal(f.result.hidden,false);assert.equal(s.calls[0].init.body,s.calls[1].init.body);assert.equal(s.calls[1].init.body,s.calls[2].init.body);assert.equal(s.calls[0].init.headers['X-Preparation-Capability'],s.calls[2].init.headers['X-Preparation-Capability']);
 f.form.elements.input.value='{"n":2}';await f.form.elements.input.emit('input');await f.form.emit('submit');assert.notEqual(s.calls[0].init.body,s.calls[3].init.body);
});
test('success then unchanged timeout copies the original successful context without displaying stale output as a new success',async()=>{
 const f=preview(),s=setup([['.preview-form',f]],[json({prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'}),new DOMException('Local timeout','TimeoutError')]);await f.form.emit('submit');await f.nodes['[data-copy-preparation]'].emit('click');const original=s.copied[0];await f.form.emit('submit');assert.equal(f.result.hidden,true);assert.equal(f.result.textContent,'');assert.equal(f.nodes['[data-copy-preparation]'].textContent,'Copy earlier preparation context');assert.doesNotMatch(f.status.textContent,/Limited preview ready/);await f.nodes['[data-copy-preparation]'].emit('click');assert.equal(s.copied[1],original);assert.equal(s.calls[0].init.body,s.calls[1].init.body);assert.equal(s.calls[0].init.headers['X-Preparation-Capability'],s.calls[1].init.headers['X-Preparation-Capability']);assert.match(f.status.textContent,/latest attempt failed.*expiry/);
});
test('changed or malformed preview input hides and rejects copying an earlier private context',async()=>{
 for(const input of ['{"n":2}','{broken']){
  const f=preview(),s=setup([['.preview-form',f]],[json({prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'}),new DOMException('Local timeout','TimeoutError')]);await f.form.emit('submit');f.form.elements.input.value=input;await f.form.elements.input.emit('input');assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);await f.nodes['[data-copy-preparation]'].emit('click');assert.equal(s.copied.length,0);await f.form.emit('submit');assert.equal(f.result.hidden,true);assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);await f.nodes['[data-copy-preparation]'].emit('click');assert.equal(s.copied.length,0);assert.match(f.status.textContent,/unavailable for the current input/);
 }
});
test('clipboard failure exposes only a selectable read-only retained context and clears it on input edit',async()=>{
 const f=preview(),s=setup([['.preview-form',f]],[json({prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'}),new DOMException('Local timeout','TimeoutError')],{navigator:{clipboard:{writeText:async()=>{throw new Error('Local clipboard unavailable');}}}});await f.form.emit('submit');await f.form.emit('submit');await f.nodes['[data-copy-preparation]'].emit('click');const area=s.created.find(element=>element.tagName==='textarea'),label=s.created.find(element=>element.tagName==='label');assert(area);assert.equal(area.readOnly,true);assert.equal(area.selected,true);assert.equal(label.hidden,false);assert.match(label.textContent,/keep its capability secret/);const retained=JSON.parse(area.value);assert.equal(retained.prepared_id,'local-preview');assert.equal(retained.capability,s.calls[0].init.headers['X-Preparation-Capability']);assert.equal(f.result.hidden,true);assert.match(f.status.textContent,/Clipboard unavailable.*latest attempt failed.*expiry/);f.form.elements.input.value='{"n":2}';await f.form.elements.input.emit('input');assert.equal(label.hidden,true);assert.equal(area.value,'');assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);
});
test('a delayed clipboard failure cannot reveal earlier private context after input changed',async()=>{
 const f=preview(),entered=deferred(),clipboard=deferred(),s=setup([['.preview-form',f]],[json({prepared_id:'local-preview',expires_at:'2026-10-08T01:00:00Z'})],{navigator:{clipboard:{writeText:async()=>{entered.resolve();await clipboard.promise;throw new Error('Local clipboard unavailable');}}}});await f.form.emit('submit');const pending=f.nodes['[data-copy-preparation]'].emit('click');await entered.promise;f.form.elements.input.value='{"n":2}';await f.form.elements.input.emit('input');clipboard.resolve();await pending;assert.equal(s.created.filter(element=>element.tagName==='textarea').length,0);assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);assert.equal(f.result.hidden,true);assert.match(f.status.textContent,/Input changed while copying/);
});
test('preview rejects late results for edited input and exposes busy state only during the request',async()=>{
 const f=preview(),entered=deferred(),response=deferred();setup([['.preview-form',f]],[()=>{entered.resolve();return response.promise;}]);
 const pending=f.form.emit('submit');await entered.promise;assert.equal(f.button.disabled,true);assert.equal(f.button.attributes['aria-busy'],'true');assert.equal(f.form.attributes['aria-busy'],'true');
 f.form.elements.input.value='{"n":2}';await f.form.elements.input.emit('input');response.resolve(json({prepared_id:'old'}));await pending;
 assert.equal(f.result.hidden,true);assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);assert.match(f.status.textContent,/changed while/);assert.equal(f.button.disabled,false);assert.equal(f.button.attributes['aria-busy'],'false');
});
test('preview malformed input removes prior successful output without a new request',async()=>{
 const f=preview(),s=setup([['.preview-form',f]],[json({prepared_id:'local'})]);await f.form.emit('submit');f.form.elements.input.value='{broken';await f.form.emit('submit');assert.equal(s.calls.length,1);assert.equal(f.result.hidden,true);assert.equal(f.nodes['[data-copy-preparation]'].hidden,true);
});
test('submission first prepares without POST; an uncertain send cannot replace its envelope and unchanged retry is exact',async()=>{
 const f=seller(),s=setup([['.submission-form',f]],[new DOMException('Local timeout','TimeoutError'),json(savedSubmission)]);
 for(const name of ['copy-request','restore-request','generate-creator','copy-creator'])assert.equal(f.nodes['[data-'+name+']'].hidden,false);
 await f.form.emit('submit');const original=f.nodes['[data-request-envelope]'].value;assert.equal(s.calls.length,0);assert.match(f.status.textContent,/nothing sent/);
 await f.form.emit('submit');assert.equal(s.calls.length,1);f.form.elements.summary.value='Changed after uncertainty';await f.form.emit('submit');assert.equal(s.calls.length,1);assert.equal(f.nodes['[data-request-envelope]'].value,original);assert.match(f.status.textContent,/may already be saved/);
 f.form.elements.summary.value=proposal().summary;await f.form.emit('submit');assert.equal(s.calls.length,2);assert.equal(s.calls[0].init.body,s.calls[1].init.body);assert.equal(s.calls[0].init.headers['X-Creator-Capability'],s.calls[1].init.headers['X-Creator-Capability']);assert.match(f.status.textContent,/Await metadata review/);
});
test('restored requests are retried unchanged and cannot be swapped during uncertainty',async()=>{
 const f=seller(),s=setup([['.submission-form',f]]);await f.form.emit('submit');const original=envelope(f);await f.nodes['[data-restore-request]'].emit('click');
 const changed=structuredClone(original);changed.body.request_id=crypto.randomUUID();f.nodes['[data-request-envelope]'].value=JSON.stringify(changed);await f.nodes['[data-restore-request]'].emit('click');assert.deepEqual(envelope(f),original);assert.equal(s.calls.length,0);assert.match(f.status.textContent,/may already be saved/);
});
test('restoring a submission after reload labels its next action as send instead of prepare',async()=>{
 const source=seller();setup([['.submission-form',source]]);await source.form.emit('submit');const original=source.nodes['[data-request-envelope]'].value,reload=seller(),s=setup([['.submission-form',reload]]);reload.nodes['[data-request-envelope]'].value=original;await reload.nodes['[data-restore-request]'].emit('click');assert.equal(s.calls.length,0);assert.equal(reload.button.textContent,'Submit saved request · free');assert.equal(reload.form.elements.consent.checked,false);assert.equal(reload.nodes['[data-request-envelope]'].value,original);
});
test('edited retry JSON cannot silently send a different retained request; copying recovers the exact original',async()=>{
 const f=seller(),s=setup([['.submission-form',f]]);await f.form.emit('submit');const original=envelope(f),changed=structuredClone(original);changed.body.proposal.summary='Edited JSON only';f.nodes['[data-request-envelope]'].value=JSON.stringify(changed);await f.form.emit('submit');assert.equal(s.calls.length,0);assert.match(f.status.textContent,/retry JSON was edited/);await f.nodes['[data-copy-request]'].emit('click');assert.deepEqual(envelope(f),original);assert.deepEqual(JSON.parse(s.copied[0]),original);
});
test('deterministic schema rejection permits corrected preparation, while server uncertainty retains the request',async()=>{
 const f=seller(),s=setup([['.submission-form',f]],[json({error:{message:'Invalid endpoint'}},400),json({error:{message:'Unavailable'}},503)]);
 await f.form.emit('submit');const a=envelope(f);await f.form.emit('submit');f.form.elements.endpoint_url.value='https://new.example/api';await f.form.emit('submit');const b=envelope(f);assert.notEqual(a.body.request_id,b.body.request_id);await f.form.emit('submit');f.form.elements.summary.value='Changed after 503';await f.form.emit('submit');assert.deepEqual(envelope(f),b);assert.equal(s.calls.length,2);
});
test('timeout followed by 429, 403 or 409 cannot release the original submission or update request',async()=>{
 for(const rejection of [429,403,409])for(const kind of ['submission','update']){
  const f=kind==='submission'?seller():update(),selector=kind==='submission'?'.submission-form':'.tool-update-form',responses=[new DOMException('Local timeout','TimeoutError'),json({error:{message:'Retry rejected before replay'}},rejection)];if(kind==='update')responses.unshift(json(head()));const s=setup([[selector,f]],responses);
  if(kind==='update'){await f.nodes['[data-load-approved]'].emit('click');f.form.elements.proposed_version.value='0.2.0';}
  await f.form.emit('submit');const original=f.nodes['[data-request-envelope]'].value;await f.form.emit('submit');await f.form.emit('submit');const posts=s.calls.filter(call=>call.init.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].init.body,posts[1].init.body);assert.equal(posts[0].init.headers['X-Creator-Capability'],posts[1].init.headers['X-Creator-Capability']);
  f.form.elements.summary.value='Edited after rejected retry';await f.form.emit('submit');assert.equal(s.calls.filter(call=>call.init.method==='POST').length,2);assert.equal(f.nodes['[data-request-envelope]'].value,original);assert.match(f.status.textContent,/may already be saved/);
 }
});
test('restored submission or update followed by 429 retains its exact envelope and rejects edits',async()=>{
 for(const kind of ['submission','update']){
  const source=kind==='submission'?seller():update(),selector=kind==='submission'?'.submission-form':'.tool-update-form';setup([[selector,source]],kind==='update'?[json(head())]:[]);if(kind==='update'){await source.nodes['[data-load-approved]'].emit('click');source.form.elements.proposed_version.value='0.2.0';}await source.form.emit('submit');const original=source.nodes['[data-request-envelope]'].value;
  const reload=kind==='submission'?seller():update(),s=setup([[selector,reload]],[json({error:{message:'Rate limited before replay'}},429)]);reload.nodes['[data-request-envelope]'].value=original;await reload.nodes['[data-restore-request]'].emit('click');await reload.form.emit('submit');assert.equal(s.calls.length,1);assert.equal(s.calls[0].init.headers['X-Creator-Capability'],capability);assert.deepEqual(JSON.parse(s.calls[0].init.body),JSON.parse(original).body);
  reload.form.elements.summary.value='Edited after restored retry rejection';await reload.form.emit('submit');assert.equal(s.calls.length,1);assert.equal(reload.nodes['[data-request-envelope]'].value,original);assert.match(reload.status.textContent,/may already be saved/);
 }
});
test('only a validated successful replay resolves an earlier timeout and rejection before a new draft',async()=>{
 const f=seller(),s=setup([['.submission-form',f]],[new DOMException('Local timeout','TimeoutError'),json({error:{message:'Retry rate limited'}},429),json(savedSubmission)]);await f.form.emit('submit');const original=envelope(f);await f.form.emit('submit');await f.form.emit('submit');await f.form.emit('submit');assert.equal(s.calls.length,3);assert.equal(s.calls[0].init.body,s.calls[2].init.body);f.form.elements.summary.value='New draft after confirmed replay';await f.form.emit('submit');assert.equal(s.calls.length,3);assert.notEqual(envelope(f).body.request_id,original.body.request_id);assert.match(f.status.textContent,/nothing sent/);
});
test('an incomplete success response preserves the uncertain submission or update instead of announcing invented status',async()=>{
 for(const [kind,selector] of [['submission','.submission-form'],['update','.tool-update-form']]){
  const f=kind==='submission'?seller():update(),responses=kind==='submission'?[json({})]:[json(head()),json({})],s=setup([[selector,f]],responses);
  if(kind==='update'){await f.nodes['[data-load-approved]'].emit('click');f.form.elements.proposed_version.value='0.2.0';}
  await f.form.emit('submit');const original=envelope(f);await f.form.emit('submit');assert.match(f.status.textContent,/did not confirm a saved/);assert.equal(f.result.hidden,true);f.form.elements.summary.value='Edited after malformed success';await f.form.emit('submit');assert.deepEqual(envelope(f),original);assert.equal(s.calls.length,kind==='submission'?1:2);
 }
});
test('submission identifies malformed, non-object and oversized schema fields before preparing or sending',async()=>{
 for(const [name,value,pattern] of [['input_schema','{broken',/Input JSON Schema must be valid JSON/],['output_schema','[]',/Output JSON Schema must be a JSON object/],['input_schema',JSON.stringify({description:'x'.repeat(4000)}),/4000 UTF-8 bytes/]]){
  const f=seller(),s=setup([['.submission-form',f]]);f.form.elements[name].value=value;await f.form.emit('submit');assert.equal(s.calls.length,0);assert.equal(f.nodes['[data-request-envelope]'].value,'');assert.match(f.status.textContent,pattern);assert.equal(f.form.elements[name].focused,true);assert.equal(f.button.attributes['aria-busy'],'false');
 }
});
test('private status clears stale output on identity edit and failed read',async()=>{
 const f=form('status',{submission_id:'00000000-0000-4000-8000-000000000001',capability});setup([['.submission-status-form',f]],[json({state:'approved'}),json({error:{message:'No matching private capability.'}},403)]);
 await f.form.emit('submit');assert.equal(f.result.hidden,false);assert.match(f.status.textContent,/separate implementation review/);f.form.elements.submission_id.value='00000000-0000-4000-8000-000000000002';await f.form.emit('input');assert.equal(f.result.hidden,true);await f.form.emit('submit');assert.equal(f.result.textContent,'');assert.match(f.status.textContent,/No matching/);
});
test('private status ignores response for identity changed during the read',async()=>{
 const f=form('status',{submission_id:'local-id',capability}),entered=deferred(),response=deferred();setup([['.submission-status-form',f]],[()=>{entered.resolve();return response.promise;}]);const pending=f.form.emit('submit');await entered.promise;f.form.elements.submission_id.value='different-id';response.resolve(json({state:'approved'}));await pending;assert.equal(f.result.hidden,true);assert.match(f.status.textContent,/changed while reading/);
});
test('update read does not reveal stale approved metadata if its tool or capability changed mid-flight',async()=>{
 const f=update(),entered=deferred(),response=deferred();setup([['.tool-update-form',f]],[()=>{entered.resolve();return response.promise;}]);const pending=f.nodes['[data-load-approved]'].emit('click');await entered.promise;f.form.elements.tool_id.value='creator-00000000-0000-4000-8000-000000000002';await f.form.elements.tool_id.emit('input');response.resolve(json(head()));await pending;assert.equal(f.nodes['[data-update-fields]'].hidden,true);assert.equal(f.result.hidden,true);assert.match(f.status.textContent,/changed while reading/);
});
test('update loading, preparation and uncertain retries retain original metadata request bytes',async()=>{
 const f=update(),s=setup([['.tool-update-form',f]],[json(head()),new DOMException('Local timeout','TimeoutError'),json(savedUpdate)]);await f.nodes['[data-load-approved]'].emit('click');assert.equal(f.result.hidden,false);f.form.elements.proposed_version.value='0.2.0';await f.form.emit('submit');const original=envelope(f);assert.equal(s.calls.length,1);await f.form.emit('submit');f.form.elements.summary.value='Edited update';await f.form.emit('submit');assert.deepEqual(envelope(f),original);assert.equal(s.calls.length,2);f.form.elements.summary.value=head().proposal.summary;await f.form.emit('submit');assert.equal(s.calls[1].init.body,s.calls[2].init.body);assert.equal(s.calls[1].init.headers['X-Creator-Capability'],s.calls[2].init.headers['X-Creator-Capability']);assert.match(f.status.textContent,/approved version is retained/);
});
test('reviews reject a partial purchase proof before POST, and clear both proof fields only on confirmed success',async()=>{
 const f=review(),s=setup([['.review-form',f]],[new DOMException('Local timeout','TimeoutError'),json({publicly_listed:true,review_id:'local-review'})]);f.form.elements.operation_id.value='local-operation';await f.form.emit('submit');assert.equal(s.calls.length,0);assert.match(f.status.textContent,/both/);assert.equal(f.form.elements.review_secret.focused,true);
 f.form.elements.review_secret.value='local-secret';await f.form.emit('submit');assert.equal(f.form.elements.operation_id.value,'local-operation');assert.equal(f.form.elements.review_secret.value,'local-secret');await f.form.emit('submit');assert.equal(s.calls[0].init.body,s.calls[1].init.body);assert.equal(s.calls[0].init.headers['Idempotency-Key'],s.calls[1].init.headers['Idempotency-Key']);assert.equal(f.form.elements.operation_id.value,'');assert.equal(f.form.elements.review_secret.value,'');
});
test('review proof rejects secret without operation ID and keeps both fields after server rejection',async()=>{
 const f=review(),s=setup([['.review-form',f]],[json({error:{message:'Proof unavailable'}},403)]);f.form.elements.review_secret.value='local-secret';await f.form.emit('submit');assert.equal(s.calls.length,0);assert.equal(f.form.elements.operation_id.focused,true);f.form.elements.operation_id.value='local-operation';await f.form.emit('submit');assert.equal(f.form.elements.operation_id.value,'local-operation');assert.equal(f.form.elements.review_secret.value,'local-secret');
});
test('public reply target shows the author as text and can return to the main review',async()=>{
 const f=review(),target=new Element(),clear=new Element(),reply=new Element(),details=new Element();clear.hidden=true;clear.parent=f.form;reply.hidden=true;reply.dataset={replyTo:'local-reply',replyName:'<script>Local author</script>'};details.querySelector=()=>f.form;const original=f.form.querySelector;f.form.querySelector=selector=>selector==='[data-clear-reply]'?clear:selector==='.reply-target'?target:original(selector);
 setup([] ,[],{document:{getElementById:id=>id==='write-reply'?details:null,querySelectorAll:selector=>selector==='[data-reply-to]'?[reply]:selector==='[data-clear-reply]'?[clear]:[]}});
 assert.equal(reply.hidden,false);await reply.emit('click');assert.equal(f.form.elements.parent_reply_id.value,'local-reply');assert.match(target.textContent,/<script>Local author<\/script> \(local-reply\)/);assert.equal(clear.hidden,false);await clear.emit('click');assert.equal(f.form.elements.parent_reply_id.value,'');assert.equal(target.textContent,'Replying to the review');assert.equal(clear.hidden,true);assert.equal(f.form.elements.message.focused,true);
});
