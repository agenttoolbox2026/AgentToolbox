import test from 'node:test';
import assert from 'node:assert/strict';
import {createModel} from '../src/model.js';
import {selectCatalog,CatalogQueryError,CATALOG_LIMITS} from '../src/catalog.js';
import {homeMarkdown,buyMarkdown,catalogMarkdown,toolMarkdown,compactManifest,toolManifest} from '../src/machine.js';
import {renderMarkdown,toolPage} from '../src/pages.js';
import {successContractPin} from '../../platform/src/contract-pins.js';
import {contractDocument} from '../src/contract-documents.js';

const params=value=>new URLSearchParams(value);
const model=await createModel();
const seed=model.tools.find(tool=>tool.id==='contract-cases');
const clone=(id,extra={})=>({...seed,id,name:'Tool '+id,summary:'A bounded test helper.',
 invocation:{...seed.invocation,path:`/v1/products/${id}/invoke`},...extra});
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
  assert.equal(tool.maturity,'beta');assert.equal(tool.experimental,false);
  for(const document of [toolMarkdown(model,tool),...['contract','checks','examples'].map(kind=>contractDocument(model,tool,kind).markdown)]){
   assert(document.includes('Beta.'));assert(!document.includes('Experimental.'));
  }
 }
 assert.equal((current.match(/Beta\./g)??[]).length,4);
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
 assert(home.includes('90% lifetime gross entitlement'));assert(home.includes('[Creator payouts](/creator-wallet)'));assert(home.includes('Payouts require owner approval'));
 const manifest=compactManifest(large);
 assert.equal(manifest.format,'agenttoolbox-frontdoor-v1');assert.equal(manifest.tools.length,20);
 assert.equal(manifest.total,1000);assert.equal(manifest.next,model.origin+'/tools.json?page=2');
 assert.equal(manifest.catalog_page,model.origin+'/tools');assert.equal(manifest.catalog_markdown,model.origin+'/tools.md');
 assert.equal(manifest.catalog_json,model.origin+'/tools.json');
 assert.equal(compactManifest(model).tools.length,4);
 assert(compactManifest(model).tools.every(tool=>tool.maturity==='beta'&&tool.experimental===false));
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

// Local presentation fixture only. It is not added to the production registry,
// installed as an adapter, fetched, executed, submitted or published.
const sellerContract={
 id:'creator-presentation-fixture',name:'Boundary [helper]',version:'1.0.0',status:'active',maturity:'beta',experimental:false,
 summary:'Check a bounded integer input against a fixed outcome.',
 provider:{id:'fixture-lab',name:'Fixture [Lab]',type:'creator'},
 pricing:{...seed.pricing},
 invocation:{method:'POST',path:'/v1/products/creator-presentation-fixture/invoke',transport:'http'},
 input_schema:{type:'object',properties:{value:{type:'integer',minimum:0,maximum:9}},required:['value'],additionalProperties:false},
 output_schema:{type:'object',properties:{ok:{const:true}},required:['ok'],additionalProperties:false},
 limits:{max_output_bytes:64},
 outcome:{success_criterion:'The output passes its schema and ok equals true.',criteria:{
  criteria_version:'1',rule_language:'agenttoolbox-predicate-v1',rules:[{id:'ok_required',test:{eq:[{path:'ok'},true]}}],
 }},
};

test('a compiled seller contract renders without invented scope, examples, preview or execution',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('Presentation must not fetch or execute a tool.');});
 const compiled=await createModel({catalog:[sellerContract],registryVersion:'local-presentation-fixture'});
 const seller=compiled.tools[0];
 assert.equal(compiled.tools.length,1);assert.deepEqual(seller.provider,sellerContract.provider);
 assert.equal(seller.fit,sellerContract.summary);assert.equal(seller.scope,null);
 assert.deepEqual(seller.preview,{supported:false});
 for(const link of ['examples','preview','prepare','quote'])assert.equal(seller.links[link],null);
 assert.deepEqual(seller.success_pin,await successContractPin(sellerContract));
 assert.equal(selectCatalog(compiled).total,1);
 for(const document of [catalogMarkdown(compiled,selectCatalog(compiled)),toolMarkdown(compiled,seller),buyMarkdown(compiled)]){
  assert(!document.includes('undefined'));assert(!document.includes('null'));
  assert(!document.includes('Public canonical workers.dev endpoints'));
  assert(!document.includes('/tools/'+seller.id+'/examples'));
  assert(!document.includes('Limited real-input preview:'));
 }
 assert(!toolMarkdown(compiled,seller).includes('## Example input'));
 assert(buyMarkdown(compiled).includes('No example input is published for the current catalog'));
 const html=toolPage(compiled,seller);
 assert(html.includes('Fixture [Lab]'));assert(html.includes('Boundary [helper]'));
 assert(!html.includes('first-party'));
 const manifest=compactManifest(compiled).tools[0];
 assert.deepEqual(manifest.provider,sellerContract.provider);assert.equal(manifest.scope,null);
 assert.equal(manifest.preview_supported,false);assert.equal(manifest.examples,null);
 assert.equal(contractDocument(compiled,seller,'examples'),null);
 assert.equal(contractDocument(compiled,{...seller,provider:null},'checks'),null);
 for(const kind of ['checks','contract']){
  const document=contractDocument(compiled,seller,kind).markdown;
  assert(!document.includes('[Synthetic examples]'));assert.doesNotMatch(document,/(?:^|:\s*)undefined\b/m);assert(!document.includes('Scope: null'));
  assert(document.includes('Created by: Fixture \\[Lab\\] (creator)'));
 }
 assert.equal((await createModel()).tools.length,4,'Local fixture must not alter the production registry.');
});

