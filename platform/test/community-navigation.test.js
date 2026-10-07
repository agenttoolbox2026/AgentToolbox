import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatform} from '../src/app.js';
import {home} from '../src/pages.js';
import {products} from '../src/registry.js';
import {database} from '../scripts/local-db.js';

const origin='https://local.example.invalid';
const active=products.filter(product=>product.status==='active');
const forbiddenDb=new Proxy({}, {get(){throw new Error('Community navigation must not read private records or fabricate totals.');}});
const requestFor=options=>{
 const app=createPlatform({db:forbiddenDb,origin,trackingEnabled:false,...options});
 return (path,init={})=>app(new Request(origin+path,init));
};
const feedbackForm=html=>html.match(/<form class="feedback-form"[\s\S]*?<\/form>/)?.[0];
const jsonPost=(body,key=crypto.randomUUID())=>({method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});

test('community indices list only active catalog tools and canonical providers without reading private records',async()=>{
 const request=requestFor();
 for(const path of ['/reviews','/feedback']){
  const response=await request(path),html=await response.text();
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/^text\/html/);
  assert.match(html,/<title>AgentToolbox<\/title>/);
  assert.match(html,/<script type="module" src="\/site\.js\?/);
  assert.match(response.headers.get('content-security-policy'),/script-src 'self'/);
  assert.match(response.headers.get('content-security-policy'),/form-action 'self'/);
  assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  assert.equal(response.headers.get('cache-control'),'no-store');
  for(const product of active){
   const target=path==='/reviews'?'/products/'+product.id+'/reviews':'/feedback?tool='+product.id;
   assert(html.includes('href="'+target+'"'),target);
   assert(html.includes(product.name));
   assert(html.includes('By '+product.provider.name));
  }
  assert(!html.includes('retry-gate'));
  assert.doesNotMatch(html,/class="review-aggregates"|class="review-card"|average_rating|platform_feedback/);
  const head=await request(path,{method:'HEAD'});
  assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
});

test('selected feedback page reuses the existing form verbatim and opens it for the selected active tool',async()=>{
 const request=requestFor();
 for(const product of active){
  const path='/feedback?tool='+product.id,response=await request(path),html=await response.text();
  assert.equal(response.status,200,path);
  assert.match(html,/<details open class="feedback"/);
  assert.equal(feedbackForm(html),feedbackForm(home({q:product.id},products)),product.id);
  assert(html.includes('name="product_id" value="'+product.id+'"'));
  assert(html.includes('name="version" value="'+product.version+'"'));
  assert.match(html,/<button type="submit" hidden>Send feedback<\/button>/);
  assert.match(html,/Private to the owner\. No secrets or sensitive task details\./);
  assert.match(html,/href="\/feedback"/);
  const head=await request(path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 }
});

test('feedback selection rejects unknown, retired, empty or ambiguous IDs without reflecting query input',async()=>{
 const request=requestFor(),sentinel='<img src=x onerror="navigation-sentinel">';
 for(const query of ['tool=missing','tool=retry-gate','tool=','tool=docs-pack&tool=quote-proof','tool='+encodeURIComponent(sentinel)]){
  const response=await request('/feedback?'+query),body=await response.text();
  assert.equal(response.status,404,query);
  assert.equal((await request('/feedback?'+query,{method:'HEAD'})).status,404);
  assert.equal(response.headers.get('location'),null);
  assert(!body.includes('navigation-sentinel'));
  assert(!body.includes('class="feedback-form"'));
 }
 const html=await(await request('/feedback?tool=docs-pack&message='+encodeURIComponent(sentinel))).text();
 assert(!html.includes('navigation-sentinel'),'Unrelated query input must not populate a private form.');
});

test('community pages escape tool and provider metadata and handle an empty active catalog',async()=>{
 const fixture={...active[0],name:'Tool <img src=x>',provider:{...active[0].provider,name:'Creator <script>sentinel</script>'}};
 const request=requestFor({catalog:[fixture,products.find(product=>product.status==='retired')]});
 for(const path of ['/reviews','/feedback','/feedback?tool='+fixture.id]){
  const html=await(await request(path)).text();
  assert(html.includes('Tool &lt;img src=x&gt;'));
  assert(html.includes('Creator &lt;script&gt;sentinel&lt;/script&gt;'));
  assert(!html.includes('<img src=x>'));assert(!html.includes('<script>sentinel</script>'));
  assert(!html.includes('By AgentToolbox'));
 }
 const empty=requestFor({catalog:[]});
 for(const path of ['/reviews','/feedback'])assert.match(await(await empty(path)).text(),/No active tools are available\./);
 assert.equal((await empty('/feedback?tool=docs-pack')).status,404);
});

test('community entry points preserve native POST JSON guards, private feedback replay and review consent',async()=>{
 const db=database(),request=requestFor({db});
 try{
  const privateText='Local navigation feedback fixture';
  for(const [path,status] of [['/feedback',404],['/reviews',404],['/v1/feedback',415],['/v1/reviews',415],['/v1/reviews/00000000-0000-4000-8000-000000000001/replies',415]]){
   const response=await request(path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'message='+privateText+'&capability=private-navigation-sentinel'});
   assert.equal(response.status,status,path);assert.equal(response.headers.get('location'),null);
   assert(!(await response.text()).includes('private-navigation-sentinel'));
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_feedback').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_reviews').get().n,0);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_review_replies').get().n,0);
  assert.equal((await request('/v1/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
  const body={product_id:active[0].id,version:active[0].version,message:privateText},key=crypto.randomUUID();
  const saved=await request('/v1/feedback',jsonPost(body,key));assert.equal(saved.status,200);
  const acknowledgment=await saved.json();
  assert.deepEqual(await(await request('/v1/feedback',jsonPost(body,key))).json(),acknowledgment);
  assert.equal((await request('/v1/feedback',jsonPost({...body,message:'Changed local fixture'},key))).status,409);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_feedback').get().n,1);
  assert.equal((await request('/v1/feedback')).status,404,'No private feedback list is exposed.');
  for(const path of ['/reviews','/feedback','/feedback?tool='+active[0].id])assert(!(await(await request(path)).text()).includes(privateText));
  const reviews=await(await request('/products/'+active[0].id+'/reviews')).text();
  assert.match(reviews,/name="consent" required/);
  assert.match(reviews,/Publish my display name and text/);
  assert.match(reviews,/A purchase badge proves a purchase-linked capability/);
  assert.match(reviews,/name="review_secret"/);
  assert.match(reviews,/<form class="review-form" method="post" action="\/v1\/reviews"/);
  assert.equal((await request('/v1/reviews',jsonPost({product_id:active[0].id,message:'Missing explicit public consent'}))).status,400);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_reviews').get().n,0);
 }finally{db.close();}
});
