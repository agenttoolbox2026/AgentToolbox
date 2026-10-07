// Local workerd fixtures only: localhost + synthetic header; never deployed.
import {createPlatform} from '../src/app.js';
import {createDocsPack} from '../src/docs-pack.js';
import {createContractCases} from '../src/contract-cases.js';
import {createQuoteProof} from '../src/quote-proof.js';
import {createMcpWireCheck} from '../src/mcp-wirecheck.js';
import {products} from '../src/registry.js';
export default {async fetch(request,env){
 if(!['localhost','127.0.0.1'].includes(new URL(request.url).hostname)||request.headers.get('X-AgentToolbox-Sample')!=='synthetic')return new Response(null,{status:403});
 const fetchImpl=async url=>new Response(new URL(url).pathname==='/robots.txt'?'User-agent: *\nAllow: /':'# Local controlled documentation\n\nCPU limits are bounded.\n\nThis local fixture never fetches external sources.',{headers:{'Content-Type':'text/plain; charset=utf-8'}});
 const app=createPlatform({db:env.METRICS_DB,origin:new URL(request.url).origin,catalog:products,assets:env.ASSETS,handlers:{'docs-pack':createDocsPack({fetcher:fetchImpl}),'contract-cases':createContractCases(),'quote-proof':createQuoteProof({fetchImpl}),'mcp-wirecheck':createMcpWireCheck({fetchImpl:async()=>{throw new Error('Local fixture blocks external MCP');}})},payments:{enabled:true,live:false,receiverConfirmed:true,network:'eip155:8453',payTo:'0x1111111111111111111111111111111111111111'}});
 return app(request,request.headers.get('X-Local-Fixture-Client')??'fixture-client');
}};
