import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {createPlatform} from '../src/app.js';
import {products,catalogResult,searchProducts} from '../src/registry.js';
import {invokeSchema,quoteSchema} from '../src/service.js';
import {invocationJsonSchema,paymentChallenge} from '../src/x402.js';
import {BASE_NETWORK,BASE_USDC,paymentRequirements} from '../src/payment-config.js';
import {paymentRequirementsPin} from '../src/contract-pins.js';
import {selectCatalog} from '../../agi/src/catalog.js';
import {createModel} from '../../agi/src/model.js';

// Reuse the SDK's installed validator dependency for the OpenAPI 2020-12 dialect.
const sdkRequire=createRequire(import.meta.resolve('@modelcontextprotocol/sdk/validation/ajv'));
const Ajv2020=sdkRequire('ajv/dist/2020.js').default;
const addFormats=sdkRequire('ajv-formats');
const openApiValidator=new AjvJsonSchemaValidator(addFormats(new Ajv2020({strict:false,allErrors:true})));
const mcpValidator=new AjvJsonSchemaValidator();
const origin='https://example.test';
const active=products.filter(product=>product.status==='active');
const forbidden=()=>{throw new Error('Discovery must not execute, fetch, or access private records.');};
const noDb={prepare:forbidden,batch:forbidden};
const handlers=Object.fromEntries(active.map(product=>[product.id,{run:forbidden}]));
const payments={enabled:true,live:false,receiverConfirmed:true,network:BASE_NETWORK,asset:BASE_USDC,payTo:'0x'+'1'.repeat(40)};
const platform=()=>createPlatform({db:noDb,origin,handlers,payments,trackingEnabled:false,paymentAdapterFactory:forbidden});
const get=(app,path)=>app(new Request(origin+path));
async function rpc(app,method,params={}){
 const response=await app(new Request(origin+'/mcp',{method:'POST',
  headers:{'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));
 assert.equal(response.status,200);
 const body=await response.json();assert.equal(body.error,undefined);return body.result;
}
const ids=items=>items.map(item=>item.id).sort();
const bodySchema=(document,path)=>document.paths[path].post.requestBody.content['application/json'].schema;

test('public task searches agree across HTTP, MCP and frontdoor without execution',async t=>{
 t.mock.method(globalThis,'fetch',forbidden);
 const app=platform(),model=await createModel({catalog:products});
 for(const [query,expected] of [
  ['json schema tests',['contract-cases']],['boundary tests',['contract-cases']],
  ['quote verification',['quote-proof']],['verification quote',['quote-proof']],
  ['  ＪＳＯＮ\tSCHEMA\nTESTS  ',['contract-cases']],
  ['AgentToolbox negative boundary',['contract-cases']],['no-such-public-tool',[]],
 ]){
  const response=await get(app,'/v1/products?'+new URLSearchParams({q:query}));assert.equal(response.status,200,query);
  const http=await response.json(),mcp=await rpc(app,'tools/call',{name:'list_products',arguments:{q:query}});
  const frontdoor=selectCatalog(model,new URLSearchParams({q:query}));
  assert.deepEqual(ids(http.products),expected,query);assert.equal(http.count,expected.length);
  assert.deepEqual(mcp.structuredContent,http,query);assert.deepEqual(ids(frontdoor.tools),expected,query);
  assert.equal(http.status,'active');assert(http.products.every(product=>product.status==='active'));
  assert(http.products.every(product=>!Object.hasOwn(product,'fit')&&!Object.hasOwn(product,'scope')),'Search metadata does not extend the response contract.');
 }
 assert.equal((await get(app,'/v1/products?'+new URLSearchParams({q:'x'.repeat(121)}))).status,400);
 const invalid=await rpc(app,'tools/call',{name:'list_products',arguments:{q:'x'.repeat(121)}});assert.equal(invalid.isError,true);
});

test('search preserves status filters and searches only public task and creator fields',async()=>{
 assert.deepEqual(ids(catalogResult({q:'retry'}).products),[]);
 assert.deepEqual(ids(catalogResult({q:'retry',status:'retired'}).products),['retry-gate']);
 assert.deepEqual(ids(catalogResult({q:'retry',status:'all'}).products),['retry-gate']);
 assert.equal(catalogResult({status:'all'}).count,products.length);
 const seed=active.find(product=>product.id==='contract-cases');
 const creator={...seed,id:'public-creator',name:'Public helper',summary:'Checks published input.',problem:'',tags:[],
  fit:'Inspect edge samples.',scope:'Fixed integer boundary.',provider:{id:'independent-lab',name:'Independent Lab',type:'creator'},
  invocation:{...seed.invocation,path:'/v1/products/public-creator/invoke'},
  private_proposal:{message:'private-proposal-sentinel'},input_schema:{...seed.input_schema,description:'private-schema-sentinel'},
 };
 const model=await createModel({catalog:[creator]});
 for(const query of ['independent boundary','EDGE Lab']){
  assert.deepEqual(ids(searchProducts({q:query},[creator])),['public-creator']);
  assert.deepEqual(ids(selectCatalog(model,new URLSearchParams({q:query})).tools),['public-creator']);
 }
 for(const query of ['private-proposal-sentinel','private-schema-sentinel','json schema tests'])
  assert.equal(searchProducts({q:query},[creator]).length,0,query);
 const misleading={...creator,id:'quote-proof'};
 assert.equal(searchProducts({q:'quote verification'},[misleading]).length,0,'Creator IDs do not inherit first-party purpose text.');
 assert.doesNotThrow(()=>searchProducts({q:'constructor'},[{...creator,id:'constructor',provider:seed.provider}]));
 assert.equal(selectCatalog({...model,submissions:[{...creator,id:'private-proposal'}]}).total,1);
});

test('OpenAPI generic invoke and quote schemas enforce the existing input/prepared choice',async()=>{
 const document=await(await get(platform(),'/openapi.json')).json();
 const prepared_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 for(const [path,runtime,base] of [
  ['/v1/products/{id}/invoke',invokeSchema,{version:active[0].version,max_charge_usdc_atomic:'10000'}],
  ['/v1/products/{id}/quote',quoteSchema,{version:active[0].version,payment_amount_atomic:'10000'}],
 ]){
  const schema=bodySchema(document,path),validate=openApiValidator.getValidator(schema);
  for(const [fields,valid] of [[{input:{}},true],[{prepared_id},true],[{},false],[{input:{},prepared_id},false],
   [{input:null},false],[{prepared_id:null},false],[{input:[]},false],[{input:{},unknown:'extra'},false]]){
   const body={...base,...fields};assert.equal(validate(body).valid,valid,JSON.stringify(body));
   assert.equal(runtime.safeParse(body).success,valid,'Metadata agrees with the unchanged HTTP parser.');
  }
  const {oneOf,...published}=schema;
  assert.equal(oneOf.length,2);assert.deepEqual(published,z.toJSONSchema(runtime),'Existing properties, types and required fields are preserved.');
 }
 assert.deepEqual(bodySchema(document,'/v1/products/{id}/prepare'),z.toJSONSchema((await import('../src/service.js')).prepareSchema));
 const invoke=bodySchema(document,'/v1/products/{id}/invoke'),validate=openApiValidator.getValidator(invoke);
 assert.equal(validate({version:active[0].version,input:{},max_charge_usdc_atomic:10000}).valid,true,'Numeric spending caps remain compatible.');
 assert.equal(validate({version:active[0].version,input:{},max_charge_usdc_atomic:'10000',agent_id:'not-a-uuid'}).valid,false);
});

test('MCP and concrete OpenAPI/x402 schemas publish the same choice without changing financial pins',async()=>{
 const app=platform(),document=await(await get(app,'/openapi.json')).json();
 const tools=await rpc(app,'tools/list'),schema=tools.tools.find(tool=>tool.name==='invoke_product').inputSchema;
 const validate=mcpValidator.getValidator(schema),prepared_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const base={product_id:active[0].id,version:active[0].version,max_charge_usdc_atomic:'10000',idempotency_key:'discovery_test_abcdefghijklmnopqrstuvwxyz'};
 for(const [fields,valid] of [[{input:{}},true],[{prepared_id},true],[{},false],[{input:{},prepared_id},false]])
  assert.equal(validate({...base,...fields}).valid,valid);
 assert.deepEqual(schema.oneOf,bodySchema(document,'/v1/products/{id}/invoke').oneOf);
 for(const product of active){
  const concrete=bodySchema(document,'/v1/products/'+product.id+'/invoke'),check=openApiValidator.getValidator(concrete);
  assert.deepEqual(concrete,invocationJsonSchema(product));
  assert.equal(check({version:product.version,input:product.example_input,max_charge_usdc_atomic:'10000'}).valid,true,product.id);
  assert.equal(check({version:product.version,prepared_id,max_charge_usdc_atomic:'10000'}).valid,true,product.id);
  assert.equal(check({version:product.version,input:product.example_input,prepared_id,max_charge_usdc_atomic:'10000'}).valid,false,product.id);
  assert.equal(check({version:product.version,max_charge_usdc_atomic:'10000'}).valid,false,product.id);
  assert.equal(check({version:product.version,input:[],max_charge_usdc_atomic:'10000'}).valid,false,product.id);
  const requirements=paymentRequirements(product,payments),pin=await paymentRequirementsPin(requirements);
  const challenge=paymentChallenge(product,requirements,origin);
  assert.deepEqual(challenge.accepts,[requirements]);
  assert.deepEqual(challenge.extensions.bazaar.schema.properties.input.properties.body,concrete);
  assert.equal((await paymentRequirementsPin(challenge.accepts[0])).canonical_json,pin.canonical_json);
  assert.equal(createHash('sha256').update(pin.canonical_json).digest('hex'),pin.sha256);
  assert.deepEqual(challenge.extensions.bazaar.info.input.body,{version:product.version,input:product.example_input,payment_amount_atomic:'10000',max_charge_usdc_atomic:'10000'});
 }
});
