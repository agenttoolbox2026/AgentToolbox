import test from 'node:test';
import assert from 'node:assert/strict';
import model from '../src/generated.json' with {type:'json'};
import {buyPage,toolPage,catalogPage,documentPage,renderMarkdown} from '../src/pages.js';
import {buyMarkdown,toolMarkdown,catalogMarkdown} from '../src/machine.js';
import {contractDocument} from '../src/contract-documents.js';
import {selectCatalog} from '../src/catalog.js';
import {toolUseGuidance} from '../src/presentation-copy.js';

const links=html=>[...html.matchAll(/href="([^"]+)"/g)].map(match=>match[1]);
const payloads=html=>[...html.matchAll(/<pre>[\s\S]*?<code>([\s\S]*?)<\/code>[\s\S]*?<\/pre>/g)].map(match=>match[1]);
const main=html=>html.match(/<main[^>]*>([\s\S]*?)<\/main>/)?.[1]??'';

test('buyers can reach readable contracts and the canonical JSON from every tool record and guide',()=>{
 const catalog=catalogPage(model,selectCatalog(model));
 for(const tool of model.tools){
  const guide=toolPage(model,tool),base='/tools/'+tool.id;
  for(const html of [catalog,guide]){
   assert(links(html).includes(base+'/contract'));
   assert(links(html).includes(base+'/checks'));
   assert(links(html).includes(base+'/examples'));
   assert(links(html).includes(tool.links.detail));
  }
  for(const kind of ['contract','checks','examples']){
   const source=contractDocument(model,tool,kind).markdown;
   const html=documentPage(model,source,base+'/'+kind);
   for(const href of links(renderMarkdown(source)))assert(links(html).includes(href),base+'/'+kind+' '+href);
   assert.deepEqual(payloads(html),payloads(renderMarkdown(source)),base+'/'+kind+' payload bytes');
   assert(html.includes('href="'+base+'/'+kind+'" aria-current="page"'));
   assert.doesNotMatch(html,/<script\b|<form\b/);
  }
  assert.deepEqual(payloads(guide),payloads(renderMarkdown(toolMarkdown(model,tool))));
  assert.equal(links(guide).includes(tool.links.preview),!!tool.links.preview);
  assert(main(guide).includes('class="inline-note tool-use-guidance"'));
 }
});

test('catalog gives the search and results priority while preserving filtering and all canonical links',()=>{
 for(const query of ['', 'q=AgentToolbox&limit=2', 'q=no-such-tool']){
  const selection=selectCatalog(model,new URLSearchParams(query)),html=catalogPage(model,selection);
  const records=html.indexOf('<article class="tool-record">');
  assert.equal((html.match(/class="catalog-context"/g)??[]).length,1,query);
  assert(html.indexOf('class="catalog-search"')<html.indexOf('class="catalog-context"'));
  assert(html.indexOf('class="catalog-links"')>html.indexOf('class="catalog-context"'));
  if(records!==-1){
   assert(html.indexOf('class="catalog-context"')<records);
   assert(html.indexOf('class="catalog-links"')>html.lastIndexOf('</article>'));
   assert(html.indexOf('class="catalog-syntax"')>html.lastIndexOf('</article>'));
  }
  for(const href of links(renderMarkdown(catalogMarkdown(model,selection))))assert(links(html).includes(href),query+' '+href);
  assert(html.includes('name="q" value="'+selection.query+'"'));
  assert(html.includes('name="limit" value="'+selection.limit+'"'));
 }
});

test('buyer section navigation targets existing headings and preserves request payloads',()=>{
 const source=buyMarkdown(model),html=buyPage(model);
 const navigation=html.match(/<nav class="section-nav"[\s\S]*?<\/nav>/)?.[0];
 assert(navigation);
 for(const href of links(navigation))assert(html.includes('id="'+href.slice(1)+'"'),href);
 for(const href of links(renderMarkdown(source)))assert(links(html).includes(href),href);
 assert.deepEqual(payloads(html),payloads(renderMarkdown(source)));
 const breadcrumb=html.match(/<p class="back-link">[\s\S]*?<\/p>/)?.[0];
 assert.deepEqual(links(breadcrumb),['/','/tools']);
 const footer=html.match(/<footer class="document-footer">[\s\S]*?<\/footer>/)?.[0];
 assert(links(footer).includes('/reviews'));assert(links(footer).includes('/feedback'));
 assert(footer.includes('Built for agents, by agents.'));
});

test('choose/use guidance is restricted to recognized first-party tools',()=>{
 for(const tool of model.tools){
  assert(toolUseGuidance(tool));
  assert.equal(toolUseGuidance({...tool,provider:{id:'independent-lab',type:'creator',name:'Independent Lab'}}),null);
  assert.equal(toolUseGuidance({...tool,id:'another-published-tool'}),null);
 }
});
