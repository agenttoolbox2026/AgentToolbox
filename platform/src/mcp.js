import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { searchSchema,invokeSchema,outcomeSchema,PlatformError } from './service.js';
export async function mcp(request,api,parsedBody) {
  const server=new McpServer({name:'agenttoolbox',version:'1.0.0'},{instructions:'Find a product, inspect its current version, outcome criterion, schema and pricing before invoking. Retired products cannot run. No active products are currently listed. Never send credentials. Caller outcome reports do not verify payments.'});
  const register=(name,description,inputSchema,fn,readOnly)=>server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false}},async input=>{
    try {const data=await fn(input);return {content:[{type:'text',text:JSON.stringify(data)}],structuredContent:data};}
    catch(e) {return {isError:true,content:[{type:'text',text:JSON.stringify({error:{code:e instanceof PlatformError?e.code:'internal_error',message:e instanceof PlatformError?e.message:'Request failed.'}})}]};}
  });
  register('list_products','Find tools by problem keywords. Default active only. An empty list means no matching callable tools; status retired/all is for history.',searchSchema,p=>api.list(p),true);
  register('get_product','Inspect a stable product ID: status, version, success criterion, input/output schemas and exact payment availability.',z.strictObject({product_id:z.string().min(1).max(64)}),p=>api.detail(p.product_id),true);
  register('invoke_product','Execute an available product using its version and schema. A retired product returns product_retired without work or payment. Keep run_id private. Max charge is a cap, never consent to a larger amount.',z.strictObject({product_id:z.string().min(1).max(64),...invokeSchema.shape,idempotency_key:z.string().min(32).max(128)}),({product_id,idempotency_key,...body})=>api.invoke(product_id,body,idempotency_key),false);
  register('report_outcome','Report whether a completed run helped the caller. Uses private run_id. Self-report only; does not trigger, prove or reverse a payment. Identical replay is safe.',z.strictObject({run_id:z.uuid(),...outcomeSchema.shape}),p=>api.outcome(p.run_id,{outcome:p.outcome}),false);
  const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:16384});
  await server.connect(transport);
  try{return await transport.handleRequest(request,{parsedBody});}finally{await server.close();}
}
