import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {freeExampleManifest,FREE_EXAMPLE_PRODUCT_IDS} from '../src/free-examples.js';
import {createDocsPack} from '../src/docs-pack.js';
import {createQuoteProof} from '../src/quote-proof.js';
import {createContractCases} from '../src/contract-cases.js';
import {createMcpWireCheck} from '../src/mcp-wirecheck.js';

const require=createRequire(import.meta.url),sdkRequire=createRequire(require.resolve('@modelcontextprotocol/sdk/package.json'));
const Ajv=sdkRequire('ajv/dist/2020.js').default;
const ajv=new Ajv({allErrors:true,strict:false,ownProperties:true});
const sha=value=>createHash('sha256').update(value).digest('hex');
const atPointer=(value,pointer)=>pointer===''?value:pointer.slice(1).split('/').reduce((v,part)=>v[part.replaceAll('~1','/').replaceAll('~0','~')],value);

function fixtureHandler(productId,example,fixedClock){
 const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
  assert.equal(new Headers(options.headers).has('Authorization'),false);
  assert.equal(new Headers(options.headers).has('PAYMENT-SIGNATURE'),false);
  assert.equal(new Headers(options.headers).has('Cookie'),false);
  if(example.fixture.kind==='http_responses'){
   assert.equal(options.method,'GET');
   const reply=example.fixture.responses.find(row=>row.url===url);assert.ok(reply,'Unexpected fixture URL: '+url);
   calls.push({url});return new Response(reply.body,{status:reply.status,headers:reply.headers});
  }
  assert.equal(example.fixture.kind,'rpc_sequence','Unexpected network request');
  const request=JSON.parse(options.body),expected=example.fixture.requests[calls.length];
  assert.ok(expected,'Extra MCP request');assert.equal(url,example.input.endpoint);assert.equal(options.method,'POST');
  assert.equal(request.method,expected.method);assert.equal(request.id??null,expected.request_id);
  const version=request.params?.protocolVersion??request.params?._meta?.['io.modelcontextprotocol/protocolVersion']??options.headers['MCP-Protocol-Version'];
  assert.equal(version,expected.protocol_version);assert.notEqual(request.method,'tools/call');
  calls.push({url,request});
  return new Response(expected.response.body,{status:expected.response.status,headers:expected.response.headers});
 };
 const now=()=>new Date(fixedClock);
 const factory={'docs-pack':()=>createDocsPack({fetcher,now}),'quote-proof':()=>createQuoteProof({fetchImpl:fetcher,now}),'contract-cases':()=>createContractCases(),'mcp-wirecheck':()=>createMcpWireCheck({fetchImpl:fetcher,now})};
 return {handler:factory[productId](),calls};
}

test('all four static fixture manifests are bounded, first-party, read-only and explicitly non-live',()=>{
 assert.deepEqual(FREE_EXAMPLE_PRODUCT_IDS,['docs-pack','quote-proof','contract-cases','mcp-wirecheck']);
 for(const id of FREE_EXAMPLE_PRODUCT_IDS){
  const manifest=freeExampleManifest(id);assert.equal(manifest.product_id,id);assert.equal(manifest.publisher,'AgentToolbox');
  assert.equal(manifest.provenance,'first_party_synthetic_fixture');assert.equal(manifest.execution,'none');
  assert.deepEqual(manifest.payment,{status:'not_required',amount_settled_atomic:'0'});
  assert.match(manifest.interpretation,/not live remote observations/);assert.match(manifest.expected_format,/unlisted fields are not asserted/);
  assert.ok(new TextEncoder().encode(JSON.stringify(manifest)).length<16384,id+' exceeds response budget');
  assert.ok(manifest.cases.some(c=>c.expected.outcome_qualifies));assert.ok(manifest.cases.some(c=>!c.expected.input_valid));
  assert.ok(Object.isFrozen(manifest.cases[0].input));assert.throws(()=>{manifest.cases[0].input.modified=true;},TypeError);
 }
 for(const id of ['retry-gate','unknown','__proto__','constructor'])assert.equal(freeExampleManifest(id),null);
 assert.equal(freeExampleManifest('quote-proof').real_input_preview.supported,false);
 assert.equal(freeExampleManifest('mcp-wirecheck').real_input_preview.supported,false);
});

for(const id of FREE_EXAMPLE_PRODUCT_IDS){
 const manifest=freeExampleManifest(id);
 for(const example of manifest.cases)test(id+': published '+example.id+' expectations agree with actual handler',async()=>{
  const {handler,calls}=fixtureHandler(id,example,manifest.fixed_clock),input=handler.input.safeParse(example.input);
  assert.equal(input.success,example.expected.input_valid);
  if(!input.success){assert.equal(calls.length,0);return;}
  if(example.expected.failure_reason){
   await assert.rejects(handler.run(input.data),error=>handler.failureReason(error)===example.expected.failure_reason);
   return;
  }
  const output=await handler.run(input.data);
  assert.equal(handler.output.safeParse(output).success,true);
  assert.equal(await handler.success(output),example.expected.outcome_qualifies);
  for(const check of example.expected.checks)assert.deepEqual(atPointer(output,check.pointer),check.value,check.pointer);
  if(example.fixture.kind==='rpc_sequence')assert.equal(calls.length,example.fixture.requests.length);

  if(id==='docs-pack'){
   const sourceText=example.fixture.responses.find(row=>row.url===example.input.urls[0]).body;
   const normalized=sourceText.trim();
   assert.equal(output.sources[0].source_sha256,sha(sourceText));assert.equal(output.sources[0].text_sha256,sha(normalized));
   for(const excerpt of output.sources[0].excerpts){assert.equal(normalized.slice(excerpt.start_char,excerpt.end_char),excerpt.text);assert.ok(excerpt.text.toLowerCase().includes(example.input.query));}
  }
  if(id==='quote-proof'&&example.expected.outcome_qualifies){
   const sourceText=example.fixture.responses.find(row=>row.url===example.input.urls[0]).body;
   assert.equal(output.sources[0].content_sha256,sha(sourceText));
   const normalized=sourceText.replace(/\s+/gu,' ').trim();
   for(const result of output.results){
    const quote=example.input.quotes[result.quote_index].quote.replace(/\s+/gu,' ').trim();
    const first=normalized.indexOf(quote),second=first<0?-1:normalized.indexOf(quote,first+1);
    assert.equal(result.occurrences,first<0?'0':second<0?'1':'2_or_more');
    for(const evidence of result.evidence)assert.equal(sourceText.slice(evidence.start_char,evidence.end_char).replace(/\s+/gu,' ').trim(),quote);
   }
  }
  if(id==='contract-cases'){
   const validate=ajv.compile(example.input.schema);
   for(const row of output.cases){
    assert.equal(validate(row.value),row.expected_verdict==='valid');
    if(row.expected_verdict==='invalid'){assert.equal(validate.errors.length,1);assert.equal(validate.errors[0].keyword,row.keyword);assert.equal(validate.errors[0].schemaPath,'#'+row.schema_pointer);assert.equal(validate.errors[0].instancePath,row.instance_pointer);}
   }
  }
 });
}
