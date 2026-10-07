import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {themeWorkflowHtml,formsStylesheet} from '../src/workflow-theme.js';
import {header,headerStylesheet} from '../src/header.js';
import {escape,shell,previewPage,submissionPage,updatePage,reviewsIndexPage,feedbackPage,reviewsPage,reviewPage} from '../../platform/src/pages.js';
import {products} from '../../platform/src/registry.js';

const review={review_id:'00000000-0000-4000-8000-000000000001',product_id:'docs-pack',version:'0.1.0',display_name:'Local reviewer',message:'A useful local fixture.',created_at:'2026-10-07T00:00:00Z',badge:'Unverified',rating:4};
const reply={reply_id:'00000000-0000-4000-8000-000000000002',parent_reply_id:'00000000-0000-4000-8000-000000000003',display_name:'Local reply',message:'A nested reply fixture.',created_at:'2026-10-07T01:00:00Z',badge:'Verified purchase',same_purchase_as_review:true};
const reviewList=(entry=review)=>({product_id:'docs-pack',version:'0.1.0',status:'all',reviews:[entry],aggregates:[{badge:'Unverified',average_rating:4,rated:1,reviews:1}],next_cursor:'00000000-0000-4000-8000-000000000004'});
const reviewDetail=(entry=review,answer=reply)=>({review:entry,replies:[answer],next_cursor:'00000000-0000-4000-8000-000000000005'});
const fixtures=[
 ...['docs-pack','contract-cases'].map(id=>[id+' preview',previewPage(products.find(product=>product.id===id))]),
 ['submission',submissionPage()],
 ['update',updatePage()],
 ['reviews',reviewsPage(reviewList())],
 ['review replies',reviewPage(reviewDetail())],
 ['reviews index',reviewsIndexPage(products)],
 ['private feedback',feedbackPage(products,products.find(product=>product.id==='docs-pack'))],
 ['feedback index',feedbackPage(products)],
];
const head=html=>html.slice(html.indexOf('<head>')+6,html.indexOf('</head>'));
const main=html=>{
 const opening=/<main\b[^>]*>/.exec(html);
 assert(opening,'Expected a main element.');
 const end=html.lastIndexOf('</main>');
 assert(end>=opening.index+opening[0].length,'Expected a closed main element.');
 return html.slice(opening.index+opening[0].length,end);
};
const blocks=(html,tag)=>html.match(new RegExp('<'+tag+'\\b[^>]*>[\\s\\S]*?<\\/'+tag+'>','g'))??[];

test('every native workflow retains its complete original main content byte for byte',()=>{
 for(const [name,original]of fixtures){
  const themed=themeWorkflowHtml(original);
  assert.notEqual(themed,original,name+': the platform shell must be themed.');
  assert.equal(main(themed),main(original),name+': preserve all content and markup.');
  assert.match(themed,/<main id="main" class="document workflow-document">/,name);
  assert.equal(themeWorkflowHtml(themed),themed,name+': theming must be idempotent.');
 }
});

test('workflows use the shared AgentToolbox header and reachable feedback and tool navigation',()=>{
 for(const [name,original]of fixtures){
  const themed=themeWorkflowHtml(original);
  assert.deepEqual(blocks(themed,'header'),[header('agents')],name);
  assert.match(themed,/<a class="skip-link" href="#main">Skip to content<\/a>/,name);
  const footer=blocks(themed,'footer');
  assert.equal(footer.length,1,name);
  assert.match(footer[0],/Built for agents, by agents\./,name);
  assert.match(footer[0],/href="\/feedback"/,name);
  assert.match(footer[0],/href="\/tools"/,name);
  assert.match(footer[0],/href="\/reviews"/,name);
  assert.doesNotMatch(footer[0],/href="\/#feedback"/,name+': feedback must target its actual page.');
 }
});

test('workflow styling references the current agent stylesheet, shared header, and form overrides',async()=>{
 const [css,formsCss]=await Promise.all(['style.css','forms.css'].map(name=>readFile(new URL('../public/'+name,import.meta.url))));
 const version=createHash('sha256').update(css).digest('hex').slice(0,12);
 const formsVersion=createHash('sha256').update(formsCss).digest('hex').slice(0,12);
 assert.equal(formsStylesheet,'<link rel="stylesheet" href="/forms.css?v='+formsVersion+'">');
 for(const [name,original]of fixtures){
  const documentHead=head(themeWorkflowHtml(original));
  assert(documentHead.includes(headerStylesheet),name+': shared header CSS.');
  assert(documentHead.includes('href="/style.css?v='+version+'"'),name+': current agent CSS.');
  assert(documentHead.includes(formsStylesheet),name+': current form CSS.');
  assert.doesNotMatch(documentHead,/href="\/(?:workflow\.css|style\.css\?v=20261007-customer-1)"/,name+': do not retain the old page-wide theme.');
 }
});

