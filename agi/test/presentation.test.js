import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {database} from '../../platform/scripts/local-db.js';
import {humansPage} from '../src/humans.js';
import worker from '../src/worker.js';
import {selectCatalog} from '../src/catalog.js';
import {createModel} from '../src/model.js';
import {homePage,toolPage,renderMarkdown,catalogPage} from '../src/pages.js';
import {products,REGISTRY_VERSION} from '../../platform/src/registry.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {CREATOR_TERMS} from '../../platform/src/submissions.js';
import {REFERRAL_TERMS} from '../../platform/src/referrals.js';

const canonical='https://agi.agenttoolbox2026.workers.dev';
const site='https://presentation.example';
const active=products.filter(product=>product.status==='active');
const plain=value=>JSON.parse(JSON.stringify(value));
const db=database();after(()=>db.close());
const allow={limit:async()=>({success:true})};
const bindings={METRICS_DB:db,PUBLIC_ORIGIN:canonical,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow,PAYMENTS_MODE:'x402',RECEIVER_CONFIRMED:'true',PAYMENT_NETWORK:'eip155:8453',PAYMENT_ASSET:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',PAY_TO_ADDRESS:'0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D'};
const request=(path,init={},env={})=>worker.fetch(new Request(site+path,init),{...bindings,...env});
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
 for(const html of [catalogPage(model,selectCatalog(model)),toolPage(model,product)]){
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
 assert.match(sell,/paid status requires a verified finalized Base USDC receipt/i);
 assert.doesNotMatch(sell,/payout initiation remains unavailable/i);
 assert.match(sell,/\[Creator payouts\]\(\/creator-wallet\)/);
 assert.match(sell,/ERC-1271 is unsupported/);
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

test('same-origin discovery handles credential headers without forwarding or redirecting',async t=>{
 noNetwork(t);
 for(const path of ['/openapi.json','/.well-known/x402','/humans'])for(const method of ['GET','HEAD']){
  const response=await request(path+'?capability=secret-query&destination=https://evil.invalid',{method,headers:{Authorization:'secret-header','X-Creator-Capability':'secret-creator','PAYMENT-SIGNATURE':'private-signature'}});
  assert.equal(response.status,200,path+' '+method);
  assert.equal(response.headers.has('location'),false);
  assert.doesNotMatch(await response.text(),/secret-query|secret-header|secret-creator|private-signature|evil\.invalid/);
 }
});

test('missing or mismatched operational bindings fail closed without forwarding secrets',async t=>{
 noNetwork(t);
 for(const path of ['/v1/products','/v1/products/docs-pack/invoke','/v1/tool-submissions','/mcp']){
  for(const method of ['GET','HEAD','POST']){
   const req=new Request(site+path,{method,headers:{'Content-Type':'application/json','PAYMENT-SIGNATURE':'secret-payment','X-Creator-Capability':'secret-creator'},...(['GET','HEAD'].includes(method)?{}:{body:'secret-body'})});
   const response=await worker.fetch(req,{});
   assert.equal(response.status,503);assert.equal(response.headers.has('location'),false);
   assert.equal(req.bodyUsed,false);assert.doesNotMatch(await response.text(),/secret-/);
  }
 }
 const wrong=await request('/v1/products',{}, {PUBLIC_ORIGIN:'https://wrong.invalid'});
 assert.equal(wrong.status,503);
});

test('document and asset routes reject mutation methods without reflecting request bodies',async t=>{
 noNetwork(t);
 for(const path of ['/','/buy','/sell','/humans','/tools/docs-pack','/agent.json','/style.css'])for(const method of ['POST','PUT','PATCH','DELETE']){
  const response=await request(path,{method,body:'private-request-body'});
  assert.equal(response.status,405,path+' '+method);assert.equal(response.headers.has('location'),false);
  assert.doesNotMatch(await response.text(),/private-request-body/);
 }
});

test('only public assets reach ASSETS with fresh credential-free requests',async t=>{
 noNetwork(t);const seen=[];const model=await createModel();
 const env={ASSETS:{fetch:async req=>{
  const url=new URL(req.url);seen.push(url.pathname);
  assert.equal(url.origin,model.siteOrigin);assert.equal(url.search,'');
  assert.equal([...req.headers].length,0);assert.equal(req.body,null);
  return new Response('asset',{headers:{'Content-Type':url.pathname.endsWith('.css')?'text/css':url.pathname.endsWith('.js')?'text/javascript':'image/png'}});
 }}};
 const paths=['/style.css','/humans.css','/header.css','/forms.css','/workflow.css','/site.js','/retry-envelope.js','/agenttoolbox-icon.png'];
 for(const path of paths){
  assert.equal((await request(path+'?private=secret',{headers:{Authorization:'secret','PAYMENT-SIGNATURE':'secret','X-Creator-Capability':'secret'}},env)).status,200);
  const head=await request(path,{method:'HEAD'},env);assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
 for(const path of ['/secret.json','/assets/private','/style.css/extra','/agenttoolbox-icon-private'])assert.equal((await request(path,{},env)).status,404,path);
 assert.deepEqual(seen,paths.flatMap(path=>[path,path]));
 for(const [source,target]of [['style.css','workflow.css'],['site.js','site.js'],['retry-envelope.js','retry-envelope.js']])assert.deepEqual(await readFile(new URL('../public/'+target,import.meta.url)),await readFile(new URL('../../platform/public/'+source,import.meta.url)));
});

test('AGI configuration uses the exact existing ledger and payment identities with shared limits',async()=>{
 const config=JSON.parse(await readFile(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
 const old=JSON.parse(await readFile(new URL('../../platform/wrangler.jsonc',import.meta.url),'utf8'));
 assert.equal(config.name,'agi');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.assets.run_worker_first,true);
 assert.equal(config.d1_databases.length,1);assert.equal(config.d1_databases[0].database_id,'6b3da390-f6c4-4013-a0c6-cbf7b0170cca');
 assert.deepEqual(config.ratelimits,old.ratelimits);
 for(const key of ['PAY_TO_ADDRESS','PAYMENT_NETWORK','PAYMENT_ASSET','RECEIVER_CONFIRMED','PAYMENTS_MODE'])assert.equal(config.vars[key],old.vars[key],key);
 assert.equal(config.vars.PUBLIC_ORIGIN,canonical);assert.equal(config.observability.enabled,false);
 for(const binding of ['kv_namespaces','r2_buckets','durable_objects','services','queues'])assert.equal(config[binding],undefined);
});

test('document front door stays compact and links to the new Humans page',async()=>{
 const html=await(await request('/')).text();
 assert.doesNotMatch(html,/<details|tool-card|hero-layout|guide-sidebar/);
 for(const id of ['buy-tools','sell-tools','machine-readable'])assert(html.includes('id="'+id+'"'));
 assert(html.includes('href="/humans"'));
 const css=await readFile(new URL('../public/style.css',import.meta.url));
 const cssVersion=createHash('sha256').update(css).digest('hex').slice(0,12);
 assert(html.includes('href="/style.css?v='+cssVersion+'"'));
 const manifest=await(await request('/agent.json')).json();assert.equal(manifest.for_humans,canonical+'/humans');
 assert.equal(manifest.presentation_only,undefined);
});

test('Humans counter distinguishes unavailable data from zero and escapes all presentation',async()=>{
 const model=await createModel();
 for(const [value,expected]of [[0,'0'],[12,'12'],[12345,'12,345'],[null,'Unavailable'],[undefined,'Unavailable'],[-1,'Unavailable'],[1.5,'Unavailable'],['<img>','Unavailable']]){
  const html=humansPage(model,{lifetime_paid_purchases:value});
  assert(html.includes('>'+expected+'</p>'));assert(html.includes('Tools Sold'));
  assert.doesNotMatch(html,/<script|<form|onerror=/);assert(html.includes('href="/"'));
 }
 const response=await request('/humans',{}, {METRICS_DB:{prepare(){throw new Error('offline');}}});
 assert.equal(response.status,200);assert((await response.text()).includes('Unavailable'));assert.equal(response.headers.get('cache-control'),'no-store');
 const css=await readFile(new URL('../public/humans.css',import.meta.url));
 assert(humansPage(model,null).includes('v='+createHash('sha256').update(css).digest('hex').slice(0,12)));
});

test('Humans counter cannot bypass shared D1 admission limits',async()=>{
 let reads=0,limits=0;
 const databaseGuard={prepare(){reads++;throw new Error('A denied request must not query D1.');}};
 const deny={limit:async()=>{limits++;return {success:false};}};
 for(const env of [{METRICS_DB:databaseGuard,SERVICE_LIMIT:deny},{METRICS_DB:databaseGuard,CLIENT_LIMIT:deny}]){
  const response=await request('/humans',{},env);
  assert.equal(response.status,200);assert((await response.text()).includes('Unavailable'));
 }
 assert.equal(reads,0);assert.equal(limits,2);
 const head=await request('/humans',{method:'HEAD'},{METRICS_DB:databaseGuard});
 assert.equal(await head.text(),'');assert.equal(reads,0);
});

test('Markdown rendering preserves inert text and rejects executable link schemes',()=>{
 const html=renderMarkdown('# Test\n\n[bad](javascript:alert(1)) <img src=x onerror=alert(1)>\n\n```json\n</code><script>alert(1)</script>\n```\n\n[good](https://example.com/path)');
 assert.doesNotMatch(html,/<script|<img|href="javascript:/);
 assert(html.includes('&lt;script&gt;'));
 assert(html.includes('href="https://example.com/path"'));
});
