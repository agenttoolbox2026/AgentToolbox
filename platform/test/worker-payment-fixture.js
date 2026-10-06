// Local-only workerd validation fixture. Never referenced by the deployed configuration.
import {z} from 'zod';
import {createPlatform} from '../src/app.js';
import {sdkAdapter} from '../src/x402.js';
const product={id:'local-payment-fixture',version:'1.0.0',name:'LOCAL TEST ONLY',status:'validation',tags:[],summary:'Not a public product',
 outcome:{success_criterion:'A mock result only'},pricing:{amount_atomic:1000,payments_enabled:true}};
export default {async fetch(request,env){
 if(!['localhost','127.0.0.1'].includes(new URL(request.url).hostname)||request.headers.get('X-AgentToolbox-Sample')!=='synthetic')return new Response(null,{status:403});
 const handler={input:z.strictObject({n:z.number().int()}),output:z.strictObject({n:z.number().int()}),run:async p=>p,success:()=>true,preview:()=>({validated:true})};
 const app=createPlatform({db:env.METRICS_DB,origin:'http://127.0.0.1:8788',catalog:[product],handlers:{[product.id]:handler},
 payments:{enabled:true,receiverConfirmed:true,network:'eip155:8453',payTo:'0x1111111111111111111111111111111111111111'},
 paymentAdapterFactory:args=>sdkAdapter({...args,facilitatorClient:{
 getSupported:async()=>({kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453'}],extensions:[],signers:{}}),
 verify:async()=>({isValid:true,payer:'0x'+'2'.repeat(40)}),
 settle:async()=>({success:true,network:'eip155:8453',transaction:'0x'+'c'.repeat(64),payer:'0x'+'2'.repeat(40),amount:args.amount}),
 }})});
 return app(request);
}};
