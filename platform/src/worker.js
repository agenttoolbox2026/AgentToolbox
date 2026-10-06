import {createPlatform} from './app.js';
export default {
 async fetch(request,env){
  if(!env.METRICS_DB||!env.PUBLIC_ORIGIN||!env.CLIENT_LIMIT||!env.SERVICE_LIMIT)
    return Response.json({error:{code:'configuration_unavailable',message:'Service is not ready.'}},{status:503});
  const app=createPlatform({db:env.METRICS_DB,origin:env.PUBLIC_ORIGIN,assets:env.ASSETS,
    payments:{enabled:env.PAYMENTS_MODE==='x402',receiverConfirmed:env.RECEIVER_CONFIRMED==='true',network:env.PAYMENT_NETWORK,payTo:env.PAY_TO_ADDRESS},
    limit:async client=>(await env.SERVICE_LIMIT.limit({key:'catalog'})).success&&(await env.CLIENT_LIMIT.limit({key:client})).success});
  return app(request,request.headers.get('CF-Connecting-IP')??'unknown');
 }
};
