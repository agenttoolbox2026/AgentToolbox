import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createQuoteProof,quoteProofOutput} from '../src/quote-proof.js';
import {criteriaFor,passesCriteria} from '../src/criteria.js';
import {successContractPin} from '../src/contract-pins.js';
import {products} from '../src/registry.js';

const require=createRequire(import.meta.url),sdkRequire=createRequire(require.resolve('@modelcontextprotocol/sdk/package.json'));
const Ajv=sdkRequire('ajv/dist/2020.js').default,addFormats=sdkRequire('ajv-formats').default;
const ajv=new Ajv({strict:false,allErrors:true,ownProperties:true});addFormats(ajv);
const product=products.find(row=>row.id==='quote-proof'),pin=await successContractPin(product),document=JSON.parse(pin.canonical_json);
const validatesPublishedSchema=ajv.compile(document.output_schema);

// Independent buyer implementation of the documented language, compiled from
// decoded pinned JSON rather than the handler's private predicate evaluator.
function compileExpression(expression){
 const literal=value=>{
  if(Array.isArray(value)){value.forEach(literal);return;}
  assert(value===null||typeof value==='boolean'||typeof value==='string'||typeof value==='number'&&Number.isFinite(value),'Invalid predicate literal');
 };
 if(expression===null||typeof expression!=='object'||Array.isArray(expression)){literal(expression);return ()=>expression;}
 assert.equal(Object.keys(expression).length,1,'Expression must have exactly one operator');
 const [operator,argument]=Object.entries(expression)[0];
 if(operator==='path'){
  assert.equal(typeof argument,'string');assert(argument.length>0);const parts=argument.split('.');assert(parts.every(Boolean));
  return (output,variables={})=>argument==='$'?output:parts.slice(1).reduce((value,part)=>value?.[part],Object.hasOwn(variables,parts[0])?variables[parts[0]]:output?.[parts[0]]);
 }
 if(['count','json_bytes','not'].includes(operator)){
  const read=compileExpression(argument);
  return (output,variables)=>operator==='count'?read(output,variables)?.length:operator==='not'?!read(output,variables):Buffer.byteLength(JSON.stringify(read(output,variables)),'utf8');
 }
 if(['and','if','eq','gt','lte','subtract','add','in'].includes(operator)){
  assert(Array.isArray(argument));if(operator!=='and')assert.equal(argument.length,operator==='if'?3:2);
  const operands=argument.map(compileExpression);
  return (output,variables)=>{
   const read=index=>operands[index](output,variables);
   if(operator==='and')return operands.every(operand=>operand(output,variables));
   if(operator==='if')return read(0)?read(1):read(2);
   const left=read(0),right=read(1);
   return {eq:()=>left===right,gt:()=>left>right,lte:()=>left<=right,subtract:()=>left-right,add:()=>left+right,in:()=>right.includes(left)}[operator]();
  };
 }
 assert(['every','some','count_where'].includes(operator),'Unknown predicate operator');
 assert(argument&&typeof argument==='object'&&!Array.isArray(argument));
 const hasIndex=Object.hasOwn(argument,'index_as'),fields=['source','as','test',...(operator==='every'&&hasIndex?['index_as']:[])];
 assert.deepEqual(Object.keys(argument).sort(),fields.sort(),'Invalid iterator fields');
 assert.match(argument.as,/^[A-Za-z_][A-Za-z0-9_]*$/);
 if(hasIndex){assert.equal(operator,'every');assert.match(argument.index_as,/^[A-Za-z_][A-Za-z0-9_]*$/);assert.notEqual(argument.as,argument.index_as);}
 const source=compileExpression(argument.source),predicate=compileExpression(argument.test);
 return (output,variables={})=>{
  const rows=source(output,variables);if(!Array.isArray(rows))return false;
  const check=(row,index)=>predicate(output,{...variables,[argument.as]:row,...(hasIndex?{[argument.index_as]:index}:{})});
  if(operator==='every')return rows.every(check);
  if(operator==='some')return rows.some(check);
  return rows.filter(check).length;
 };
}
const compiledRules=document.criteria.rules.map(rule=>compileExpression(rule.test));
const publishedPasses=output=>compiledRules.every(rule=>rule(output));
const legacyPasses=output=>compiledRules.slice(0,2).every(rule=>rule(output));