test('published seller metadata is preserved and optional routes fail closed',async()=>{
 const source={...sellerContract,fit:'Use this exact published fit.',scope:'One integer from zero through nine.',
  examples_url:'/v1/products/'+sellerContract.id+'/examples',example_input:{value:3},
  preview:{supported:true,path:'https://private-proposal.example/run',page:'https://private-proposal.example/preview'},
  quote:{path:'https://private-proposal.example/quote'},
 };
 const compiled=await createModel({catalog:[source]}),seller=compiled.tools[0];
 assert.equal(seller.fit,source.fit);assert.equal(seller.scope,source.scope);
 assert.equal(seller.links.examples,null,'An input sample does not create an available fixture route.');
 assert.equal(seller.links.preview,null);assert.equal(seller.links.prepare,null);assert.equal(seller.links.quote,null);
 const document=toolMarkdown(compiled,seller);
 assert(document.includes('## Example input'));assert(!document.includes('private-proposal.example'));
 assert(!catalogMarkdown(compiled,selectCatalog(compiled)).includes('[Synthetic examples]'));
});

test('incomplete or ambiguous compiled publication metadata cannot enter the model',async()=>{
 const mutations=[{provider:null},{provider:{id:'lab',name:' ',type:'creator'}},{summary:''},
  {pricing:{...seed.pricing,minimum_amount_atomic:null}},{pricing:{...seed.pricing,currency:'UNKNOWN'}},
  {input_schema:null},{outcome:{success_criterion:'Unavailable',criteria:{rules:[]}}},
  {invocation:{method:'POST',path:'https://private-proposal.example/run'}},{status:'approved'},
 ];
 const invalid=mutations.map((mutation,i)=>({...sellerContract,id:'invalid-'+i,
  invocation:{method:'POST',path:'/v1/products/invalid-'+i+'/invoke'},...mutation}));
 const compiled=await createModel({catalog:[sellerContract,...invalid]});
 assert.deepEqual(compiled.tools.map(tool=>tool.id),[sellerContract.id]);
 await assert.rejects(createModel({catalog:[sellerContract,{...sellerContract}]}),/unique/);
});

test('fallback atomic prices normalize once for manifests and complete buyer examples',async()=>{
 const {minimum_amount_atomic,...pricing}=sellerContract.pricing;
 for(const amount_atomic of ['25000',25000]){
  const source={...sellerContract,pricing:{...pricing,amount_atomic},example_input:{value:3}};
  const compiled=await createModel({catalog:[source]}),seller=compiled.tools[0];
  assert.equal(seller.pricing.minimum_amount_atomic,'25000');
  assert.equal(seller.price_label,'$0.025 USDC');
  assert.equal(compactManifest(compiled).tools[0].minimum_amount_atomic,'25000');
  const request=JSON.parse(buyMarkdown(compiled).match(/```http\n[^]*?\n\n(\{[^]*?\})\n```/)[1]);
  assert.equal(request.max_charge_usdc_atomic,'25000');
  assert.equal(request.version,source.version);assert.deepEqual(request.input,source.example_input);
  assert.equal(source.pricing.minimum_amount_atomic,undefined,'Normalization must not mutate the canonical source.');
  assert.deepEqual(seller.success_pin,await successContractPin(source));
 }
 const current=await createModel();
 assert.equal(current.tools.length,4);
 for(const tool of current.tools)assert.deepEqual(tool.pricing,model.tools.find(original=>original.id===tool.id).pricing);
});
