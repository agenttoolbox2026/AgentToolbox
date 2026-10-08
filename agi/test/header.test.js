import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {homePage,buyPage,sellPage,toolPage,notFoundPage} from '../src/pages.js';
import {humansPage} from '../src/humans.js';

const model=JSON.parse(await readFile(new URL('../src/generated.json',import.meta.url),'utf8'));
const agents=[homePage(model),buyPage(model),sellPage(model),toolPage(model,model.tools[0]),notFoundPage(model)];
const humans=humansPage(model,{lifetime_paid_purchases:0});
const getHeader=html=>html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
const normalizeAudience=html=>html.replaceAll(' aria-current="page"','');

test('every audience page shares the same visible header and local navigation',()=>{
 const expected=normalizeAudience(getHeader(humans));
 assert(expected,'Humans must render a header.');
 for(const html of [...agents,humans]){
  const header=getHeader(html);
  assert.equal(normalizeAudience(header),expected);
  assert.equal((header.match(/aria-current="page"/g)??[]).length,1);
  assert.match(header,/href="\/"[^>]*>For Agents<\/a>/);
  assert.match(header,/href="\/humans"[^>]*>For Humans<\/a>/);
  assert.match(header,/<img src="\/agenttoolbox-icon\.png" alt="" width="2000" height="2000">/);
  assert.match(html,/<title>AgentToolbox<\/title>/);
  assert.doesNotMatch(header,/<script\b|\bstyle=|\bhidden\b|aria-hidden=/);
 }
 for(const html of agents){
  assert.match(getHeader(html),/href="\/" aria-current="page">For Agents/);
  assert.match(html,/<footer class="document-footer">[\s\S]*Built for agents, by agents\.[\s\S]*<\/footer>/);
 }
 assert.match(getHeader(humans),/href="\/humans" aria-current="page">For Humans/);
});

test('shared header CSS retains the approved white header and page fonts match',async()=>{
 const [shared,agent,human]=await Promise.all(['header.css','style.css','humans.css'].map(file=>readFile(new URL('../public/'+file,import.meta.url),'utf8')));
 assert.match(shared,/\.site-header\{background:#fff;color:#111\}/);
 assert.match(shared,/\.header-inner\{max-width:872px;margin:auto;min-height:88px;padding:18px 20px;/);
 assert.match(shared,/\.brand-icon img\{position:absolute;width:190%;height:auto;max-width:none;left:-45%;top:-48%;mix-blend-mode:multiply\}/);
 assert.doesNotMatch(shared,/position:(?:fixed|sticky)/,'Keep the approved header scroll behavior.');
 for(const css of [agent,human])assert.doesNotMatch(css,/\.(?:site-header|header-inner|brand|brand-icon|audience-nav|humans-link)(?:\b|[\s.:[])/,'Header rules belong only to the shared stylesheet.');
 const rootFont=css=>css.match(/:root\{[^}]*\bfont:([^;]+);/)?.[1];
 const expected='15px/1.7 ui-monospace,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace';
 assert.equal(rootFont(agent),expected);
 assert.equal(rootFont(human),expected);
 for(const [,declarations]of human.matchAll(/\.purpose\{([^}]+)\}/g)){
  assert.doesNotMatch(declarations,/(?:font(?:-family)?|line-height):/);
  if(declarations.includes('font-size:'))assert.match(declarations,/(?:^|;)font-size:15px(?:;|$)/);
 }
});

test('only the current audience has a persistent underline, with visible hover and focus states',async()=>{
 const css=await readFile(new URL('../public/header.css',import.meta.url),'utf8');
 const base=css.match(/\.humans-link\{([^}]+)\}/)?.[1];
 const current=css.match(/\.humans-link\[aria-current="page"\]\{([^}]+)\}/)?.[1];
 assert.match(base,/(?:^|;)text-decoration:none(?:;|$)/);
 assert.match(current,/(?:^|;)text-decoration:underline(?:;|$)/);
 assert.match(css,/\.humans-link:hover\{color:#555\}/);
 assert.match(css,/\.site-header a:focus-visible\{outline:2px solid #111;outline-offset:4px\}/);
 assert.doesNotMatch(css,/\.humans-link:hover\{[^}]*text-decoration:underline/);
});

test('both page types reference shared and page CSS by current content hashes',async()=>{
 for(const html of [...agents,humans]){
  const styles=[...html.matchAll(/<link rel="stylesheet" href="\/(header|style|humans)\.css\?v=([0-9a-f]{12})">/g)];
  assert.equal(styles.length,2);
  assert(styles.some(match=>match[1]==='header'));
  for(const [,name,hash]of styles){
   const css=await readFile(new URL('../public/'+name+'.css',import.meta.url));
   assert.equal(hash,createHash('sha256').update(css).digest('hex').slice(0,12),name+'.css');
  }
 }
});
