import test from 'node:test';
import assert from 'node:assert/strict';
import {createPlatform} from '../src/app.js';
import {database} from '../scripts/local-db.js';
import {products} from '../src/registry.js';
import {feedbackPage,previewPage,reviewPage,reviewsPage,submissionPage,updatePage} from '../src/pages.js';

const product=products.find(entry=>entry.id==='docs-pack');
const review={review_id:'00000000-0000-4000-8000-000000000001',product_id:product.id,version:product.version,
 display_name:'Local fixture',message:'Local fixture review',created_at:'2026-10-08T00:00:00Z',badge:'Unverified',rating:null};

test('browser workflow errors retain safe navigation while explicit JSON and API errors retain JSON',async()=>{
 const db=database();try{
  const app=createPlatform({db,origin:'https://local.example.invalid',trackingEnabled:false});
  for(const route of ['/feedback?tool=missing','/products/missing/preview','/products/missing/reviews','/reviews/00000000-0000-4000-8000-000000000001']){
   const response=await app(new Request('https://local.example.invalid'+route));assert.equal(response.status,404);assert.match(response.headers.get('Content-Type'),/^text\/html/);
   const body=await response.text();assert.match(body,/<title>AgentToolbox<\/title>/);assert.match(body,/Unable to open this page/);assert.match(body,/Open the toolbox/);assert(!body.includes('class="feedback-form"'));
   const json=await app(new Request('https://local.example.invalid'+route,{headers:{Accept:'application/json'}}));assert.equal(json.status,404);assert.match(json.headers.get('Content-Type'),/^application\/json/);assert((await json.json()).error.code);
   const head=await app(new Request('https://local.example.invalid'+route,{method:'HEAD'}));assert.equal(head.status,404);assert.equal(await head.text(),'');
  }
  const limited=createPlatform({db,origin:'https://local.example.invalid',limit:async()=>false});const response=await limited(new Request('https://local.example.invalid/feedback'));assert.equal(response.status,429);assert.equal(response.headers.get('Retry-After'),'60');assert.match(await response.text(),/Wait before retrying/);
 }finally{db.close();}
});

test('version filtering has a native GET form, scoped empty state and an unfiltered recovery link',async()=>{
 const db=database();
 try{
  const app=createPlatform({db,origin:'https://local.example.invalid',trackingEnabled:false});
  const response=await app(new Request('https://local.example.invalid/products/docs-pack/reviews?version=9.9.9'));
  const html=await response.text();
  assert.equal(response.status,200);
  assert.match(html,/<form class="review-filters" method="get" action="\/products\/docs-pack\/reviews">/);
  assert.match(html,/<input name="version" value="9\.9\.9"[^>]*required/);
  assert.match(html,/No public reviews for version 9\.9\.9\./);
  assert.match(html,/href="\/products\/docs-pack\/reviews\?status=all">Clear version filter/);
  assert.match(html,/href="\/v1\/products\/docs-pack\/reviews\?status=active&amp;version=9\.9\.9"/);
  assert.match(html,/name="version" value="9\.9\.9"/,'Publication retains the explicitly selected version.');
  assert.match(html,/href="\/feedback\?tool=docs-pack"/);
  assert.match(html,/href="\/reviews">← Choose a tool/);
  assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_reviews').get().n,0,'Filter navigation must not write reviews.');
 }finally{db.close();}
});

test('empty unfiltered reviews and replies offer a next step without inventing ratings',()=>{
 const html=reviewsPage({product_id:product.id,status:'active',version:null,reviews:[],next_cursor:null,
  aggregates:[{badge:'Verified purchase',average_rating:null,rated:0,reviews:0}]});
 assert.match(html,/No public reviews yet\. You can write the first review below\./);
 assert.match(html,/<strong>Verified purchase<\/strong><span>No ratings<\/span><small>0 ratings · 0 reviews/);
 assert.match(html,/including repeat purchases—not unique buyers/);
 assert.match(reviewPage({review,replies:[],next_cursor:null}),/No replies yet\. You can add the first reply below\./);
});

test('reply controls start hidden without scripts and expose an escaped target name with a reset hook',()=>{
 const html=reviewPage({review,replies:[{reply_id:'00000000-0000-4000-8000-000000000002',display_name:'Name "<fixture>',
  message:'Local reply',badge:'Unverified',same_purchase_as_review:false,parent_reply_id:null,created_at:'2026-10-08T01:00:00Z'}],next_cursor:null});
 assert.match(html,/data-reply-to="[^"]+" data-reply-name="Name &quot;&lt;fixture&gt;" hidden>Reply to this/);
 assert.match(html,/<p class="reply-target" aria-live="polite">Replying to the review<\/p>/);
 assert.match(html,/<button type="button" data-clear-reply hidden>Reply to the review<\/button>/);
 assert.match(html,/<form class="review-form" method="post" action="\/v1\/reviews\/[^"]+\/replies"/);
 assert.match(html,/name="consent" required/);
 assert.match(html,/<textarea name="message" maxlength="1000"/);
 assert(html.indexOf('<noscript>')<html.indexOf('<form class="review-form"'));
});

test('API/no-script guidance precedes private fields and JS-only seller controls are hidden by default',()=>{
 const feedback=feedbackPage(products,product);
 assert(feedback.indexOf('POST /v1/feedback')<feedback.indexOf('<form class="feedback-form"'));
 assert(feedback.indexOf('<noscript>')<feedback.indexOf('<form class="feedback-form"'));
 assert.match(feedback,/<form class="feedback-form" method="post" action="\/v1\/feedback"/);
 for(const [html,className] of [[submissionPage(),'submission-form'],[updatePage(),'tool-update-form']]){
  assert(html.indexOf('<noscript>')<html.indexOf('<form class="'+className+'"'));
  for(const button of html.matchAll(/<button\b[^>]*data-(?:generate-creator|copy-creator|copy-request|restore-request)\b[^>]*>/g))
   assert.match(button[0],/\bhidden\b/,'Inert controls must not appear when scripts are unavailable.');
  assert.match(html,/90% lifetime gross/);
  assert.match(html,/name="capability" autocomplete="off"/);
 }
 assert.match(submissionPage(),/form class="submission-form" method="post" action="\/v1\/tool-submissions"/);
});

test('preview recovery sequence and buyer guide remain visible with JavaScript enabled',()=>{
 const html=previewPage(product),scriptView=html.replace(/<noscript>[\s\S]*?<\/noscript>/g,'');
 assert.match(scriptView,/save its private context, request an exact quote, then use the paid HTTP invocation/);
 assert.match(scriptView,/href="\/buy#optional-real-input-previews">Buyer preview guide/);
 assert(scriptView.indexOf('Buyer preview guide')<scriptView.indexOf('<form class="preview-form"'));
 assert(html.indexOf('<noscript>')<html.indexOf('<form class="preview-form"'));
 assert.match(html,/It expires after 15 minutes/);
 assert.match(html,/this form does not request payment/);
 assert.match(html,/<form class="preview-form" method="post" action="\/v1\/products\/docs-pack\/prepare"/);
});
