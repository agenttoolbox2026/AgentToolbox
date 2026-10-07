import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import worker from '../src/worker.js';
import {createModel} from '../src/model.js';
import {homePage,toolPage,renderMarkdown} from '../src/pages.js';
import {products,REGISTRY_VERSION} from '../../platform/src/registry.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {CREATOR_TERMS} from '../../platform/src/submissions.js';
import {REFERRAL_TERMS} from '../../platform/src/referrals.js';

const canonical='https://agnttoolbx.agenttoolbox2026.workers.dev';
const site='https://presentation.example';
const active=products.filter(product=>product.status==='active');
const plain=value=>JSON.parse(JSON.stringify(value));
const request=(path,init={},env={})=>worker.fetch(new Request(site+path,init),env);
const publicHtml=['/','/buy','/sell',...active.map(product=>'/tools/'+product.id)];
const publicMarkdown=['/llms.txt','/AGENTS.md','/buy.md','/sell.md',...active.map(product=>'/tools/'+product.id+'.md')];
const noNetwork=t=>t.mock.method(globalThis,'fetch',()=>{throw new Error('Presentation must not make external requests.');});

test('presentation products retain the canonical contract, price, examples and success pins',async()=>{
 const model=await createModel();
 assert.equal(model.origin,canonical);
 assert.equal(model.registryVersion,REGISTRY_VERSION);
 assert.deepEqual(model.tools.map(product=>product.id).sort(),active.map(product=>product.id).sort());
 for(const original of active){
  const presented=model.tools.find(product=>product.id===original.id);
  for(const field of ['id','version','name','status','outcome','pricing','limits','input_schema','output_schema','example_input','preview'])
   assert.deepEqual(plain(presented[field]),plain(original[field]),original.id+': '+field);
  assert.equal(presented.pricing.minimum_amount_atomic,'10000');
  assert.equal(presented.pricing.live_payment_verified,false);
  const pin=await successContractPin(original);
  assert.deepEqual(presented.success_pin,pin,original.id+': snapshot pin');
  assert.equal(createHash('sha256').update(presented.success_pin.canonical_json,'utf8').digest('hex'),presented.success_pin.sha256);
  for(const suffix of ['', '/criteria','/examples','/invoke','/quote'])
   assert(Object.values(presented.links).includes(canonical+'/v1/products/'+original.id+suffix),original.id+': canonical link '+suffix);
  assert(Object.values(presented.links).filter(Boolean).every(link=>new URL(link).origin===canonical),original.id+': every operational link must be canonical');
  assert.equal(presented.links.prepare,original.preview.supported?canonical+original.preview.path:null);
  assert.equal(presented.links.preview,original.preview.supported?canonical+original.preview.page:null);
 }
 assert.deepEqual(model.tools.filter(product=>product.preview.supported).map(product=>product.id).sort(),['contract-cases','docs-pack']);
 assert.equal(model.tools.some(product=>product.id==='retry-gate'),false);
 assert.deepEqual(model.sellerTerms.terms,CREATOR_TERMS);
 assert.deepEqual(model.referralTerms.terms,REFERRAL_TERMS);
 const generated=JSON.parse(await readFile(new URL('../src/generated.json',import.meta.url),'utf8'));
 assert.deepEqual(generated,plain(model),'Deployed snapshot must match current canonical source.');
});