const first='https://docs.python.org/3/quote-alpha.txt',second='https://docs.python.org/3/quote-second.txt',third='https://docs.python.org/3/quote-unavailable.txt';
const text='Alpha\n beta. Exact phrase. again again. 😀 end.',longer='z'.repeat(75)+'Second quote.'+'q'.repeat(20);
const pages=new Map([[first,{text}],[second,{text:longer}],[third,{text:'Unavailable',status:403}]]);
const handler=createQuoteProof({now:()=>new Date('2026-10-07T00:00:00.000Z'),fetchImpl:async url=>{
 if(url.endsWith('/robots.txt'))return new Response('',{status:404});
 assert(pages.has(url),'Unexpected fixture request: '+url);const page=pages.get(url);
 return new Response(page.text,{status:page.status??200,headers:{'Content-Type':'text/plain'}});
}});
const firstQuotes=['Exact phrase','Alpha beta','missing','again','😀 end'].map(quote=>({source_index:0,quote}));
const single=await handler.run({urls:[first],quotes:firstQuotes});
const multiple=await handler.run({urls:[first,second,third],quotes:[...firstQuotes,{source_index:1,quote:'Second quote.'},{source_index:2,quote:'unavailable quote'}]});

function accepts(output){
 assert.equal(validatesPublishedSchema(output),true,JSON.stringify(validatesPublishedSchema.errors));
 assert.equal(quoteProofOutput.safeParse(output).success,true);
 assert.equal(publishedPasses(output),true);assert.equal(passesCriteria('quote-proof',output),true);assert.equal(handler.success(output),true);
}
function rejectsRelation(label,output){
 assert.equal(validatesPublishedSchema(output),true,label+' remains valid under the structural JSON schema');
 assert.equal(quoteProofOutput.safeParse(output).success,false,label+' fails the existing runtime refinement');
 assert.equal(publishedPasses(output),false,label+' fails an independently evaluated pinned predicate');
 assert.equal(passesCriteria('quote-proof',output),false,label+' fails server predicates');assert.equal(handler.success(output),false,label+' is not paid success');
}

test('normal fixture outputs pass the pinned contract and bind each result to its own source',()=>{
 accepts(single);accepts(multiple);
 assert.deepEqual(multiple.results.map(row=>row.status),['exact_match','whitespace_normalized_match','absent','ambiguous','exact_match','exact_match','unknown']);
 assert(multiple.results[5].evidence[0].end_char>multiple.sources[0].extracted_chars,'Second-source evidence must not be checked against the first source');
 const unicode=multiple.results[4].evidence[0].context.text;
 assert(unicode.includes('😀'));assert(unicode.length>Array.from(unicode).length,'Context offsets count UTF-16 code units');
});

test('all four independently audited omitted-refinement mutations now fail the pinned predicates',()=>{
 const mutations=[
  ['unknown summary',output=>{output.summary.unknown=1;}],
  ['evidence beyond extracted text',output=>{output.results[0].evidence[0].end_char=1000;}],
  ['missing exact-match evidence',output=>{output.results[0].evidence=[];}],
  ['source ordinal',output=>{output.sources[0].source_index=1;}],
 ];
 for(const [label,mutate] of mutations){const output=structuredClone(single);mutate(output);assert.equal(legacyPasses(output),true,label+' previously passed both published predicates');rejectsRelation(label,output);}
});

test('every existing refinement relationship is reproduced by schema plus pinned predicates',t=>{
 const mutations=[
  ['decisive summary',output=>{output.summary.decisive--;}],
  ['unknown summary',output=>{output.summary.unknown++;}],
  ['source index',output=>{output.sources[0].source_index=1;}],
  ['source order',output=>{[output.sources[0],output.sources[1]]=[output.sources[1],output.sources[0]];}],
  ['quote index',output=>{output.results[0].quote_index=1;}],
  ['quote order',output=>{[output.results[0],output.results[1]]=[output.results[1],output.results[0]];}],
  ['missing source reference',output=>{output.results[0].source_index=4;}],
  ['absent HTML source',output=>{output.sources[0].extraction='static_html';}],
  ['absent known occurrence',output=>{output.results[2].occurrences='1';}],
  ['absent evidence',output=>{output.results[2].evidence=[structuredClone(output.results[0].evidence[0])];}],
  ['unknown known occurrence',output=>{output.results[6].occurrences='0';}],
  ['unknown evidence',output=>{output.results[6].evidence=[structuredClone(output.results[5].evidence[0])];}],
  ['match HTTP status',output=>{output.sources[0].http_status=201;}],
  ['match missing content hash',output=>{output.sources[0].content_sha256=null;}],
  ['match missing extraction hash',output=>{output.sources[0].extraction_sha256=null;}],
  ['match unavailable extraction',output=>{output.sources[0].extraction='unavailable';}],
  ['exact zero evidence',output=>{output.results[0].evidence=[];}],
  ['exact extra evidence',output=>{output.results[0].evidence.push(structuredClone(output.results[0].evidence[0]));}],
  ['exact occurrence',output=>{output.results[0].occurrences='0';}],
  ['normalized zero evidence',output=>{output.results[1].evidence=[];}],
  ['normalized occurrence',output=>{output.results[1].occurrences='2_or_more';}],
  ['ambiguous single evidence',output=>{output.results[3].evidence.pop();}],
  ['ambiguous occurrence',output=>{output.results[3].occurrences='1';}],
  ['empty evidence span',output=>{const evidence=output.results[0].evidence[0];evidence.end_char=evidence.start_char;}],
  ['reversed evidence span',output=>{const evidence=output.results[0].evidence[0];evidence.end_char=evidence.start_char-1;}],
  ['evidence upper bound',output=>{output.results[0].evidence[0].end_char=output.sources[0].extracted_chars+1;}],
  ['evidence uses referenced source bound',output=>{output.results[5].source_index=0;}],
  ['null extracted-character count',output=>{output.sources[0].extracted_chars=null;}],
  ['context length',output=>{output.results[0].evidence[0].context.text+='x';}],
  ['context upper bound',output=>{const context=output.results[0].evidence[0].context;context.start_char+=100;context.end_char+=100;}],
  ['reversed context span',output=>{const context=output.results[0].evidence[0].context;context.end_char=context.start_char;}],
 ];
 for(const [label,mutate] of mutations){const output=structuredClone(multiple);mutate(output);rejectsRelation(label,output);}
 t.diagnostic(mutations.length+' schema-valid mutations reject in independent published predicates, server predicates and existing runtime refinements; all fetches are controlled local fixtures.');
});

