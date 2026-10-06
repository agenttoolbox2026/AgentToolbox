import {createPlatform} from './app.js';
import {createQuoteProof} from './quote-proof.js';
import {createContractCases} from './contract-cases.js';
import {createMcpWireCheck} from './mcp-wirecheck.js';
import {createDocsPack} from './docs-pack.js';
import {expirePaidResults} from './purchases.js';
import {expirePreparations} from './preparations.js';
export default {
 async scheduled(controller,env,ctx){ctx.waitUntil(Promise.all([expirePaidResults(env.METRICS_DB),expirePreparations(env.METRICS_DB)]));},
 async fetch(request,env){
  if(!env.METRICS_DB||!env.PUBLIC_ORIGIN||!env.CLIENT_LIMIT||!env.SERVICE_LIMIT)
    return Response.json({error:{code:'configuration_unavailable',message:'Service is not ready.'}},{status:503});
  const app=createPlatform({db:env.METRICS_DB,origin:env.PUBLIC_ORIGIN,assets:env.ASSETS,handlers:{'docs-pack':createDocsPack(),'quote-proof':createQuoteProof(),'contract-cases':createContractCases(),'mcp-wirecheck':createMcpWireCheck()},
    feedbackLimit:async client=>!!env.FEEDBACK_LIMIT&&(await env.FEEDBACK_LIMIT.limit({key:client})).success,
    payments:{enabled:env.PAYMENTS_MODE==='x402',live:true,receiverConfirmed:env.RECEIVER_CONFIRMED==='true',network:env.PAYMENT_NETWORK,asset:env.PAYMENT_ASSET??null,payTo:env.PAY_TO_ADDRESS},
    limit:async client=>(await env.SERVICE_LIMIT.limit({key:'catalog'})).success&&(await env.CLIENT_LIMIT.limit({key:client})).success});
  return app(request,request.headers.get('CF-Connecting-IP')??'unknown');
 }
};
