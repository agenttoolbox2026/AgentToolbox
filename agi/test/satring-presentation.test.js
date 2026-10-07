import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../src/generated.json' with {type:'json'};
import {taskNavigation} from '../src/header.js';
import {homePage,buyPage,sellPage,toolPage,catalogPage,renderMarkdown} from '../src/pages.js';
import {homeMarkdown,buyMarkdown,sellMarkdown,catalogMarkdown} from '../src/machine.js';
import {selectCatalog} from '../src/catalog.js';
import {submissionPage} from '../../platform/src/pages.js';
import {themeWorkflowHtml} from '../src/workflow-theme.js';

const links=html=>[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
const code=html=>[...html.matchAll(/<pre>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/g)].map(match=>match[1]);
test('task navigation selects route families and preserves exact task destinations',()=>{
 for(const [path,active]of [['/','/'],['/tools?q=test','/tools'],['/tools/docs-pack/checks','/tools'],['/submit-tool','/sell'],['/update-tool','/sell'],['/creator-wallet','/creator-wallet'],['/referrals','/referrals']]){
  const html=taskNavigation(path);
  assert.equal((html.match(/aria-current="page"/g)??[]).length,1,path);
  assert(html.includes('href="'+active+'" aria-current="page"'),path);
  assert.deepEqual(links(html),['/','/tools','/buy','/sell','/creator-wallet','/referrals']);
 }
});
test('catalog groups bounded records without swallowing pagination, links or hostile text',()=>{
 const selection=selectCatalog(model,new URLSearchParams('q=AgentToolbox&limit=2'));
 const html=catalogPage(model,selection),canonical=renderMarkdown(catalogMarkdown(model,selection));
 assert.equal((html.match(/<article class="tool-record">/g)??[]).length,2);
 assert.equal((html.match(/<\/article>/g)??[]).length,2);
 assert(!html.includes('</article>/p>'));
 for(const href of links(canonical))assert(links(html).includes(href),href);
 for(const tool of selection.tools){assert(html.includes(tool.id));assert(html.includes(tool.price_label));assert(html.includes(tool.provider.name));}
 assert(html.includes('name="limit" value="2"'));
 assert(html.includes('href="/tools?limit=2">Clear search'));
 assert(html.indexOf('<h1')<html.indexOf('<form class="catalog-search"'));
 const empty=catalogPage(model,selectCatalog(model,new URLSearchParams('q=no-such-tool')));
 assert(empty.includes('No matching tools'));assert(!empty.includes('<article'));
});
test('HTML introductions motivate action while preserving canonical machine guides and code bytes',()=>{
 const pages=[[homePage(model),homeMarkdown(model)],[buyPage(model),buyMarkdown(model)],[sellPage(model),sellMarkdown(model)]];
 for(const [html,markdown]of pages){
  assert.deepEqual(code(html),code(renderMarkdown(markdown)));
  for(const href of links(renderMarkdown(markdown)))assert(links(html).includes(href),href);
 }
 assert(homePage(model).includes('Inspect its defined result and disclosed price'));
 assert(!homeMarkdown(model).includes('Inspect its defined result and disclosed price'));
 assert(buyPage(model).includes('No response time is promised'));
 assert(sellPage(model).includes('earning requires a separately reviewed, published implementation and qualifying paid sales'));
 assert(!sellMarkdown(model).includes('Stages:'));
});
test('tool metadata keeps source facts and payloads and conditions preview language on actual support',()=>{
 for(const tool of model.tools){
  const html=toolPage(model,tool);
  assert(html.includes('<dl class="metadata-table">'));
  assert(html.includes(tool.id));assert(html.includes(tool.price_label));assert(html.includes(tool.provider.name));
  const hasPreview=!!(tool.links.preview&&tool.links.prepare);
  assert.equal(html.includes('Optional higher/prepared quote:'),hasPreview);
  assert.equal(html.includes('Optional higher-amount quote:'),!hasPreview);
  if(!hasPreview)assert(html.includes('No prepared-result preview is offered for this tool'));
 }
});
test('seller groups preserve form controls, authorization boundaries and explicit prepare/send guidance',()=>{
 const html=themeWorkflowHtml(submissionPage(),'/submit-tool');
 assert(html.includes('href="/sell" aria-current="page"'));
 for(const text of ['1. Tool metadata','2. Proposed contract','3. Private management capability','First click: prepare','Second click: send','earnings require qualifying paid sales','never an automatically executed endpoint'])assert(html.includes(text),text);
 for(const name of ['name','summary','endpoint_url','input_schema','output_schema','capability','consent'])assert(html.includes('name="'+name+'"'),name);
 assert(html.includes('type="password"'));assert(html.includes('method="post" action="/v1/tool-submissions"'));
 assert(html.includes('<button type="submit" hidden>Prepare submission'));
});
