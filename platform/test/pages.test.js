import test from 'node:test';
import assert from 'node:assert/strict';
import {home,humansPage,notFoundPage,shell,submissionPage,updatePage,previewPage,reviewsPage,reviewPage} from '../src/pages.js';
import {products} from '../src/registry.js';
import {createPlatform} from '../src/app.js';
import {database} from '../scripts/local-db.js';
test('every public page and future shared-template page uses the exact AgentToolbox title',()=>{
 for(const html of [home(),humansPage({lifetime_paid_purchases:0}),notFoundPage(),shell('<h1>A future page</h1>')]){
  assert.deepEqual(html.match(/<title>.*?<\/title>/g),['<title>AgentToolbox</title>']);
  assert.equal((html.match(/Built for agents, by agents\./g)||[]).length,1);
 }
 assert(home().includes('For Humans ↗'));
 assert(humansPage(null).includes('For Agents ↗'));
 assert(humansPage(null).includes('Useful results.'));
 const buyerHome=home(),counter=humansPage({lifetime_paid_purchases:2});
 assert(buyerHome.includes('<a href="/submit-tool">Sell tools ↗</a>'));
 for(const id of ['docs-pack','quote-proof','contract-cases','mcp-wirecheck']){
  assert(buyerHome.includes('/v1/products/'+id+'/criteria">Success criteria &amp; pin ↗</a>'));
  assert(buyerHome.includes('/v1/products/'+id+'/examples">Free test cases ↗</a>'));
 }
 assert(counter.includes('<span>Outcomes sold</span>'));
 assert(counter.includes('Includes repeat purchases.'));
 assert(counter.includes('Does not count unique or verified agents.'));
});
test('native workflow submission never puts capabilities, proposal text or preview input into GET URLs',()=>{
 const submission=submissionPage(),update=updatePage(),preview=previewPage(products.find(p=>p.id==='docs-pack'));
 const pages=[submission,update,preview,home()];
 const forms=pages.flatMap(html=>html.match(/<form\b[\s\S]*?<\/form>/g)??[]).filter(form=>!form.includes('class="catalog-search"'));
 assert.equal(forms.length,6);
 for(const form of forms){
  const opening=form.match(/^<form[^>]*>/)[0];assert.match(opening,/method="post"/);
  const action=opening.match(/action="([^"]+)"/)[1];assert(action.startsWith('/')&&!action.startsWith('//'));assert(!/[?#]/.test(action));
 }
 assert.match(submission,/<form class="submission-form" method="post" action="\/v1\/tool-submissions"/);
 assert.match(submission,/<form class="submission-status-form" method="post" action="\/submit-tool"/);
 assert.match(update,/<form class="tool-update-form" method="post" action="\/update-tool"/);
 assert.match(update,/<form class="submission-status-form" method="post" action="\/update-tool"/);
 assert.match(preview,/<form class="preview-form" method="post" action="\/v1\/products\/docs-pack\/prepare"/);
 assert.match(submission,/<noscript>[\s\S]*href="\/sell"/);assert.match(preview,/href="\/buy#optional-real-input-previews"/);
});
test('review and reply capability forms also have explicit same-origin POST fallbacks',()=>{
 const review={review_id:'00000000-0000-4000-8000-000000000001',product_id:'docs-pack',version:'1.0.0',display_name:'Local fixture',message:'Local fixture',created_at:'2026-10-07T00:00:00Z',badge:'Unverified',rating:null};
 const list=reviewsPage({product_id:'docs-pack',status:'all',reviews:[],aggregates:[],next_cursor:null});
 const detail=reviewPage({review,replies:[],next_cursor:null});
 for(const html of [list,detail]){
  const form=html.match(/<form class="review-form"[^>]*>/)[0];assert.match(form,/method="post"/);assert.match(form,/action="\/v1\/reviews(?:\/[^"?]+\/replies)?"/);
 }
});
test('no-script POST fallback refuses URL-encoded proposals and capabilities without storing or echoing them',async()=>{
 const db=database();try{
  const app=createPlatform({db,origin:'https://local.example.invalid',trackingEnabled:false});
  for(const [path,status] of [['/v1/tool-submissions',415],['/submit-tool',404],['/update-tool',404],['/v1/products/docs-pack/prepare',415]]){
   const response=await app(new Request('https://local.example.invalid'+path,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'capability=local-private-fixture&summary=local-private-fixture'}));
   assert.equal(response.status,status);assert(!(await response.text()).includes('local-private-fixture'));assert.equal(response.headers.get('Location'),null);
  }
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_tool_submissions').get().n,0);assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_preparations').get().n,0);
 }finally{db.close();}
});
