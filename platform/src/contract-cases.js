import {z} from 'zod';
import {hash} from './telemetry.js';
import {passesCriteria} from './criteria.js';

export const CONTRACT_CASES_LIMITS=Object.freeze({schema_bytes:8192,seed_bytes:2048,schema_nodes:64,schema_depth:3,properties_per_object:25,total_properties:25,array_items:16,string_length:128,instance_nodes:128,instance_depth:8,number_magnitude:1e9,candidates:160,cases:24,output_bytes:14000});
export const CONTRACT_CASES_SUBSET=Object.freeze({dialect:'2020-12 bounded subset',types:['object','array','string','number','integer','boolean','null'],keywords:['type','enum','const','properties','required','additionalProperties','items','minItems','maxItems','minLength','maxLength','minimum','maximum','exclusiveMinimum','exclusiveMaximum'],annotations:['$schema','title','description'],unsupported:['references','composition','type unions','boolean schemas','pattern','format','multipleOf','unevaluated keywords','remote resources']});
const L=CONTRACT_CASES_LIMITS,own=(o,k)=>Object.hasOwn(o,k),object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v),clone=v=>JSON.parse(JSON.stringify(v));
const fail=code=>{throw new Error(code);};
const bytes=v=>new TextEncoder().encode(JSON.stringify(v)).length;
const escapePointer=s=>String(s).replaceAll('~','~0').replaceAll('/','~1');
const pointer=parts=>parts.map(p=>'/'+escapePointer(p)).join('');
const set=(o,k,v)=>Object.defineProperty(o,k,{value:v,enumerable:true,writable:true,configurable:true});
// Structural equality ignores object member order, as JSON Schema requires.
function key(v){if(Array.isArray(v))return '['+v.map(key).join(',')+']';if(object(v))return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+key(v[k])).join(',')+'}';return JSON.stringify(v);}
const equal=(a,b)=>key(a)===key(b);
function jsonBound(value,{nodes=L.instance_nodes,depth=L.instance_depth,string=1024,array=L.array_items+1}={}){
 let count=0;const seen=new Set();
 function visit(v,d){
  if(++count>nodes||d>depth)fail('input_limit');
  if(v===null||typeof v==='boolean')return;
  if(typeof v==='number'){if(!Number.isFinite(v)||Math.abs(v)>L.number_magnitude)fail('input_limit');return;}
  if(typeof v==='string'){if(v.length>string||/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))fail('input_limit');return;}
  if(typeof v!=='object'||seen.has(v))fail('input_limit');seen.add(v);
  if(Array.isArray(v)){if(v.length>array)fail('input_limit');for(const item of v)visit(item,d+1);}
  else{if(![Object.prototype,null].includes(Object.getPrototypeOf(v)))fail('input_limit');const keys=Object.keys(v);if(keys.length>32)fail('input_limit');for(const k of keys){if(k.length>128)fail('input_limit');const descriptor=Object.getOwnPropertyDescriptor(v,k);if(!own(descriptor,'value'))fail('input_limit');visit(descriptor.value,d+1);}}
  seen.delete(v);
 }
 visit(value,0);
}
const numeric=new Set(['minimum','maximum','exclusiveMinimum','exclusiveMaximum']);
const typeKeywords={object:['properties','required','additionalProperties'],array:['items','minItems','maxItems'],string:['minLength','maxLength'],number:[...numeric],integer:[...numeric],boolean:[],null:[]};
function inspect(schema){
 jsonBound(schema,{nodes:512,depth:16,array:32});if(bytes(schema)>L.schema_bytes)fail('input_limit');let count=0,propertyCount=0;
 function visit(s,depth){
  if(!object(s)||++count>L.schema_nodes||depth>L.schema_depth)fail('invalid_schema');
  if(!CONTRACT_CASES_SUBSET.types.includes(s.type))fail('unsupported_schema');
  const allowed=new Set(['type','enum','const','title','description',...(depth===0?['$schema']:[]),...typeKeywords[s.type]]);
  for(const k of Object.keys(s))if(!allowed.has(k))fail('unsupported_schema');
  if(depth===0&&s.$schema!=='https://json-schema.org/draft/2020-12/schema')fail('unsupported_schema');
  for(const k of ['title','description'])if(own(s,k)&&(typeof s[k]!=='string'||s[k].length>256))fail('invalid_schema');
  if(own(s,'enum')){if(!Array.isArray(s.enum)||!s.enum.length||s.enum.length>8||new Set(s.enum.map(key)).size!==s.enum.length)fail('invalid_schema');}
  if(s.type==='object'){
   if(own(s,'properties')&&!object(s.properties))fail('invalid_schema');
   const properties=s.properties??{};propertyCount+=Object.keys(properties).length;if(propertyCount>L.total_properties)fail('input_limit');
   if(own(s,'additionalProperties')&&typeof s.additionalProperties!=='boolean')fail('unsupported_schema');
   if(own(s,'required')&&(!Array.isArray(s.required)||s.required.some(k=>typeof k!=='string'||!own(properties,k))||new Set(s.required).size!==s.required.length))fail('invalid_schema');
   for(const sub of Object.values(properties))visit(sub,depth+1);
  }
  if(s.type==='array'){
   if(!own(s,'items'))fail('unsupported_schema');visit(s.items,depth+1);
   for(const k of ['minItems','maxItems'])if(own(s,k)&&(!Number.isInteger(s[k])||s[k]<0||s[k]>L.array_items))fail('invalid_schema');
   if((s.minItems??0)>(s.maxItems??L.array_items))fail('invalid_schema');
  }
  if(s.type==='string'){
   for(const k of ['minLength','maxLength'])if(own(s,k)&&(!Number.isInteger(s[k])||s[k]<0||s[k]>L.string_length))fail('invalid_schema');
   if((s.minLength??0)>(s.maxLength??L.string_length))fail('invalid_schema');
  }
  for(const k of numeric)if(own(s,k)&&(typeof s[k]!=='number'||!Number.isFinite(s[k])||Math.abs(s[k])>L.number_magnitude))fail('invalid_schema');
 }
 visit(schema,0);return count;
}
function typeMatches(t,v){return t==='integer'?typeof v==='number'&&Number.isInteger(v):t==='number'?typeof v==='number':t==='null'?v===null:t==='array'?Array.isArray(v):t==='object'?object(v):typeof v===t;}
function validate(schema,value){
 let checked=0;const errors=[];
 function walk(s,v,ip,sp){
  const check=(keyword,ok,at=ip)=>{checked++;if(!ok)errors.push({instance_pointer:pointer(at),schema_pointer:pointer([...sp,keyword]),keyword});};
  check('type',typeMatches(s.type,v));
  if(own(s,'enum'))check('enum',s.enum.some(e=>equal(e,v)));
  if(own(s,'const'))check('const',equal(s.const,v));
  if(typeof v==='number')for(const k of numeric)if(own(s,k))check(k,k==='minimum'?v>=s[k]:k==='maximum'?v<=s[k]:k==='exclusiveMinimum'?v>s[k]:v<s[k]);
  if(typeof v==='string'){
   const length=[...v].length;if(own(s,'minLength'))check('minLength',length>=s.minLength);if(own(s,'maxLength'))check('maxLength',length<=s.maxLength);
  }
  if(Array.isArray(v)&&s.type==='array'){
   if(own(s,'minItems'))check('minItems',v.length>=s.minItems);if(own(s,'maxItems'))check('maxItems',v.length<=s.maxItems);
   v.forEach((item,i)=>walk(s.items,item,[...ip,i],[...sp,'items']));
  }
  if(object(v)&&s.type==='object'){
   for(const k of s.required??[])check('required',own(v,k),[...ip,k]);
   const props=s.properties??{};
   for(const k of Object.keys(v)){if(own(props,k))walk(props[k],v[k],[...ip,k],[...sp,'properties',k]);else if(s.additionalProperties===false)check('additionalProperties',false,[...ip,k]);}
  }
 }
 walk(schema,value,[],[]);return {valid:errors.length===0,checked_assertions:checked,errors};
}
// Public helper intentionally enforces the same bounded subset as the product.
export function validateContract(schema,value){inspect(schema);jsonBound(value);return validate(schema,value);}
function inputCheck(v){inspect(v.schema);jsonBound(v.valid_example);if(bytes(v.valid_example)>L.seed_bytes)fail('input_limit');if(!validate(v.schema,v.valid_example).valid)fail('invalid_seed');}
export const contractCasesInput=z.strictObject({schema:z.record(z.string(),z.unknown()).describe('Explicit $schema=https://json-schema.org/draft/2020-12/schema required. Bounded subset; every schema node needs a single type. No references, patterns, formats or composition.'),valid_example:z.unknown().refine(v=>v!==undefined,'A valid JSON example is required.'),max_cases:z.number().int().min(2).max(L.cases).default(12)}).superRefine((v,ctx)=>{try{inputCheck(v);}catch(e){ctx.addIssue({code:'custom',message:e.message});}});
const errorSchema=z.strictObject({instance_pointer:z.string().max(2048),schema_pointer:z.string().max(2048),keyword:z.string().max(32)});
const caseSchema=z.strictObject({id:z.string().max(12),kind:z.enum(['positive_boundary','negative_mutation']),instance_pointer:z.string().max(2048),schema_pointer:z.string().max(2048),keyword:z.string().max(32),value:z.unknown(),expected_verdict:z.enum(['valid','invalid']),validation:z.strictObject({valid:z.boolean(),checked_assertions:z.number().int().positive(),errors:z.array(errorSchema).max(1)})});
const gapSchema=z.strictObject({instance_pointer:z.string(),schema_pointer:z.string(),keyword:z.string(),reason:z.enum(['coupled_constraints','no_isolated_candidate','case_or_byte_budget','optional_property_not_in_example','candidate_budget'])});
export const contractCasesOutput=z.strictObject({tool:z.literal('contract-cases'),version:z.literal('0.1.0'),schema_sha256:z.string().regex(/^[a-f0-9]{64}$/),seed_valid:z.literal(true),validator:z.literal('AgentToolbox bounded JSON Schema 2020-12 subset'),source_content:z.literal('untrusted_data'),cases:z.array(caseSchema).min(2).max(L.cases),summary:z.strictObject({positive_cases:z.number().int().positive(),negative_cases:z.number().int().positive(),candidates_checked:z.number().int().min(1).max(L.candidates),omitted_candidates:z.number().int().min(0),generation_capped:z.boolean(),coverage_gaps:z.number().int().min(0)}),coverage_gaps:z.array(gapSchema).max(12),coverage_gaps_omitted:z.number().int().min(0),coverage:z.literal('Selected boundary witnesses only; not exhaustive, not a proof of schema or implementation correctness.')});
function replace(root,path,value){if(!path.length)return clone(value);const result=clone(root);let node=result;for(const p of path.slice(0,-1))node=node[p];set(node,path.at(-1),clone(value));return result;}
// Adjacent representable binary64 values avoid arbitrary epsilon assumptions.
function adjacent(value,up){if(value===0)return up?Number.MIN_VALUE:-Number.MIN_VALUE;const b=new ArrayBuffer(8),view=new DataView(b);view.setFloat64(0,value);let bits=view.getBigUint64(0);bits+=(value>0)===up?1n:-1n;view.setBigUint64(0,bits);return view.getFloat64(0);}
function* localCandidates(s,v){
 const offer=(value,keyword,kind='positive_boundary',suffix=[])=>({value,keyword,kind,suffix});
 if(own(s,'enum'))for(const value of s.enum)yield offer(value,'enum');
 if(own(s,'const'))yield offer(s.const,'const');
 if(s.type==='string'){
  const length=n=>'a'.repeat(n);
  yield offer(length(s.minLength??0),own(s,'minLength')?'minLength':'type');
  if(own(s,'maxLength'))yield offer(length(s.maxLength),'maxLength');
  if((s.minLength??0)>0)yield offer(length(s.minLength-1),'minLength','negative_mutation');
  if(own(s,'maxLength'))yield offer(length(s.maxLength+1),'maxLength','negative_mutation');
  for(const keyword of ['enum','const'])if(own(s,keyword))for(const value of ['',...['a','b','x','\u0000'].map(c=>c+[...v].slice(1).join('')),'contract-case'])yield offer(value,keyword,'negative_mutation');
 }
 if(s.type==='number'||s.type==='integer'){
  const integer=s.type==='integer';
  for(const k of numeric)if(own(s,k)){
   const bound=s[k],lower=k.endsWith('Minimum')||k==='minimum',exclusive=k.startsWith('exclusive');
   const inside=integer?(lower?(exclusive?Math.floor(bound)+1:Math.ceil(bound)):(exclusive?Math.ceil(bound)-1:Math.floor(bound))):exclusive?adjacent(bound,lower):bound;
   const outside=integer?(lower?(exclusive?Math.floor(bound):Math.ceil(bound)-1):(exclusive?Math.ceil(bound):Math.floor(bound)+1)):exclusive?bound:adjacent(bound,!lower);
   yield offer(inside,k);yield offer(outside,k,'negative_mutation');
  }
  for(const value of [0,1,-1])yield offer(value,'type');
  for(const keyword of ['enum','const'])if(own(s,keyword))for(const value of [0,1,-1,integer?v-1:adjacent(v,false),integer?v+1:adjacent(v,true)])yield offer(value,keyword,'negative_mutation');
  if(integer)yield offer(0.5,'type','negative_mutation');
 }
 if(s.type==='boolean'||s.type==='null')for(const value of s.type==='boolean'?[false,true]:[null]){yield offer(value,'type');for(const keyword of ['enum','const'])if(own(s,keyword))yield offer(value,keyword,'negative_mutation');}
 if(s.type==='object'){
  const minimal=clone(v);for(const k of Object.keys(minimal))if(!(s.required??[]).includes(k))delete minimal[k];yield offer(minimal,'type');
  for(const k of s.required??[]){const value=clone(v);delete value[k];yield offer(value,'required','negative_mutation',[k]);}
  if(s.additionalProperties===false){let k='__contract_case_extra';while(own(s.properties??{},k)||own(v,k))k+='_';const value=clone(v);set(value,k,null);yield offer(value,'additionalProperties','negative_mutation',[k]);}
 }
 if(s.type==='array'){
  const sized=n=>{if(n>v.length&&!v.length)return null;return Array.from({length:n},(_,i)=>clone(v[i%v.length]));};
  for(const [n,k,kind] of [[s.minItems??0,own(s,'minItems')?'minItems':'type','positive_boundary'],[s.maxItems,'maxItems','positive_boundary'],[(s.minItems??0)-1,'minItems','negative_mutation'],[s.maxItems===undefined?undefined:s.maxItems+1,'maxItems','negative_mutation']])if(n!==undefined&&n>=0){const value=sized(n);if(value)yield offer(value,k,kind);}
 }
 // Type mutations are accepted only if the complete validator finds one error.
 for(const value of [null,false,0,'',[],{}])if(!typeMatches(s.type,value))yield offer(value,'type','negative_mutation');
}
function* candidates(schema,seed){
 function* walk(s,v,ip,sp){
  for(const c of localCandidates(s,v))yield {...c,instance_pointer:pointer([...ip,...c.suffix]),schema_pointer:pointer([...sp,c.keyword]),value:replace(seed,ip,c.value)};
  if(s.type==='object')for(const k of Object.keys(s.properties??{}))if(own(v,k))yield* walk(s.properties[k],v[k],[...ip,k],[...sp,'properties',k]);
  if(s.type==='array')for(let i=0;i<Math.min(v.length,2);i++)yield* walk(s.items,v[i],[...ip,i],[...sp,'items']);
 }
 yield* walk(schema,seed,[],[]);
}
const coverage='Selected boundary witnesses only; not exhaustive, not a proof of schema or implementation correctness.';
function targets(schema,value){
 const result=[];
 function walk(s,v,ip,sp,present=true){
  for(const keyword of CONTRACT_CASES_SUBSET.keywords)if(own(s,keyword)&&!['properties','items'].includes(keyword)){
   const paths=keyword==='required'?s.required.map(k=>[...ip,k]):[ip];
   for(const path of paths)result.push({instance_pointer:pointer(path),schema_pointer:pointer([...sp,keyword]),keyword,...(!present?{reason:'optional_property_not_in_example'}:{})});
  }
  if(s.type==='object')for(const k of Object.keys(s.properties??{}))walk(s.properties[k],v?.[k],[...ip,k],[...sp,'properties',k],present&&own(v,k));
  if(s.type==='array')for(let i=0;i<Math.min(v?.length??0,2);i++)walk(s.items,v[i],[...ip,i],[...sp,'items']);
 }
 walk(schema,value,[],[]);return result;
}
export function contractCasesPreview(output){
 // Stable allowlist. One sample is useful, while other generated cases stay paid.
 const sample=output.cases.find(c=>c.kind==='negative_mutation');
 if(output.cases.length<4||!sample)return {available:false,reason:'Too few independent cases for a useful limited preview.'};
 return {available:true,tool:'contract-cases',seed_valid:true,positive_cases:output.summary.positive_cases,negative_cases:output.summary.negative_cases,sample:{kind:sample.kind,instance_pointer:sample.instance_pointer,schema_pointer:sample.schema_pointer,keyword:sample.keyword,value:clone(sample.value),expected_verdict:sample.expected_verdict,validation:{valid:false,checked_assertions:sample.validation.checked_assertions,errors:sample.validation.errors.map(e=>({instance_pointer:e.instance_pointer,schema_pointer:e.schema_pointer,keyword:e.keyword}))}},withheld:'The remaining case values and validation traces require payment.',coverage};
}
export function createContractCases(){
 return {input:contractCasesInput,output:contractCasesOutput,preview:contractCasesPreview,
  failureReason:e=>['unsupported_schema','invalid_schema','invalid_seed','input_limit','no_meaningful_cases','output_too_large'].includes(e?.message)?e.message:'contract_cases_failed',
  async run(raw){
   // Validate before generation even when called outside the platform handler.
   inputCheck(raw);const input=contractCasesInput.parse(raw),positive=[],negative=[],seen=new Set(),coupled=new Set();let checked=0,omitted=0,capped=false;
   for(const c of candidates(input.schema,input.valid_example)){
    if(checked>=L.candidates){capped=true;break;}checked++;
    try{jsonBound(c.value);if(bytes(c.value)>L.seed_bytes)throw new Error('input_limit');}catch{omitted++;continue;}
    const validation=validate(input.schema,c.value),valid=c.kind==='positive_boundary';
    if(valid?!validation.valid:validation.errors.length!==1||validation.errors[0].schema_pointer!==c.schema_pointer||validation.errors[0].keyword!==c.keyword||validation.errors[0].instance_pointer!==c.instance_pointer){if(!valid&&validation.errors.length>1&&validation.errors.some(e=>e.schema_pointer===c.schema_pointer))coupled.add(c.schema_pointer+'|'+c.instance_pointer);omitted++;continue;}
    const identity=valid?c.kind+':'+key(c.value):c.kind+':'+c.instance_pointer+':'+c.schema_pointer;if(seen.has(identity)){omitted++;continue;}seen.add(identity);
    const item={id:'',kind:c.kind,instance_pointer:valid?c.instance_pointer:validation.errors[0].instance_pointer,schema_pointer:c.schema_pointer,keyword:c.keyword,value:c.value,expected_verdict:valid?'valid':'invalid',validation};
    (valid?positive:negative).push(item);
   }
   if(!positive.length||!negative.length)fail('no_meaningful_cases');
   const output={tool:'contract-cases',version:'0.1.0',schema_sha256:await hash(key(input.schema)),seed_valid:true,validator:'AgentToolbox bounded JSON Schema 2020-12 subset',source_content:'untrusted_data',cases:[],summary:{positive_cases:0,negative_cases:0,candidates_checked:checked,omitted_candidates:omitted,generation_capped:capped,coverage_gaps:0},coverage_gaps:[],coverage_gaps_omitted:0,coverage};
   // Alternate signs so case/byte caps cannot crowd out either verdict.
   for(let i=0;i<Math.max(positive.length,negative.length);i++)for(const item of [positive[i],negative[i]])if(item){
    if(output.cases.length>=input.max_cases){output.summary.omitted_candidates++;output.summary.generation_capped=true;continue;}
    item.id='case-'+(output.cases.length+1);output.cases.push(item);
    if(bytes(output)>L.output_bytes-3000){output.cases.pop();output.summary.omitted_candidates++;output.summary.generation_capped=true;continue;}
    output.summary[item.kind==='positive_boundary'?'positive_cases':'negative_cases']++;
   }
   const match=(c,t)=>c.kind==='negative_mutation'&&c.schema_pointer===t.schema_pointer&&(c.instance_pointer===t.instance_pointer||t.keyword==='additionalProperties');
   const gaps=targets(input.schema,input.valid_example).filter(t=>!output.cases.some(c=>match(c,t))).map(t=>({...t,reason:t.reason??(negative.some(c=>match(c,t))?'case_or_byte_budget':coupled.has(t.schema_pointer+'|'+t.instance_pointer)?'coupled_constraints':capped?'candidate_budget':'no_isolated_candidate')}));
   output.summary.coverage_gaps=gaps.length;output.coverage_gaps=gaps.slice(0,12);output.coverage_gaps_omitted=Math.max(0,gaps.length-12);
   while(bytes(output)>L.output_bytes&&output.coverage_gaps.length){output.coverage_gaps.pop();output.coverage_gaps_omitted++;}
   if(!output.summary.positive_cases||!output.summary.negative_cases)fail('no_meaningful_cases');
   if(bytes(output)>L.output_bytes)fail('output_too_large');return output;
  },
  success:output=>contractCasesOutput.safeParse(output).success&&passesCriteria('contract-cases',output),
 };
}
