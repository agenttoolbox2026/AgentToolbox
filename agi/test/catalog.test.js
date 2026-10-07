import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/model.js';
import {selectCatalog,CatalogQueryError,CATALOG_LIMITS} from '../src/catalog.js';
import {homeMarkdown,catalogMarkdown,toolMarkdown,compactManifest,toolManifest} from '../src/machine.js';
import {renderMarkdown} from '../src/pages.js';

const params=value=>new URLSearchParams(value);
const model=await createModel();
const seed=model.tools.find(tool=>tool.id==='contract-cases');
const clone=(id,extra={})=>({...seed,id,name:'Tool '+id,summary:'A bounded test helper.',...extra});
const large={...model,tools:Array.from({length:1000},(_,index)=>clone(String(index).padStart(4,'0')))};

test('catalog admits current published tools and excludes private or unavailable records',()=>{
 const current=selectCatalog(model);
 assert.equal(current.total,4);
 assert.deepEqual(current.tools.map(tool=>tool.id),['contract-cases','docs-pack','mcp-wirecheck','quote-proof']);
 const excluded=[
  clone('proposal',{status:'approved'}),clone('retired',{status:'retired'}),
  clone('disabled',{pricing:{...seed.pricing,payments_enabled:false}}),
  clone('unconfigured',{pricing:{...seed.pricing,payments_configured:false}}),
  clone('no-invoke',{invocation:null}),clone('no-contract',{input_schema:null}),
  clone('no-checks',{outcome:{...seed.outcome,criteria:null}}),clone('no-creator',{provider:null}),
 ];
 const catalog=selectCatalog({...model,tools:[...model.tools,...excluded],submissions:[clone('private-active')]});
 assert.equal(catalog.total,4);
 assert(catalog.tools.every(tool=>model.tools.includes(tool)));
});

test('a thousand tools produce bounded, deterministic pages and complete navigation',()=>{
 const first=selectCatalog(large);
 assert.equal(first.tools.length,20);assert.equal(first.total,1000);
 assert.equal(first.pageCount,50);assert.equal(first.start,1);assert.equal(first.end,20);
 assert.equal(first.previousUrl,null);assert.equal(first.nextUrl,'/tools?page=2');
 const second=selectCatalog(large,new URL(first.nextUrl,'https://example.test').searchParams);
 assert.equal(second.start,21);assert.equal(second.end,40);assert.equal(second.previousUrl,'/tools');
 assert.equal(new Set([...first.tools,...second.tools].map(tool=>tool.id)).size,40);
 const last=selectCatalog(large,params('page=999999'));
 assert.equal(last.page,50);assert.equal(last.nextUrl,null);assert.equal(last.end,1000);
 const maximum=selectCatalog(large,params('limit=1000'));
 assert.equal(maximum.limit,CATALOG_LIMITS.max_limit);assert.equal(maximum.tools.length,50);
 assert.equal(maximum.nextUrl,'/tools?page=2&limit=50');
 const reversed=selectCatalog({...large,tools:[...large.tools].reverse()});
 assert.deepEqual(first.tools.map(tool=>tool.id),reversed.tools.map(tool=>tool.id));
 const tie=selectCatalog({...model,tools:[clone('z',{name:'Same'}),clone('a',{name:'same'})]});
 assert.deepEqual(tie.tools.map(tool=>tool.id),['a','z']);
});

test('search uses public purpose and creator fields and keeps filters on navigation',()=>{
 const tools=Array.from({length:25},(_,i)=>clone(String(i).padStart(2,'0'),{
  summary:'Inspect boundary coverage.',provider:{id:'independent-lab',name:'Independent Lab',type:'creator'},
 }));
 const selected=selectCatalog({...model,tools},params('q=  Independent   BOUNDARY &limit=10'));
 assert.equal(selected.query,'Independent BOUNDARY');assert.equal(selected.total,25);
 assert.equal(selected.nextUrl,'/tools?q=Independent+BOUNDARY&page=2&limit=10');
 const next=selectCatalog({...model,tools},new URL(selected.nextUrl,'https://example.test').searchParams);
 assert.equal(next.previousUrl,'/tools?q=Independent+BOUNDARY&limit=10');
 const none=selectCatalog(model,params('q=does-not-exist&page=8'));
 assert.equal(none.total,0);assert.equal(none.page,1);assert.equal(none.start,0);assert.equal(none.end,0);
 assert.equal(none.nextUrl,null);assert.equal(none.previousUrl,null);
});

