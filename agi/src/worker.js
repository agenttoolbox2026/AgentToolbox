import generated from './generated.json' with {type:'json'};
import {homePage,buyPage,sellPage,toolPage,notFoundPage} from './pages.js';
import {humansPage} from './humans.js';
import {compactManifest,homeMarkdown,buyMarkdown,sellMarkdown,toolMarkdown} from './machine.js';
import {createPlatform} from '../../platform/src/app.js';
import {createQuoteProof} from '../../platform/src/quote-proof.js';
import {createContractCases} from '../../platform/src/contract-cases.js';
import {createMcpWireCheck} from '../../platform/src/mcp-wirecheck.js';
import {createDocsPack} from '../../platform/src/docs-pack.js';
import {publicPurchases,expirePaidResults} from '../../platform/src/purchases.js';
import {expirePreparations} from '../../platform/src/preparations.js';

const security={
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'Strict-Transport-Security':'max-age=31536000',
};
const assetPaths=new Set(['/style.css','/humans.css','/header.css','/workflow.css','/site.js','/retry-envelope.js','/agenttoolbox-icon.png']);
const acceptType=request=>{
 const types=(request.headers.get('Accept')??'text/html').split(',').map((part,index)=>{
  const [mime,...params]=part.trim().toLowerCase().split(';');
  const q=Number(params.find(p=>p.trim().startsWith('q='))?.trim().slice(2)??1);
  return {mime,q:Number.isFinite(q)&&q>=0&&q<=1?q:0,index};
 }).filter(p=>p.q>0).sort((a,b)=>b.q-a.q||a.index-b.index);
 for(const {mime} of types){if(mime==='application/json')return 'json';if(mime==='text/markdown'||mime==='text/plain')return 'markdown';if(mime==='text/html'||mime==='*/*'||mime==='text/*')return 'html';}
 return 'html';
};
function respond(request,body,type='text/html',status=200,extra={}){
 return new Response(request.method==='HEAD'?null:body,{status,headers:{...security,
  'Content-Type':type+'; charset=utf-8','Cache-Control':'public, max-age=60','Vary':'Accept',...extra}});
}
const json=(request,body,status=200,extra={})=>respond(request,JSON.stringify(body,null,2)+'\n','application/json',status,extra);