test('all HTML and Markdown routes work without scripts, forms, capabilities or network access',async t=>{
 noNetwork(t);
 for(const path of publicHtml){
  const response=await request(path);assert.equal(response.status,200,path);
  assert.match(response.headers.get('content-type'),/^text\/html\b/,path);
  const html=await response.text();
  assert.match(html,/<title>AgentToolbox<\/title>/,path);
  assert.doesNotMatch(html,/<(?:script|form|iframe|object|embed)\b|\bon[a-z]+\s*=|javascript:/i,path);
  assert.doesNotMatch(html,/<input\b[^>]*type\s*=\s*["']?password/i,path);
  const policy=response.headers.get('content-security-policy')??'';
  for(const directive of ["script-src 'none'","connect-src 'none'","form-action 'none'"])assert(policy.includes(directive),path+': '+directive);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer',path);
  assert.equal(response.headers.get('x-content-type-options'),'nosniff',path);
 }
 for(const path of publicMarkdown){
  const response=await request(path);assert.equal(response.status,200,path);
  assert.match(response.headers.get('content-type'),/^text\/(?:markdown|plain)\b/,path);
  assert((await response.text()).includes(canonical),path+': canonical API origin');
 }
});

test('tool data and example input stay inert when rendered into text, code and attributes',async()=>{
 const model=plain(await createModel());
 const payload='Audit sentinel </pre><img src=x onerror="alert(1)"><script>alert(2)</script> & "quoted"';
 const product=model.tools[0];
 for(const field of ['name','summary','problem','fit','scope'])product[field]=payload;
 product.outcome.success_criterion=payload;
 product.example_input={text:payload};
 product.links.detail='https://example.invalid/" onmouseover="alert(3)';
 for(const html of [homePage(model),toolPage(model,product)]){
  assert(html.includes('Audit sentinel'),'Renderer must retain visible text.');
  assert.doesNotMatch(html,/<script\b|<img\s+src=x/i);
  assert(html.includes('&lt;'),'Untrusted angle brackets must be escaped.');
  assert.doesNotMatch(html,/href="https:\/\/example\.invalid\/" onmouseover=/i);
 }
});

test('machine routes and root negotiation agree with canonical tool contracts',async()=>{
 const agent=await request('/agent.json');assert.equal(agent.status,200);
 assert.match(agent.headers.get('content-type'),/^application\/json\b/);
 const document=await agent.json(),serialized=JSON.stringify(document);
 for(const product of active){
  assert(serialized.includes(product.id),product.id);
  assert(serialized.includes(canonical+'/v1/products/'+product.id+'/invoke'),product.id+': canonical invocation');
  assert(serialized.includes((await successContractPin(product)).sha256),product.id+': canonical pin');
  const guide=await request('/tools/'+product.id+'.md');
  const text=await guide.text();
  for(const fragment of [product.version,product.outcome.success_criterion,canonical+'/v1/products/'+product.id+'/invoke'])assert(text.includes(fragment),product.id+': '+fragment);
  const negotiatedTool=await request('/tools/'+product.id,{headers:{Accept:'application/json'}});
  assert.equal(negotiatedTool.status,200);
  assert.deepEqual(await negotiatedTool.json(),document.tools.find(tool=>tool.id===product.id));
 }
 const negotiated=await request('/',{headers:{Accept:'application/json'}});
 assert.equal(negotiated.status,200);assert.match(negotiated.headers.get('content-type'),/^application\/json\b/);
 assert.match(negotiated.headers.get('vary')??'',/\bAccept\b/i);
 assert.deepEqual(await negotiated.json(),document);
 const markdown=await request('/',{headers:{Accept:'text/markdown'}});
 assert.equal(markdown.status,200);assert.match(markdown.headers.get('content-type'),/^text\/markdown\b/);
 assert.match(markdown.headers.get('vary')??'',/\bAccept\b/i);
 assert((await markdown.text()).includes(canonical));
});

test('buyer and seller guides preserve payment recovery, approval boundaries and capability safety',async()=>{
 const buy=await(await request('/buy.md')).text(),sell=await(await request('/sell.md')).text();
 for(const fragment of ['success_contract_sha256','payment_requirements_sha256','canonical_json','Idempotency-Key','PAYMENT-SIGNATURE','PAYMENT-RESPONSE','quote_id','prepared_id','X-Preparation-Capability'])assert(buy.includes(fragment),fragment);
 assert.match(buy,/no separate public receipt GET route/i);
 assert.match(buy,/24 hours/);
 assert.match(buy,/never issue a replacement authorization/i);
 assert.match(buy,/facilitator-confirmed/);
 assert.match(buy,/not independently reconciled/);
 assert.match(sell,/90% lifetime gross/);
 assert.match(sell,/actual submission fee: \$0/);
 assert(sell.includes(CREATOR_TERMS.terms_version));
 for(const fragment of ['X-Creator-Capability','creator_secret_hash','request_id','base_version','expected_head_revision','capability','recovery'])assert(sell.includes(fragment),fragment);
 assert.match(sell,/does not install, publish or execute/i);
 assert.match(sell,/last approved version while pending or rejected/i);
 assert.match(sell,/no fee is paid and no refund is due/i);
 assert.match(sell,/payout processing remains unimplemented/i);
 assert.match(sell,/never URLs, public proposal fields, logs or browser web storage/i);
});

test('HEAD has matching status and MIME type but no body on public and missing routes',async()=>{
 for(const path of [...publicHtml,...publicMarkdown,'/humans','/agent.json','/missing','/tools/missing','/tools/retry-gate']){
  const get=await request(path),head=await request(path,{method:'HEAD'});
  assert.equal(head.status,get.status,path);
  assert.equal(head.headers.get('content-type'),get.headers.get('content-type'),path);
  assert.equal(await head.text(),'',path);
 }
 for(const path of ['/missing','/tools/missing','/tools/missing.md','/tools/retry-gate'])assert.equal((await request(path)).status,404,path);
});

test('credential-free canonical schema redirects never forward visitor queries',async t=>{
 noNetwork(t);
 for(const path of ['/openapi.json','/.well-known/x402','/humans'])for(const method of ['GET','HEAD']){
  const response=await request(path+'?capability=secret-query&destination=https://evil.invalid',{method});
  assert.equal(response.status,307,path+' '+method);
  assert.equal(response.headers.get('location'),canonical+path);
  assert.doesNotMatch(await response.text(),/secret-query|secret-header|secret-creator|evil\.invalid/);
 }
});

test('redirect-following clients never send credentials to a destination from discovery aliases',async t=>{
 const destinationCalls=[];
 t.mock.method(globalThis,'fetch',async request=>{destinationCalls.push(request);return new Response('Unexpected destination call');});
 // Model clients that follow 307s while retaining custom credential headers.
 // The previous implementation reached fetch here even with a fixed Location.
 const followingClient=async request=>{
  const response=await worker.fetch(request,{});
  if([301,302,303,307,308].includes(response.status)&&response.headers.has('location'))
   return fetch(new Request(new URL(response.headers.get('location'),request.url),{method:request.method,headers:request.headers}));
  return response;
 };
 for(const path of ['/openapi.json','/.well-known/x402','/humans'])for(const method of ['GET','HEAD'])
  for(const header of ['X-Creator-Capability','X-Preparation-Capability','X-Referral-Capability','PAYMENT-SIGNATURE','Authorization','Cookie','Proxy-Authorization','X-Payment','X-Api-Key','X-Auth-Token']){
   const response=await followingClient(new Request(site+path,{method,headers:{[header]:'private-sentinel'}}));
   assert.equal(response.status,421,path+' '+method+' '+header);
   assert.equal(response.headers.has('location'),false);
   assert.equal(response.headers.get('cache-control'),'no-store');
   assert.doesNotMatch(await response.text(),/private-sentinel/);
  }
 assert.equal(destinationCalls.length,0,'A redirect-following client must make zero destination calls.');
});

test('all canonical API calls are refused without reflecting, consuming or forwarding secrets',async t=>{
 noNetwork(t);
 const forbiddenEnv=new Proxy({},{get(){throw new Error('API refusal must not access bindings.');}});
 for(const path of ['/v1/products/docs-pack/invoke','/v1/products/docs-pack/prepare','/v1/referrals','/v1/referrals/me','/v1/tool-submissions','/v1/creator-tools/creator-test/updates','/mcp']){
  for(const method of ['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS']){
   const init={method,headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':'secret-payment','X-Creator-Capability':'secret-creator','X-Preparation-Capability':'secret-preparation','X-Referral-Capability':'secret-referral',Authorization:'Bearer secret-authorization'}};
   if(!['GET','HEAD'].includes(method))init.body='secret-body-not-json';
   const req=new Request(site+path+'?secret-query=yes',init);
   const response=await worker.fetch(req,forbiddenEnv);
   assert.equal(response.status,421,path+' '+method);
   assert.equal(response.headers.has('location'),false,path+' '+method);
   assert.equal(req.bodyUsed,false,path+' '+method+': request body must remain untouched');
   const body=await response.text();assert.doesNotMatch(body,/secret-|Bearer|PAYMENT-SIGNATURE/);
   if(method==='HEAD')assert.equal(body,'');
   else{const parsed=JSON.parse(body);assert.equal(parsed.error.code,'canonical_api_required');assert(body.includes(canonical));}
  }
 }
});

test('presentation and discovery paths reject mutation methods without redirection or bindings',async t=>{
 noNetwork(t);
 for(const path of ['/','/buy','/sell','/tools/docs-pack','/agent.json','/openapi.json','/.well-known/x402','/style.css','/missing']){
  for(const method of ['POST','PUT','PATCH','DELETE']){
   const response=await request(path,{method,body:'private-request-body'});
   assert.equal(response.status,405,path+' '+method);
   assert.equal(response.headers.has('location'),false,path+' '+method);
   assert.doesNotMatch(await response.text(),/private-request-body/);
  }
 }
});

test('only the two public asset paths can reach ASSETS and HEAD remains bodyless',async t=>{
 noNetwork(t);
 const seen=[];
 const model=await createModel();
 const env={ASSETS:{fetch:async req=>{
  const url=new URL(req.url);seen.push(url.pathname);
  assert.equal(url.origin,model.siteOrigin);assert.equal(url.search,'');
  for(const header of ['Authorization','PAYMENT-SIGNATURE','X-Creator-Capability'])assert.equal(req.headers.has(header),false,header+' must not reach ASSETS');
  return new Response('asset',{headers:{'Content-Type':url.pathname.endsWith('.css')?'text/css':'image/png'}});
 }}};
 for(const path of ['/style.css','/agenttoolbox-icon.png']){
  assert.equal((await request(path+'?private=secret',{headers:{Authorization:'secret','PAYMENT-SIGNATURE':'secret','X-Creator-Capability':'secret'}},env)).status,200);
  const head=await request(path,{method:'HEAD'},env);assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
 for(const path of ['/site.js','/secret.json','/assets/private','/style.css/extra'])assert.equal((await request(path,{},env)).status,404,path);
 assert.deepEqual(seen,['/style.css','/style.css','/agenttoolbox-icon.png','/agenttoolbox-icon.png']);
});

test('deployed Worker dependency graph cannot import platform execution, database, payment or accounting code',async()=>{
 const root=new URL('../src/',import.meta.url),seen=new Set();
 const visit=async url=>{
  if(seen.has(url.href))return;seen.add(url.href);
  assert(url.href.startsWith(root.href),'Runtime dependency escapes presentation source: '+fileURLToPath(url));
  if(url.pathname.endsWith('.json'))return;
  const source=await readFile(url,'utf8');
  assert.doesNotMatch(source,/\b(?:METRICS_DB|PAY_TO_ADDRESS|PAYMENTS_MODE|paymentAdapterFactory|createPlatform)\b/,fileURLToPath(url));
  for(const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/g)){
   assert(match[1].startsWith('.'),'Unexpected runtime package: '+match[1]);
   await visit(new URL(match[1],url));
  }
 };
 await visit(new URL('../src/worker.js',import.meta.url));
 const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.name,'agi');
 assert.equal(config.assets.binding,'ASSETS');
 for(const binding of ['d1_databases','kv_namespaces','r2_buckets','durable_objects','services','queues','triggers','vars'])assert.equal(config[binding],undefined,'Presentation must not configure '+binding);
});


test('document front door exposes essential actions and links to the original Humans page',async()=>{
 const html=await(await request('/')).text();
 assert.doesNotMatch(html,/<details|tool-card|hero-layout|guide-sidebar/);
 for(const id of ['quick-start','buy-tools','sell-tools','request-and-response','update-an-approved-tool','machine-readable'])assert(html.includes('id="'+id+'"'));
 assert(html.includes('href="'+canonical+'/humans"'));
 const css=await readFile(new URL('../public/style.css',import.meta.url));
 const cssVersion=createHash('sha256').update(css).digest('hex').slice(0,12);
 assert(html.includes('href="/style.css?v='+cssVersion+'"'),'Changed stylesheet must have a new browser cache key');
 const manifest=await(await request('/agent.json')).json();assert.equal(manifest.for_humans,canonical+'/humans');
 for(const p of active)assert(html.includes(p.outcome.success_criterion.replaceAll('&','&amp;')));
});

test('Markdown rendering preserves inert text and rejects executable link schemes',()=>{
 const html=renderMarkdown('# Test\n\n[bad](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n```json\n</code><script>alert(1)</script>\n```\n\n[good](https://example.com/path)');
 assert.doesNotMatch(html,/<script|<img|href="javascript:/);
 assert(html.includes('&lt;script&gt;'));
 assert(html.includes('href="https://example.com/path"'));
});