test('catalog query bounds reject malformed input and never carry unrelated parameters',()=>{
 for(const input of ['page=0','page=-1','page=1.2','page=1abc','page=9007199254740992',
  'limit=0','limit=1e2','q=a&q=b','page=1&page=2','limit=10&limit=20'])
  assert.throws(()=>selectCatalog(model,params(input)),error=>error instanceof CatalogQueryError&&error.status===400&&error.code==='invalid_catalog_query');
 assert.throws(()=>selectCatalog(model,params({q:'x'.repeat(121)})),CatalogQueryError);
 assert.doesNotThrow(()=>selectCatalog(model,params({q:'x'.repeat(120)})));
 const selected=selectCatalog(large,params('page=2&capability=private-sentinel'));
 for(const link of [selected.nextUrl,selected.previousUrl,selected.canonicalUrl])assert(!link.includes('sentinel'));
});

test('catalog documents stay bounded and preserve creator attribution and useful routes',()=>{
 const selected=selectCatalog(large),markdown=catalogMarkdown(large,selected);
 assert.equal((markdown.match(/^## \[/gm)??[]).length,20);
 assert.equal((markdown.match(/^Creator:/gm)??[]).length,20);
 assert(markdown.length<20000);
 const thirdParty=clone('independent',{provider:{id:'independent-lab',name:'Independent Lab',type:'creator'}});
 const custom={...model,tools:[thirdParty]};
 for(const document of [catalogMarkdown(custom,selectCatalog(custom)),toolMarkdown(custom,thirdParty)]){
  assert(document.includes('Creator: Independent Lab (`creator`)'));
  assert(!document.includes('first-party'));
  for(const suffix of ['/tools/independent','/tools/independent/checks','/tools/independent/examples'])assert(document.includes(suffix));
 }
 const current=catalogMarkdown(model,selectCatalog(model));
 for(const tool of model.tools){
  assert(current.includes('](/tools/'+tool.id+')'));
  assert(current.includes(tool.links.detail));assert(current.includes(tool.links.reviews));
 }
 assert(current.includes('8 supported hosts'));
 assert(current.includes('absent quotes and ambiguous repeated occurrences'));
 assert(current.includes('Auth-required, blocked, unsupported or unknown outcomes alone cannot'));
 const hostile=catalogMarkdown(model,selectCatalog(model,params({q:'<script>alert(1)</script> ` [x](javascript:alert(1))'})));
 assert.doesNotMatch(renderMarkdown(hostile),/<script|href="javascript:/i);
});

test('homepage and manifest remain bounded while all tool contracts stay discoverable',()=>{
 assert.equal(homeMarkdown(model),homeMarkdown(large));
 const home=homeMarkdown(model);
 for(const route of ['/tools','/buy','/sell','/reviews','/feedback'])assert(home.includes(']('+route+')'));
 for(const tool of model.tools)assert(!home.includes(tool.name));
 assert(home.includes('## Sell tools'));
 assert(home.includes('90% lifetime gross entitlement'));assert(home.includes('Payouts are unavailable'));
 const manifest=compactManifest(large);
 assert.equal(manifest.format,'agenttoolbox-frontdoor-v1');assert.equal(manifest.tools.length,20);
 assert.equal(manifest.total,1000);assert.equal(manifest.next,model.origin+'/tools.json?page=2');
 assert.equal(manifest.catalog_page,model.origin+'/tools');assert.equal(manifest.catalog_markdown,model.origin+'/tools.md');
 assert.equal(manifest.catalog_json,model.origin+'/tools.json');
 assert.equal(compactManifest(model).tools.length,4);
 assert.deepEqual(toolManifest(model,seed).provider,seed.provider);
 assert.equal(toolManifest(model,seed).success_contract_sha256_snapshot,seed.success_pin.sha256);
});

test('creator metadata stays literal Markdown even with brackets, newlines and backticks',()=>{
 const tool=clone('literal-metadata',{
  name:'Parser [v2]\n`safe`',summary:'[Not a link](https://example.invalid) with **literal** text.',
  provider:{id:'literal-lab',name:'Lab [A]\n`B`',type:'creator'},
 });
 const custom={...model,tools:[tool]};
 const markdown=catalogMarkdown(custom,selectCatalog(custom));
 assert(markdown.includes('[Parser \\[v2\\] \\`safe\\`](/tools/literal-metadata)'));
 assert(markdown.includes('Creator: Lab \\[A\\] \\`B\\`'));
 assert(markdown.includes('\\[Not a link\\](https://example.invalid) with \\*\\*literal\\*\\* text.'));
 const detail=toolMarkdown(custom,tool);
 assert(detail.includes('# Parser \\[v2\\] \\`safe\\` — AgentToolbox'));
 assert(!/^`safe`/m.test(markdown));assert(!/^`B`/m.test(detail));
});
