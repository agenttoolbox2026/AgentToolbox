import {z} from 'zod';
import {products,REGISTRY_VERSION,catalogResult} from './registry.js';
import {invokeSchema,outcomeSchema} from './service.js';
export function markdown(origin) {
 return '# AgentToolbox\n\n'+JSON.stringify(catalogResult({status:'active'}))+'\n\nDiscovery: '+origin+'/v1/products\nInspect: GET /v1/products/{id}\nMCP: '+origin+'/mcp\nOpenAPI: '+origin+'/openapi.json\nRetired: GET /v1/products?status=retired\n\nInspect status, version, schemas, outcome criterion and pricing before invoking.\nNo paid product is currently available. x402 payment availability is explicit per product.\nNever send secrets. Retired products return 410 product_retired without work or payment.\n';
}
export function openapi(origin) {
 const error={description:'Explicit error; no raw input or operational details.',content:{'application/json':{schema:{$ref:'#/components/schemas/Error'}}}};
 const jsonResponse=(description,schema={type:'object'})=>({description,content:{'application/json':{schema}}});
 const productParameter={name:'id',in:'path',required:true,schema:{type:'string',pattern:'^[a-z0-9-]{1,64}$'}};
 return {openapi:'3.1.0',info:{title:'AgentToolbox catalog',version:'1.0.0',description:'One registry for HTTP, MCP and HTML. Current active product count: '+products.filter(p=>p.status==='active').length+'. Prices and availability are per product.'},servers:[{url:origin}],
 paths:{
 '/v1/products':{get:{operationId:'listProducts',summary:'Find products; active only by default.',parameters:[{name:'q',in:'query',schema:{type:'string',maxLength:120}},{name:'status',in:'query',schema:{type:'string',enum:['active','validation','retired','all'],default:'active'}}],responses:{200:jsonResponse('Catalog. Empty products means no match.'),400:error,429:error}}},
 '/v1/products/{id}':{get:{operationId:'getProduct',parameters:[productParameter],responses:{200:jsonResponse('Versioned contract, including retired metadata.'),404:error}}},
 '/v1/products/{id}/invoke':{post:{operationId:'invokeProduct',description:'Only available products execute. Retired returns 410 before work or payment. No callable paid product is currently configured.',parameters:[productParameter,{name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',pattern:'^[A-Za-z0-9_-]{32,128}$'}},{name:'PAYMENT-SIGNATURE',in:'header',required:false,schema:{type:'string'},description:'x402 v2 payment payload only when explicitly required by the product.'}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(invokeSchema)}}},responses:{200:jsonResponse('Completed validated result; run_id is a private capability.'),400:error,402:{...error,description:'Payment required only for configured paid products; see PAYMENT-REQUIRED header.'},404:error,409:error,410:error,422:error,503:error}}},
 '/v1/runs/{id}/outcome':{post:{operationId:'reportOutcome',description:'Self-reported usefulness for a completed run. Does not trigger, prove or reverse payments.',parameters:[{name:'id',in:'path',required:true,schema:{type:'string',format:'uuid'}}],requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(outcomeSchema)}}},responses:{200:jsonResponse('Idempotent outcome acknowledgment.'),400:error,404:error,409:error}}},
 '/mcp':{post:{summary:'MCP Streamable HTTP JSON-RPC; use an MCP client.',responses:{200:jsonResponse('MCP response.'),400:error,405:error}}},
 '/health':{get:{responses:{200:jsonResponse('Liveness only, not a payment or database readiness guarantee.')}}}
 },components:{schemas:{Error:{type:'object',required:['error'],properties:{error:{type:'object',required:['code','message'],properties:{code:{type:'string'},message:{type:'string'},details:{type:'object'}}}}}}},
 'x-catalog-version':REGISTRY_VERSION};
}
