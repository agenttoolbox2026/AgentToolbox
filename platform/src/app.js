import {products,findProduct} from './registry.js';
import {service,searchSchema,invokeSchema,outcomeSchema,PlatformError} from './service.js';
import {home,humansPage,notFoundPage,reviewsPage,reviewPage,previewPage,submissionPage,updatePage} from './pages.js';
import {publicPurchases} from './purchases.js';
import {markdown,openapi} from './discovery.js';
import {mcp} from './mcp.js';
import {paidInvocation,paymentManifest,quotedPayment,discoveryChallenge} from './x402.js';
import {runtimeCatalog} from './payment-config.js';
import {successContractPin} from './contract-pins.js';
import {freeExampleManifest} from './free-examples.js';
import {runExample} from './examples.js';
import {prepareResult} from './preparations.js';
import {creatorTerms,submitTool,getSubmission} from './submissions.js';
import {referralTerms,registerReferral,getReferral} from './referrals.js';
import {getCreatorTool,submitToolUpdate,getToolUpdate} from './tool-updates.js';
const HEADERS={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Methods':'GET,HEAD,POST,OPTIONS',
 'Access-Control-Allow-Headers':'Content-Type,Idempotency-Key,Accept,MCP-Protocol-Version,MCP-Session-Id,PAYMENT-SIGNATURE,X-AgentToolbox-Sample,X-Preparation-Capability,X-Creator-Capability,X-Referral-Capability',
 'Access-Control-Expose-Headers':'PAYMENT-REQUIRED,PAYMENT-RESPONSE',
 'X-Content-Type-Options':'nosniff',
 'Referrer-Policy':'no-referrer',
 'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
 'Cache-Control':'no-store',
};
async function boundedBody(request){
 if(Number(request.headers.get('content-length')??0)>16384)throw new PlatformError(413,'body_too_large','Maximum body is 16384 bytes.');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();
 const chunks=[];let length=0;
 while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>16384){await reader.cancel();throw new PlatformError(413,'body_too_large','Maximum body is 16384 bytes.');}chunks.push(value);}
 const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}return joined;
}
async function jsonBody(request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new PlatformError(415,'unsupported_media_type','Use application/json.');
 const bytes=await boundedBody(request);
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new PlatformError(400,'invalid_json','Malformed or missing JSON.');}
}
function validate(schema,value) {const parsed=schema.safeParse(value);if(!parsed.success){if(schema===invokeSchema&&parsed.error.issues.some(issue=>issue.path[0]==='agent_id'))throw new PlatformError(400,'invalid_agent_id','agent_id must be a random UUID pseudonym (for example crypto.randomUUID()). Omit it if unavailable; it does not prove agent identity.');throw new PlatformError(400,'invalid_input','Request does not match the published schema.');}return parsed.data;}
function html(content,status=200){return new Response(content,{status,headers:{'Content-Type':'text/html; charset=utf-8'}});}
export function createPlatform({db,origin,catalog:sourceCatalog=products,handlers={},limit=async()=>true,feedbackLimit=async()=>true,assets,payments={enabled:false},paymentAdapterFactory,index402VerificationHash}) {
 const catalog=runtimeCatalog(sourceCatalog,handlers,payments);
 return async function app(request,client='unknown') {
  const url=new URL(request.url),path=url.pathname,method=request.method;
  const isHead=method==='HEAD';
  const finish=response=>{
    const headers=new Headers(response.headers);for(const [k,v]of Object.entries(HEADERS))headers.set(k,v);
    headers.set('Vary','Accept');
    return new Response(isHead?null:response.body,{status:response.status,headers});
  };
  try{
    if(path==='/admin'||path.startsWith('/admin/'))throw new PlatformError(404,'not_found','No public resource at this path.');
    if(method==='OPTIONS')return finish(new Response(null,{status:204}));
    if(!await limit(client))throw new PlatformError(429,'rate_limited','Wait before retrying.');
    if(path==='/health' && ['GET','HEAD'].includes(method))return finish(Response.json({ok:true,service:'agenttoolbox',api_version:'1'}));
    if(path.startsWith('/agenttoolbox-icon')||['/style.css','/site.js'].includes(path)) {
      if(!['GET','HEAD'].includes(method))throw new PlatformError(405,'method_not_allowed','Use GET.');
      return finish(assets?await assets.fetch(request):new Response(null,{status:404}));
    }
    const channel=path==='/mcp'?'mcp':(path.startsWith('/v1')||path==='/openapi.json'||path==='/llms.txt'||request.headers.get('Accept')?.includes('application/json')?'http':'html');
    const sampleKind=request.headers.get('X-AgentToolbox-Sample')==='synthetic'?'synthetic':'unclassified';
    const api=service({db,catalog,handlers,channel,sampleKind,feedbackAllowed:()=>feedbackLimit(client)});
    api.creatorTerms=creatorTerms;
    api.submitTool=async(body,capability)=>{if(!await feedbackLimit(client))throw new PlatformError(429,'rate_limited','Wait before submitting another proposal.');return submitTool({db,body,capability,client});};
    api.getSubmission=(id,capability)=>getSubmission({db,id,capability});
    api.getCreatorTool=(tool,capability,params)=>getCreatorTool({db,tool,capability,params});
    api.getToolUpdate=(id,capability)=>getToolUpdate({db,id,capability});
    api.submitToolUpdate=async(tool,body,capability)=>{if(!await feedbackLimit(client))throw new PlatformError(429,'rate_limited','Wait before submitting another proposal.');return submitToolUpdate({db,tool,body,capability,client});};
    if(path==='/mcp') {
      if(method!=='POST')throw new PlatformError(405,'method_not_allowed','MCP uses POST.');
      if(request.headers.has('Origin')&&request.headers.get('Origin')!==origin)throw new PlatformError(403,'origin_not_allowed','Use the catalog origin.');
      return finish(await mcp(request,api,await jsonBody(request)));
    }
    if(['GET','HEAD'].includes(method)) {
      if(path==='/.well-known/402index-verify.txt'){
        if(!/^[0-9a-f]{64}$/.test(index402VerificationHash??''))throw new PlatformError(404,'verification_not_configured','No public verification hash is configured.');
        return finish(new Response(index402VerificationHash,{headers:{'Content-Type':'text/plain; charset=utf-8'}}));
      }
      const discoveryInvoke=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/invoke$/);
      if(discoveryInvoke){
        const product=findProduct(discoveryInvoke[1],catalog);
        if(!product||!['active','validation'].includes(product.status)||!product.pricing.payments_enabled)throw new PlatformError(404,'not_found','No payable resource at this path.');
        if(!handlers[product.id])throw new PlatformError(503,'payment_not_ready','No configured paid contract.');
        return finish(await discoveryChallenge({product,config:payments,origin}));
      }
      const examples=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/examples$/);
      if(examples){const product=findProduct(examples[1],catalog),manifest=product?.provider?.type==='first_party'?freeExampleManifest(product.id):null;if(!manifest)throw new PlatformError(404,'examples_unavailable','No free verification fixtures for this tool.');return finish(Response.json(manifest));}
      if(path==='/v1/creator-terms')return finish(Response.json(creatorTerms()));
      if(path==='/v1/referral-terms')return finish(Response.json(referralTerms()));
      if(path==='/v1/referrals/me')return finish(Response.json(await getReferral({db,capability:request.headers.get('X-Referral-Capability')})));
      if(path==='/submit-tool')return finish(html(submissionPage()));
      if(path==='/update-tool')return finish(html(updatePage()));
      const creatorTool=path.match(/^\/v1\/creator-tools\/([a-z0-9-]{1,64})$/);
      if(creatorTool)return finish(Response.json(await api.getCreatorTool(creatorTool[1],request.headers.get('X-Creator-Capability'),Object.fromEntries(url.searchParams))));
      const toolUpdate=path.match(/^\/v1\/tool-updates\/([0-9a-f-]{36})$/);
      if(toolUpdate)return finish(Response.json(await api.getToolUpdate(toolUpdate[1],request.headers.get('X-Creator-Capability'))));
      const submission=path.match(/^\/v1\/tool-submissions\/([0-9a-f-]{36})$/);
      if(submission)return finish(Response.json(await api.getSubmission(submission[1],request.headers.get('X-Creator-Capability'))));
      const preview=path.match(/^\/products\/([a-z0-9-]{1,64})\/preview$/);
      if(preview){const product=findProduct(preview[1],catalog);if(!product?.preview?.supported)throw new PlatformError(404,'preview_unavailable','No limited preview for this tool.');return finish(html(previewPage(product)));}
      if(path==='/.well-known/x402')return finish(Response.json(paymentManifest({catalog,handlers,config:payments,origin})));
      if(path==='/llms.txt')return finish(new Response(markdown(origin,catalog),{headers:{'Content-Type':'text/plain; charset=utf-8'}}));
      if(path==='/openapi.json')return finish(Response.json(openapi(origin,catalog)));
      if(path==='/agents'||path==='/about')return finish(new Response(null,{status:308,headers:{Location:path==='/agents'?'/':'/humans'}}));
      if(path==='/v1/stats')return finish(Response.json(await publicPurchases(db)));
      if(path==='/v1/products/docs-pack/example'){
        const product=findProduct('docs-pack',catalog),handler=handlers['docs-pack'];
        if(!product||!handler)throw new PlatformError(503,'example_unavailable','Example is unavailable.');
        if(isHead)return finish(Response.json({example:true}));
        return finish(Response.json(await runExample({db,product,handler,key:request.headers.get('Idempotency-Key'),sampleKind})));
      }
      if(path==='/humans'){
        let stats;try{stats=await publicPurchases(db);}catch{stats=null;}
        return finish(html(humansPage(stats)));
      }
      if(path==='/'||path==='/v1/products'){
        const params=validate(searchSchema,Object.fromEntries(url.searchParams));
        const data=isHead?null:await api.list(params);
        if(path==='/v1/products'||request.headers.get('Accept')?.includes('application/json'))return finish(Response.json(data??{}));
        if(request.headers.get('Accept')?.includes('text/markdown'))return finish(new Response(markdown(origin,catalog),{headers:{'Content-Type':'text/markdown; charset=utf-8'}}));
        return finish(html(home(params,catalog,origin)));
      }
      const reviewList=path.match(/^\/(v1\/)?products\/([a-z0-9-]{1,64})\/reviews$/);
      if(reviewList){const data=await api.reviews(reviewList[2],Object.fromEntries(url.searchParams));return finish(reviewList[1]?Response.json(data):html(reviewsPage(data)));}
      const reviewDetail=path.match(/^\/(v1\/)?reviews\/([0-9a-f-]{36})(\/replies)?$/);
      if(reviewDetail){const params=Object.fromEntries(url.searchParams);const data=reviewDetail[3]?await api.replies(reviewDetail[2],params):await api.review(reviewDetail[2],params);return finish(reviewDetail[1]||reviewDetail[3]?Response.json(data):html(reviewPage(data)));}
      const criteria=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/criteria$/);
      if(criteria){const product=findProduct(criteria[1],catalog);if(!product?.outcome.criteria)throw new PlatformError(404,'criteria_unavailable','No server-validated criteria for this tool.');return finish(Response.json({api_version:'1',product_id:product.id,product_version:product.version,criteria:product.outcome.criteria,limits:product.limits,...await successContractPin(product),input_schema_url:'/v1/products/'+product.id,output_schema_url:'/v1/products/'+product.id}));}
      const detail=path.match(/^\/(v1\/)?products\/([a-z0-9-]{1,64})$/);
      if(detail){const p=findProduct(detail[2],catalog);if(!p)throw new PlatformError(404,'product_not_found','No product has that identifier.');if(!isHead)await api.detail(p.id);return finish(detail[1]?Response.json({api_version:'1',product:p}):new Response(null,{status:308,headers:{Location:'/v1/products/'+p.id}}));}
      if(path.startsWith('/v1')||path==='/admin'||path.startsWith('/metrics'))throw new PlatformError(404,'not_found','No public resource at this path.');
      return finish(html(notFoundPage(),404));
    }
    if(method==='POST') {
      if(path==='/v1/referrals'){
        if(!await feedbackLimit(client))throw new PlatformError(429,'rate_limited','Wait before registering another referral account.');
        return finish(Response.json(await registerReferral({db,body:await jsonBody(request),capability:request.headers.get('X-Referral-Capability'),client})));
      }
      const update=path.match(/^\/v1\/creator-tools\/([a-z0-9-]{1,64})\/updates$/);
      if(update)return finish(Response.json(await api.submitToolUpdate(update[1],await jsonBody(request),request.headers.get('X-Creator-Capability'))));
      if(path==='/v1/tool-submissions')return finish(Response.json(await api.submitTool(await jsonBody(request),request.headers.get('X-Creator-Capability'))));
      if(path==='/v1/reviews')return finish(Response.json(await api.submitReview(await jsonBody(request),request.headers.get('Idempotency-Key'))));
      const reply=path.match(/^\/v1\/reviews\/([0-9a-f-]{36})\/replies$/);
      if(reply)return finish(Response.json(await api.reply(reply[1],await jsonBody(request),request.headers.get('Idempotency-Key'))));
      if(path==='/v1/feedback')return finish(Response.json(await api.feedback(await jsonBody(request),request.headers.get('Idempotency-Key'))));
      const quote=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/quote$/);
      if(quote){const product=findProduct(quote[1],catalog);if(!product)throw new PlatformError(404,'product_not_found','No product has that identifier.');return finish(Response.json(await quotedPayment({db,request,product,body:await jsonBody(request),config:payments,origin,handler:handlers[product.id]})));}
      const prepare=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/prepare$/);
      if(prepare){const product=findProduct(prepare[1],catalog);if(!product)throw new PlatformError(404,'product_not_found','No product has that identifier.');return finish(Response.json(await prepareResult({db,request,product,body:await jsonBody(request),config:payments,client,handler:handlers[product.id]})));}
      const invoke=path.match(/^\/v1\/products\/([a-z0-9-]{1,64})\/invoke$/);
      if(invoke) {const product=findProduct(invoke[1],catalog);
        if(!product)throw new PlatformError(404,'product_not_found','No product has that identifier.');
        if(['active','validation'].includes(product.status)&&product.pricing.payments_enabled&&!request.headers.get('PAYMENT-SIGNATURE')){
          await boundedBody(request);
          return finish(await paidInvocation({request,product,handler:handlers[product.id],db,config:payments,origin}));
        }
        const body=validate(invokeSchema,await jsonBody(request));
        if(request.headers.has('PAYMENT-SIGNATURE')||(['active','validation'].includes(product.status)&&product.pricing.payments_enabled)) return finish(await paidInvocation({request,body,key:request.headers.get('Idempotency-Key'),product,handler:handlers[product.id],db,config:payments,origin,adapterFactory:paymentAdapterFactory}));
        return finish(Response.json(await api.invoke(invoke[1],body,request.headers.get('Idempotency-Key'))));}
      const outcome=path.match(/^\/v1\/runs\/([0-9a-f-]{36})\/outcome$/);
      if(outcome)return finish(Response.json(await api.outcome(outcome[1],validate(outcomeSchema,await jsonBody(request)))));
      throw new PlatformError(404,'not_found','No callable resource at this path.');
    }
    throw new PlatformError(405,'method_not_allowed','Method is not supported.');
  }catch(e){
    const known=e instanceof PlatformError;
    return finish(Response.json({error:{code:known?e.code:'service_unavailable',message:known?e.message:'The service could not complete this request.',...(known&&Object.keys(e.details).length?{details:e.details}:{})}},{status:known?e.status:503,headers:known&&e.status===429?{'Retry-After':'60'}:{}}));
  }
 };
}