test('form actions, capability inputs, hidden controls and data attributes survive unchanged',()=>{
 for(const [name,original]of fixtures.filter(([,html])=>/<form\b/.test(html))){
  const originalForms=blocks(original,'form');
  assert(originalForms.length>0,name+': fixture must exercise a working form.');
  const themedForms=blocks(themeWorkflowHtml(original),'form');
  assert.deepEqual(themedForms,originalForms,name+': preserve complete forms.');
  for(const form of themedForms){
   assert.match(form,/^<form\b[^>]*method="post"/,name);
   assert.match(form,/^<form\b[^>]*action="\/(?!\/)[^"?#]*"/,name);
  }
 }
 const submission=themeWorkflowHtml(submissionPage()),update=themeWorkflowHtml(updatePage());
 for(const html of [submission,update]){
  assert.match(html,/<input type="password" name="capability" autocomplete="off" spellcheck="false" maxlength="48" required pattern="atbc_\[A-Za-z0-9_-\]\{43\}">/);
  assert.match(html,/<textarea data-request-envelope rows="5" maxlength="20000" spellcheck="false" autocomplete="off"><\/textarea>/);
  assert.match(html,/<button type="button" data-copy-request>Copy retry request<\/button>/);
  assert.match(html,/<button type="button" data-restore-request>Restore retry request<\/button>/);
 }
 assert.match(update,/<fieldset data-update-fields hidden>/);
 assert.match(update,/name="expected_head_revision" type="number" readonly required min="0" max="2147483646"/);
 assert.match(update,/data-status-path="\/v1\/tool-updates\/"/);
 assert.match(themeWorkflowHtml(reviewsPage(reviewList())),/<input type="hidden" name="product_id" value="docs-pack">/);
 assert.match(themeWorkflowHtml(reviewPage(reviewDetail())),/data-reply-to="00000000-0000-4000-8000-000000000002"/);
});

test('original titles, head metadata and workflow module scripts are preserved exactly',()=>{
 for(const [name,original]of fixtures){
  const themed=themeWorkflowHtml(original);
  assert.deepEqual(blocks(themed,'title'),blocks(original,'title'),name);
  assert.deepEqual(head(themed).match(/<meta\b[^>]*>/g),head(original).match(/<meta\b[^>]*>/g),name);
  assert.deepEqual(blocks(themed,'script'),blocks(original,'script'),name);
  assert.match(themed,/<script type="module" src="\/site\.js\?v=20261007-customer-1"><\/script>/,name);
 }
});

test('trusted CSP, nonce, integrity and inline script bytes survive shell replacement',()=>{
 const securityHead='<meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;nonce-local-fixture&#39;; form-action &#39;self&#39;"><meta name="referrer" content="no-referrer"><script type="module" nonce="local-fixture" src="/retry-envelope.js" integrity="sha256-local-fixture" crossorigin="anonymous"></script>';
 const inline='<script nonce="local-fixture">const exactRetry = {body: "a&b", request_id: "local-fixture"};\n/* Preserve whitespace and bytes. */</script>';
 const original=shell('<section><h1>Security fixture</h1>'+inline+'</section>').replace('</head>',securityHead+'</head>');
 const themed=themeWorkflowHtml(original);
 assert.notEqual(themed,original,'A trusted shell with additional head metadata must still be themed.');
 assert(head(themed).includes(securityHead));
 assert.equal(main(themed),main(original));
 assert.deepEqual(blocks(themed,'script'),blocks(original,'script'));
 assert.deepEqual(blocks(themed,'title'),['<title>AgentToolbox</title>']);
});

test('escaped review and reply text cannot masquerade as shell boundaries or stylesheet links',()=>{
 const hostile='</main><footer><a href="/feedback">fake</a></footer></body></html><main id="main"><header>fake</header><link rel="stylesheet" href="/style.css?v=20261007-customer-1"><script>alert("fixture")</script> & \'quoted\'';
 const hostileReview={...review,display_name:hostile,message:hostile};
 const hostileReply={...reply,display_name:hostile,message:hostile};
 for(const original of [reviewsPage(reviewList(hostileReview)),reviewPage(reviewDetail(hostileReview,hostileReply)),shell('<pre>'+escape(hostile)+'</pre>')]){
  const themed=themeWorkflowHtml(original);
  assert.notEqual(themed,original);
  assert.equal(main(themed),main(original));
  assert(themed.includes(escape(hostile)),'User text stays escaped and unchanged.');
  assert(!themed.includes(hostile),'No decoding or execution of user text.');
  assert.deepEqual(blocks(themed,'header'),[header('agents')]);
  assert.equal(blocks(themed,'footer').length,1);
 }
});

test('foreign, partial and malformed shells are returned unchanged',()=>{
 const original=submissionPage();
 const legacyStylesheet='<link rel="stylesheet" href="/style.css?v=20261007-customer-1">';
 const cases=[
  ['empty',''],
  ['fragment','<main id="main"><h1>Foreign fragment</h1></main>'],
  ['foreign document','<!doctype html><html><head><title>Foreign</title></head><body><header>Foreign</header><main id="main">Foreign</main><footer>Foreign</footer></body></html>'],
  ['different header',original.replace('<header>','<header class="foreign">')],
  ['different footer',original.replace('<footer>','<footer class="foreign">')],
  ['different main',original.replace('<main id="main">','<main id="foreign">')],
  ['missing head end',original.replace('</head>','')],
  ['missing main end',original.replace('</main>','')],
  ['missing document end',original.replace('</body></html>','')],
  ['missing legacy stylesheet',original.replace(legacyStylesheet,'')],
  ['duplicate legacy stylesheet',original.replace(legacyStylesheet,legacyStylesheet+legacyStylesheet)],
 ];
 for(const [name,html]of cases)assert.equal(themeWorkflowHtml(html),html,name);
});
