import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createAgi} from '../src/worker.js';
import model from '../src/generated.json' with {type:'json'};
import {freeExampleManifest} from '../../platform/src/free-examples.js';
import {database} from '../../platform/scripts/local-db.js';
import {renderMarkdown} from '../src/pages.js';

const get=(worker,path,headers={})=>worker.fetch(new Request(model.origin+path,{headers}));

test('HTML, Markdown and JSON catalog routes stay bounded and preserve search across machine pagination',async()=>{
 const large={...model,tools:Array.from({length:1000},(_,i)=>({...model.tools[0],id:'published-'+i,name:'Tool '+String(i).padStart(4,'0')}))};
 const worker=createAgi({model:large});
 const first=await get(worker,'/tools.json?limit=7&q=Tool');assert.equal(first.status,200);
 const page=await first.json();assert.equal(page.tools.length,7);assert.equal(page.total,1000);
 assert.equal(new URL(page.next).pathname,'/tools.json');assert.equal(new URL(page.next).searchParams.get('q'),'Tool');
 const next=await get(worker,new URL(page.next).pathname+new URL(page.next).search);
 assert.equal((await next.json()).tools[0].name,'Tool 0007');
 const manifest=await (await get(worker,'/agent.json')).json();assert.equal(manifest.tools.length,20);assert.equal(manifest.total,1000);
 const continued=await worker.fetch(new Request(manifest.next));assert.match(continued.headers.get('content-type'),/^application\/json/);assert.equal((await continued.json()).page,2);
 for(const path of ['/tools?limit=7','/tools.md?limit=7']){
  const r=await get(worker,path),body=await r.text();assert.equal(r.status,200);
  assert(body.includes('Tool 0006'));assert(!body.includes('Tool 0007'));
  assert.equal(r.headers.get('content-security-policy').includes("script-src 'none'"),true);
 }
 const html=await get(worker,'/tools?q='+encodeURIComponent('"/><script>bad()</script>'));
 const body=await html.text();assert(!body.includes('<script>'));assert(body.includes('&lt;script&gt;'));
 assert(html.headers.get('content-security-policy').includes("form-action 'self'"));
 for(const query of ['page=-1','limit=0','q='+('x'.repeat(121)),'page=1&page=2'])assert.equal((await get(worker,'/tools.json?'+query)).status,400);
 assert.equal((await worker.fetch(new Request(model.origin+'/tools',{method:'POST',body:'private'}))).status,405);
});

test('readable contracts, checks and fixtures retain canonical machine data without execution',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Document views must not fetch or execute.');});
 const worker=createAgi();
 for(const tool of model.tools){
  for(const kind of ['contract','checks','examples']){
   const path='/tools/'+tool.id+'/'+kind;
   const response=await get(worker,path),html=await response.text();assert.equal(response.status,200,path);
   assert(html.includes('class="site-header"'));assert(html.includes('Created by: AgentToolbox'));
   assert(!/<script\b|<form\b/.test(html));assert(html.includes(tool.links[kind==='contract'?'detail':kind==='checks'?'criteria':'examples']));
   const markdown=await get(worker,path+'.md');assert.match(markdown.headers.get('content-type'),/^text\/markdown/);
  }
  const checks=await (await get(worker,'/tools/'+tool.id+'/checks',{Accept:'application/json'})).json();
  assert.deepEqual(checks,tool.success_pin);assert.equal(createHash('sha256').update(checks.canonical_json).digest('hex'),checks.sha256);
  assert.deepEqual(await (await get(worker,'/tools/'+tool.id+'/examples',{Accept:'application/json'})).json(),freeExampleManifest(tool.id));
 }
 assert.equal((await get(worker,'/tools/private-proposal/checks')).status,404);
 const terms=await get(worker,'/sell/terms');assert.equal(terms.status,200);assert((await terms.text()).includes('No payout service'));
});

test('community and seller workflows share the document shell while preserving native protections and zero-write GETs',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('GET views cannot perform external actions.');});
 const db=database();t.after(()=>db.close());const allow={limit:async()=>({success:true})};
 const env={METRICS_DB:db,PUBLIC_ORIGIN:model.origin,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow,PAYMENTS_MODE:'x402',RECEIVER_CONFIRMED:'true',PAYMENT_NETWORK:'eip155:8453',PAYMENT_ASSET:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',PAY_TO_ADDRESS:'0x'+'1'.repeat(40)};
 const worker=createAgi(),before=db.sqlite.prepare('SELECT total_changes() n').get().n;
 for(const path of ['/reviews','/feedback','/feedback?tool=docs-pack','/products/docs-pack/reviews','/products/docs-pack/preview','/submit-tool','/update-tool']){
  const r=await worker.fetch(new Request(model.origin+path),env),html=await r.text();assert.equal(r.status,200,path);
  for(const part of ['class="site-header"','class="document workflow-document"','/style.css?v=','/forms.css?v=','/site.js?'])assert(html.includes(part),path+' '+part);
  assert(!html.includes('href="/workflow.css'));assert(r.headers.get('content-security-policy').includes("form-action 'self'"));assert.equal(r.headers.get('cache-control'),'no-store');
 }
 assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n,before);
 for(const path of ['/v1/feedback','/v1/reviews','/v1/tool-submissions']){
  const r=await worker.fetch(new Request(model.origin+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'capability=private-test-sentinel'}),env);
  assert.equal(r.status,415,path);assert(!(await r.text()).includes('private-test-sentinel'));
 }
 assert.equal(db.sqlite.prepare('SELECT total_changes() n').get().n,before);
});

test('escaped Markdown names remain literal link labels and explicit Markdown URLs keep their type',async()=>{
 const html=renderMarkdown('# [Parser \\[v2\\]](/tools/parser)\n\nCreated by: Builder \\*group\\*.');
 assert(html.includes('>Parser [v2]</a>'));assert(html.includes('Builder *group*.'));assert(!html.includes('<strong>'));
 const worker=createAgi();for(const path of ['/tools.md','/sell/terms.md','/tools/docs-pack/checks.md','/tools/docs-pack/examples.md']){const r=await get(worker,path,{Accept:'application/json'});assert.match(r.headers.get('content-type'),/^text\/markdown/,path);}
});
