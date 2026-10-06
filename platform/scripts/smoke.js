import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
const origin=process.argv[2]??'http://127.0.0.1:8787';
const checks=[];
async function get(path,options={}){
 const response=await fetch(origin+path,{...options,headers:{'X-AgentToolbox-Sample':'synthetic',...options.headers},signal:AbortSignal.timeout(15000)});
 checks.push({path,method:options.method??'GET',status:response.status});
 return response;
}
for(const [path,type] of [['/','text/html'],['/agents','text/html'],['/about','text/html'],['/llms.txt','text/plain'],['/openapi.json','application/json'],['/health','application/json']]){
 const r=await get(path);assert.equal(r.status,200);assert.ok(r.headers.get('content-type')?.includes(type));
}
const catalog=await(await get('/v1/products')).json();assert.deepEqual(catalog.products,[]);
const negotiated=await(await get('/',{headers:{Accept:'application/json'}})).json();assert.deepEqual(negotiated,catalog);
const retired=await(await get('/v1/products?status=retired')).json();assert.equal(retired.products[0].id,'retry-gate');
const detail=await(await get('/v1/products/retry-gate')).json();assert.equal(detail.product.status,'retired');assert.equal(detail.product.invocation,null);
const stop=await get('/v1/products/retry-gate/invoke',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:'0.1.0',input:{},max_charge_usdc_atomic:0})});
assert.equal(stop.status,410);assert.equal((await stop.json()).error.code,'product_retired');assert.equal(stop.headers.get('PAYMENT-REQUIRED'),null);
for(const path of ['/admin','/metrics','/v1/recover'])assert.equal((await get(path)).status,404);
const asset=await get('/agenttoolbox-icon.png');assert.equal(asset.status,200);
const digest=data=>createHash('sha256').update(data).digest('hex');
const iconHash=digest(Buffer.from(await asset.arrayBuffer()));
assert.equal(iconHash,digest(readFileSync(new URL('../public/agenttoolbox-icon.png',import.meta.url))));
const client=new Client({name:'agenttoolbox-platform-smoke',version:'1.0.0'},{capabilities:{}});
try{
 await client.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{requestInit:{headers:{'X-AgentToolbox-Sample':'synthetic'}}}));
 const tools=await client.listTools();assert.deepEqual(tools.tools.map(t=>t.name).sort(),['get_product','invoke_product','list_products','report_outcome']);
 const listed=await client.callTool({name:'list_products',arguments:{}});assert.deepEqual(listed.structuredContent.products,[]);
 const archived=await client.callTool({name:'get_product',arguments:{product_id:'retry-gate'}});assert.equal(archived.structuredContent.product.status,'retired');
 const invoked=await client.callTool({name:'invoke_product',arguments:{product_id:'retry-gate',version:'0.1.0',input:{},max_charge_usdc_atomic:0,idempotency_key:crypto.randomUUID()}});assert.equal(invoked.isError,true);assert.match(invoked.content[0].text,/product_retired/);
 checks.push({protocol:'MCP',tools:tools.tools.map(t=>t.name),catalog:'empty',retired_invocation:'rejected'});
}finally{await client.close();}
if(origin.startsWith('https:')){
 for(const [path,method]of [['/','GET'],['/v1/recover','POST'],['/mcp','POST']]){
  const response=await fetch('https://agenttoolbox-retry-gate.agenttoolbox2026.workers.dev'+path,{method,...(method==='POST'?{headers:{'Content-Type':'application/json'},body:'{}'}:{}),signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,404);checks.push({old_service:path,method,status:response.status});
 }
}
const report={checked_at:new Date().toISOString(),origin,checks,icon_sha256:iconHash,all_passed:true,sample_kind:'synthetic',settlements_attempted:0};
if(origin.startsWith('https:')){mkdirSync(new URL('../evidence/',import.meta.url),{recursive:true});writeFileSync(new URL('../evidence/public-smoke.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify(report,null,2));