test('published predicates preserve the runtime refinement boundary without extra outcome requirements',()=>{
 const withoutContexts=structuredClone(multiple);for(const result of withoutContexts.results)for(const evidence of result.evidence)evidence.context=null;accepts(withoutContexts);
 const emptyContext=structuredClone(multiple);emptyContext.results[0].evidence[0].context={text:'',start_char:emptyContext.sources[0].extracted_chars,end_char:emptyContext.sources[0].extracted_chars};accepts(emptyContext);
 const inclusiveBound=structuredClone(multiple);inclusiveBound.results[0].evidence[0].end_char=inclusiveBound.sources[0].extracted_chars;accepts(inclusiveBound);
 const absentOnly=structuredClone(multiple);absentOnly.results=[{...absentOnly.results[2],quote_index:0}];absentOnly.summary={decisive:1,unknown:0};absentOnly.sources[0].http_status=403;absentOnly.sources[0].content_sha256=null;absentOnly.sources[0].extraction_sha256=null;accepts(absentOnly);
});

test('all-unknown and empty outputs retain the existing nonchargeable gate',()=>{
 const unknown=structuredClone(multiple);unknown.results=unknown.results.map(result=>({...result,status:'unknown',reason:'source_unavailable',occurrences:'unknown',evidence:[]}));unknown.summary={decisive:0,unknown:unknown.results.length};
 assert.equal(validatesPublishedSchema(unknown),true);assert.equal(quoteProofOutput.safeParse(unknown).success,true);
 for(const output of [unknown,{...multiple,sources:[]},{...multiple,results:[],summary:{decisive:0,unknown:0}}]){
  assert.equal(publishedPasses(output),false);assert.equal(passesCriteria('quote-proof',output),false);assert.equal(handler.success(output),false);
 }
});

test('all relation expressions and array ordinal bindings are covered by the success digest',async()=>{
 assert.equal(pin.sha256,createHash('sha256').update(pin.canonical_json,'utf8').digest('hex'));
 assert.deepEqual(document.criteria,criteriaFor('quote-proof'));
 const ordinalRules=document.criteria.rules.filter(rule=>Object.hasOwn(rule.test.every??{},'index_as'));
 assert.deepEqual(ordinalRules.map(rule=>rule.id),['source_indices_preserve_input_order','quote_indices_preserve_input_order']);
 for(const rule of document.criteria.rules.slice(2)){
  const changed=structuredClone(product);changed.outcome.criteria.rules=changed.outcome.criteria.rules.filter(candidate=>candidate.id!==rule.id);
  assert.notEqual((await successContractPin(changed)).sha256,pin.sha256,rule.id+' is pinned');
 }
 // Every unchanged product still compiles with the documented existing language.
 for(const id of ['docs-pack','contract-cases','mcp-wirecheck'])for(const rule of criteriaFor(id).rules)compileExpression(rule.test);
});

test('independent interpretation rejects unknown or malformed expressions and unsupported ordinal bindings',()=>{
 const source={path:'sources'};
 for(const expression of [{future_operator:true},{eq:[1,1],extra:true},{eq:[1,1,2]},{if:[true,true]},{every:{source,as:'source',test:true,index_as:'source'}},{every:{source,as:'source',test:true,index_as:''}},{every:{source,as:'source',test:true,index_as:'ordinal',typo:true}},{some:{source,as:'source',test:true,index_as:'ordinal'}},{count_where:{source,as:'source',test:true,index_as:'ordinal'}},{every:{source,as:'source'}},{if:[true,true,{future_operator:true}]}])assert.throws(()=>compileExpression(expression));
});