// Injection is for local tests/dev. Production uses the same platform handlers,
// D1 ledger, payment adapter and rate-limit namespaces as the prior origin.
export function createAgi({model=generated,platformOptions={}}={}){
 return {
 async scheduled(controller,env,ctx){
  ctx.waitUntil(Promise.all([expirePaidResults(env.METRICS_DB),expirePreparations(env.METRICS_DB,new Date(),{preserveRecords:true})]));
 },
 async fetch(request,env={}){
  const url=new URL(request.url),path=url.pathname,read=['GET','HEAD'].includes(request.method);
  const assetFetch=async source=>{
   const assetPath=new URL(source.url).pathname;
   if(!assetPaths.has(assetPath))return new Response(null,{status:404});
   if(!env.ASSETS)return json(request,{error:{code:'asset_unavailable'}},503,{'Cache-Control':'no-store'});
   // ASSETS receives no visitor query, headers, capability or request body.
   return env.ASSETS.fetch(new Request(model.siteOrigin+assetPath,{method:source.method==='HEAD'?'HEAD':'GET'}));
  };
  if(assetPaths.has(path)){
   if(!read)return json(request,{error:{code:'method_not_allowed'}},405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
   const asset=await assetFetch(request),headers=new Headers(asset.headers);
   for(const [k,v]of Object.entries(security))headers.set(k,v);
   headers.set('Cache-Control',['/site.js','/retry-envelope.js','/workflow.css'].includes(path)?'no-store':'public, max-age=3600');
   return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});
  }
  const documentPath=['/','/buy','/sell','/humans','/agent.json','/llms.txt','/AGENTS.md','/index.md','/buy.md','/sell.md','/robots.txt','/sitemap.xml'].includes(path)||/^\/tools\/[a-z0-9-]+(?:\.md)?$/.test(path);
  if(documentPath&&!read&&request.method!=='OPTIONS')return json(request,{error:{code:'method_not_allowed'}},405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
  if(read){
   if(path==='/humans'){
    let stats=null;
    try{
     // The counter shares the API's D1 and quota boundary. Static documents do
     // not need a binding, but missing/limited data must never become a false 0.
     if(request.method==='GET'&&env.METRICS_DB&&env.PUBLIC_ORIGIN===model.origin&&env.CLIENT_LIMIT&&env.SERVICE_LIMIT&&
       (await env.SERVICE_LIMIT.limit({key:'catalog'})).success&&
       (await env.CLIENT_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success)
       stats=await publicPurchases(env.METRICS_DB);
    }catch{/* Unavailable is not zero. */}
    return respond(request,humansPage(model,stats),'text/html',200,{'Cache-Control':'no-store'});
   }
   if(path==='/robots.txt')return respond(request,'User-agent: *\nAllow: /\nSitemap: '+model.siteOrigin+'/sitemap.xml\n','text/plain');
   if(path==='/sitemap.xml')return respond(request,'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/buy','/sell','/humans',...model.tools.map(p=>p.guide_url)].map(path=>'<url><loc>'+model.siteOrigin+path+'</loc></url>').join('')+'</urlset>','application/xml');
   if(path==='/agent.json')return json(request,compactManifest(model));
   if(['/llms.txt','/AGENTS.md','/index.md'].includes(path))return respond(request,homeMarkdown(model),'text/markdown');
   if(path==='/buy.md')return respond(request,buyMarkdown(model),'text/markdown');
   if(path==='/sell.md')return respond(request,sellMarkdown(model),'text/markdown');
   const match=path.match(/^\/tools\/([a-z0-9-]+)(\.md)?$/),tool=match&&model.tools.find(p=>p.id===match[1]);
   const format=acceptType(request);
   if(path==='/'){
    if(format==='json')return json(request,compactManifest(model));
    if(format==='markdown')return respond(request,homeMarkdown(model),'text/markdown');
    return respond(request,homePage(model));
   }
   if(path==='/buy')return respond(request,format==='markdown'?buyMarkdown(model):buyPage(model),format==='markdown'?'text/markdown':'text/html');
   if(path==='/sell')return respond(request,format==='markdown'?sellMarkdown(model):sellPage(model),format==='markdown'?'text/markdown':'text/html');
   if(tool){
    if(match[2]||format==='markdown')return respond(request,toolMarkdown(model,tool),'text/markdown');
    if(format==='json')return json(request,compactManifest(model).tools.find(p=>p.id===tool.id));
    return respond(request,toolPage(model,tool));
   }
   if(match)return respond(request,notFoundPage(model),'text/html',404,{'Cache-Control':'no-store'});
  }
  if(!env.METRICS_DB||env.PUBLIC_ORIGIN!==model.origin||!env.CLIENT_LIMIT||!env.SERVICE_LIMIT)
   return json(request,{error:{code:'configuration_unavailable',message:'Service is not ready.'}},503,{'Cache-Control':'no-store'});
  const app=createPlatform({db:env.METRICS_DB,origin:env.PUBLIC_ORIGIN,assets:{fetch:assetFetch},
   handlers:{'docs-pack':createDocsPack(),'quote-proof':createQuoteProof(),'contract-cases':createContractCases(),'mcp-wirecheck':createMcpWireCheck()},
   index402VerificationHash:env.INDEX402_VERIFICATION_HASH,
   telemetryEnabled:false,
   feedbackLimit:async client=>!!env.FEEDBACK_LIMIT&&(await env.FEEDBACK_LIMIT.limit({key:client})).success,
   payments:{enabled:env.PAYMENTS_MODE==='x402',live:true,receiverConfirmed:env.RECEIVER_CONFIRMED==='true',network:env.PAYMENT_NETWORK,asset:env.PAYMENT_ASSET??null,payTo:env.PAY_TO_ADDRESS},
   limit:async client=>(await env.SERVICE_LIMIT.limit({key:'catalog'})).success&&(await env.CLIENT_LIMIT.limit({key:client})).success,
   ...platformOptions});
  // Execute locally: never proxy an authorization or capability to another host.
  const response=await app(request,request.headers.get('CF-Connecting-IP')??'unknown');
  if(read&&request.method!=='HEAD'&&response.headers.get('Content-Type')?.startsWith('text/html')){
   const html=(await response.text()).replace(/href="\/style\.css(?=[?"])/g,'href="/workflow.css').replaceAll('href="/#feedback"','href="/buy#after-the-result"');
   return new Response(html,{status:response.status,headers:response.headers});
  }
  return response;
 }
 };
}
export default createAgi();
