import {hash} from './telemetry.js';

// This is a deliberately named local profile, not a claim of RFC 8785 conformance.
export const CANONICAL_JSON_PROFILE=Object.freeze({
 id:'agenttoolbox-json-v1',
 encoding:'UTF-8 without BOM or trailing newline',
 object_keys:'Recursively sorted by unsigned UTF-16 code units (ECMAScript default string sort).',
 arrays:'Preserve order; no holes or additional properties.',
 strings:'ECMAScript JSON.stringify escaping; reject lone UTF-16 surrogates; no Unicode normalization.',
 numbers:'Finite IEEE-754 binary64 only; ECMAScript JSON.stringify serialization, including -0 as 0. Monetary atomic units remain decimal strings.',
 values:'JSON null, booleans, strings, finite numbers, arrays and plain objects only. Reject undefined, functions, symbols, bigint, accessors, cycles and non-enumerable object properties.',
 whitespace:'No insignificant whitespace.',
 payment_requirements:'Hash the complete PaymentRequirements object in accepts, including extra. Preserve address/string case and array order; do not hash the challenge envelope, header base64 or payment signature.',
});

function validString(value){
 for(let i=0;i<value.length;i++){
  const code=value.charCodeAt(i);
  if(code>=0xd800&&code<=0xdbff){const next=value.charCodeAt(++i);if(!(next>=0xdc00&&next<=0xdfff))throw new TypeError('Lone surrogate is not canonical JSON.');}
  else if(code>=0xdc00&&code<=0xdfff)throw new TypeError('Lone surrogate is not canonical JSON.');
 }
 return JSON.stringify(value);
}

export function canonicalJson(value){
 const ancestors=new Set();
 const visit=current=>{
  if(current===null)return 'null';
  if(typeof current==='string')return validString(current);
  if(typeof current==='boolean')return current?'true':'false';
  if(typeof current==='number'){if(!Number.isFinite(current))throw new TypeError('Nonfinite number is not canonical JSON.');return JSON.stringify(current);}
  if(typeof current!=='object')throw new TypeError('Value is not canonical JSON.');
  if(ancestors.has(current))throw new TypeError('Cyclic value is not canonical JSON.');
  if(Object.getOwnPropertySymbols(current).length)throw new TypeError('Symbol property is not canonical JSON.');
  const descriptors=Object.getOwnPropertyDescriptors(current);
  ancestors.add(current);
  try{
   if(Array.isArray(current)){
    if(Object.keys(descriptors).length!==current.length+1)throw new TypeError('Array holes or additional properties are not canonical JSON.');
    const items=[];
    for(let i=0;i<current.length;i++){const descriptor=descriptors[String(i)];if(!descriptor||!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError('Array must contain only JSON data values.');items.push(visit(descriptor.value));}
    return '['+items.join(',')+']';
   }
   const prototype=Object.getPrototypeOf(current);
   if(prototype!==Object.prototype&&prototype!==null)throw new TypeError('Only plain JSON objects can be canonicalized.');
   return '{'+Object.keys(descriptors).sort().map(key=>{
    const descriptor=descriptors[key];
    if(!descriptor.enumerable||!Object.hasOwn(descriptor,'value'))throw new TypeError('Object must contain only enumerable JSON data values.');
    return validString(key)+':'+visit(descriptor.value);
   }).join(',')+'}';
  }finally{ancestors.delete(current);}
 };
 return visit(value);
}

async function pin(document){
 const canonical_json=canonicalJson(document);
 return {canonicalization:CANONICAL_JSON_PROFILE,canonical_json,sha256:await hash(canonical_json)};
}

export function successContractDocument(product){
 // Zod decorates the top-level schema with non-enumerable ~standard runtime
 // metadata. It is absent from the published JSON schema and must not be hashed.
 const schema=value=>{
  if(value===null||typeof value!=='object'||Array.isArray(value))return value??null;
  const descriptors=Object.getOwnPropertyDescriptors(value);
  if(descriptors['~standard']&&!descriptors['~standard'].enumerable)delete descriptors['~standard'];
  return Object.create(Object.getPrototypeOf(value),descriptors);
 };
 return {format:'agenttoolbox-success-contract-v1',product_id:product.id,product_version:product.version,
  criteria:product.outcome?.criteria??null,success_criterion:product.outcome?.success_criterion??null,
  limits:product.limits??null,input_schema:schema(product.input_schema),output_schema:schema(product.output_schema)};
}
export const successContractPin=product=>pin(successContractDocument(product));
export const paymentRequirementsPin=requirements=>pin(requirements);
export async function contractPins(product,requirements){
 const [success,payment]=await Promise.all([successContractPin(product),paymentRequirementsPin(requirements)]);
 return {canonicalization:CANONICAL_JSON_PROFILE.id,success_contract_sha256:success.sha256,payment_requirements_sha256:payment.sha256};
}
