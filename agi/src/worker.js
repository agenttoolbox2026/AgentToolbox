import generated from './generated.json' with {type:'json'};
import {homePage,buyPage,sellPage,toolPage,notFoundPage,catalogPage,documentPage} from './pages.js';
import {humansPage} from './humans.js';
import {compactManifest,homeMarkdown,buyMarkdown,sellMarkdown,toolMarkdown,catalogMarkdown,toolManifest} from './machine.js';
import {selectCatalog,CatalogQueryError,isPublishedTool} from './catalog.js';
import {getCompiledRuntime} from './compiled-runtime.js';
import {contractDocument,sellerTermsDocument} from './contract-documents.js';
import {themeWorkflowHtml} from './workflow-theme.js';
import {creatorWalletPage} from './creator-wallet-page.js';
import {referralPage} from './referral-page.js';
import {createPlatform} from '../../platform/src/app.js';
import {creatorRuntimeCatalog} from '../../platform/src/creator-runtime.js';
import {requiresCreatorBinding} from '../../platform/src/creator-installations.js';
import {runtimeCatalog} from '../../platform/src/payment-config.js';
import {publicPurchases,expirePaidResults} from '../../platform/src/purchases.js';
import {expirePreparations} from '../../platform/src/preparations.js';

const security={
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'Strict-Transport-Security':'max-age=31536000',
};
const assetPaths=new Set(['/style.css','/humans.css','/header.css','/forms.css','/workflow.css','/site.js','/retry-envelope.js','/creator-wallet.js','/creator-payout-journey.js','/wallet-proof.js','/creator-earnings.js','/payout-requests.js','/referral-account.js','/referral-wallet.js','/agenttoolbox-icon.png']);
const acceptType=request=>{
 const types=(request.headers.get('Accept')??'text/html').split(',').map((part,index)=>{
  const [mime,...params]=part.trim().toLowerCase().split(';');
  const q=Number(params.find(p=>p.trim().startsWith('q='))?.trim().slice(2)??1);
  return {mime,q:Number.isFinite(q)&&q>=0&&q<=1?q:0,index};
 }).filter(p=>p.q>0).sort((a,b)=>b.q-a.q||a.index-b.index);
 for(const {mime} of types){if(mime==='application/json')return 'json';if(mime==='text/markdown'||mime==='text/plain')return 'markdown';if(mime==='text/html'||mime==='*/*'||mime==='text/*')return 'html';}
 return 'html';
};
function responseFor(request,body,type='text/html',status=200,extra={}){
 return new Response(request.method==='HEAD'?null:body,{status,headers:{...security,
  'Content-Type':type+'; charset=utf-8','Cache-Control':'public, max-age=60','Vary':'Accept',...extra}});
}

// Injection is for local tests/dev. Production uses the same platform handlers,
// D1 ledger, payment adapter and rate-limit namespaces as the prior origin.
export function createAgi({model:sourceModel=generated,platformOptions={},compiledRuntime}={}){
 return {
 async scheduled(controller,env,ctx){
  ctx.waitUntil(Promise.all([expirePaidResults(env.METRICS_DB),expirePreparations(env.METRICS_DB,new Date(),{preserveRecords:true})]));
 },
 async fetch(request,env={}){
  const payoutRequestsEnabled=env.PUBLIC_PAYOUT_REQUESTS_ENABLED==='true';
  let model={...sourceModel,payoutRequestsEnabled},dynamicDocument=false;
  const respond=(...args)=>{const response=responseFor(...args);if(dynamicDocument)response.headers.set('Cache-Control','no-store');return response;};
  const json=(request,body,status=200,extra={})=>respond(request,JSON.stringify(body,null,2)+'\n','application/json',status,extra);
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
   headers.set('Cache-Control',['/site.js','/retry-envelope.js','/creator-wallet.js','/creator-payout-journey.js','/wallet-proof.js','/creator-earnings.js','/payout-requests.js','/referral-account.js','/referral-wallet.js','/workflow.css','/forms.css'].includes(path)?'no-store':'public, max-age=3600');
   return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});
  }
  if(path==='/creator-wallet'||path==='/referrals'){
   if(!read)return json(request,{error:{code:'method_not_allowed'}},405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
   return respond(request,path==='/referrals'?referralPage({payoutRequestsEnabled}):creatorWalletPage({payoutRequestsEnabled}),'text/html',200,{'Cache-Control':'no-store','Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"});
  }
  const documentPath=['/','/buy','/sell','/humans','/tools','/tools.md','/tools.json','/sell/terms','/sell/terms.md','/agent.json','/llms.txt','/AGENTS.md','/index.md','/buy.md','/sell.md','/robots.txt','/sitemap.xml'].includes(path)||/^\/tools\/[a-z0-9-]+(?:\/(?:contract|checks|examples))?(?:\.md)?$/.test(path);
  if(read&&documentPath&&!['/humans','/robots.txt','/sitemap.xml'].includes(path))dynamicDocument=true;
  if(documentPath&&!read&&request.method!=='OPTIONS')return json(request,{error:{code:'method_not_allowed'}},405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
  const compiled=await(compiledRuntime??getCompiledRuntime());
  const catalog=platformOptions.catalog??compiled.catalog,handlers=platformOptions.handlers??compiled.handlers;
  const payments=platformOptions.payments??{enabled:env.PAYMENTS_MODE==='x402',live:true,receiverConfirmed:env.RECEIVER_CONFIRMED==='true',network:env.PAYMENT_NETWORK,asset:env.PAYMENT_ASSET??null,payTo:env.PAY_TO_ADDRESS};
  const creatorCandidate=product=>requiresCreatorBinding(product,handlers[product.id]);
  // Empty production creator registries preserve the static first-party path.
  // Only trusted compiled products can become visible; approved private metadata
  // is never joined into a public model. Resolve each document afresh so a
  // suspension cannot leave a cacheable listing, guide or machine manifest.
  if(read&&documentPath&&!['/humans','/robots.txt','/sell/terms','/sell/terms.md'].includes(path)&&
   (catalog.some(creatorCandidate)||sourceModel.tools.some(creatorCandidate))){
   dynamicDocument=true;
   if(!env.METRICS_DB||env.PUBLIC_ORIGIN!==model.origin||!env.CLIENT_LIMIT||!env.SERVICE_LIMIT)
    return json(request,{error:{code:'configuration_unavailable',message:'Service is not ready.'}},503);
   try{
    if(!(await env.SERVICE_LIMIT.limit({key:'catalog'})).success||
     !(await env.CLIENT_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')??'unknown'})).success)
     return json(request,{error:{code:'rate_limited',message:'Wait before retrying.'}},429);
    const current=await creatorRuntimeCatalog({db:env.METRICS_DB,catalog:runtimeCatalog(catalog,handlers,payments),handlers});
    const eligible=new Map(current.filter(isPublishedTool).map(product=>[product.id,product]));
    model={...model,tools:sourceModel.tools.filter(tool=>{
     if(!creatorCandidate(tool))return true;
     const product=eligible.get(tool.id);
     return product?.version===tool.version&&handlers[tool.id]?.creatorContractSha256===tool.success_pin?.sha256;
    })};
   }catch{return json(request,{error:{code:'catalog_unavailable',message:'Published tool availability could not be checked.'}},503);}
  }
  if(read){
   const format=acceptType(request);
   if(['/tools','/tools.md','/tools.json'].includes(path)){
    let selection;
    try{selection=selectCatalog(model,url.searchParams);}catch(error){
     if(!(error instanceof CatalogQueryError))throw error;
     if(path.endsWith('.json')||(!path.endsWith('.md')&&format==='json'))return json(request,{error:{code:error.code,message:error.message}},400,{'Cache-Control':'no-store'});
     return respond(request,documentPage(model,'# Invalid catalog query\n\n'+error.message+'\n\n[Browse tools](/tools).','/tools'),'text/html',400,{'Cache-Control':'no-store'});
    }
    if(path.endsWith('.json')||(!path.endsWith('.md')&&format==='json'))return json(request,{name:model.name,catalog_version:model.registryVersion,
     query:selection.query,page:selection.page,limit:selection.limit,total:selection.total,catalog_total:selection.catalogTotal,
     page_count:selection.pageCount,previous:selection.previousUrl?model.origin+selection.previousUrl.replace('/tools','/tools.json'):null,next:selection.nextUrl?model.origin+selection.nextUrl.replace('/tools','/tools.json'):null,
     tools:selection.tools.map(tool=>toolManifest(model,tool))});
    if(path.endsWith('.md')||format==='markdown')return respond(request,catalogMarkdown(model,selection),'text/markdown');
    return respond(request,catalogPage(model,selection),'text/html',200,{'Content-Security-Policy':security['Content-Security-Policy'].replace("form-action 'none'","form-action 'self'")});
   }
   if(path==='/sell/terms'||path==='/sell/terms.md'){
    if(format==='json'&&!path.endsWith('.md'))return json(request,model.sellerTerms);
    const markdown=sellerTermsDocument(model);
    return respond(request,path.endsWith('.md')||format==='markdown'?markdown:documentPage(model,markdown,'/sell/terms'),path.endsWith('.md')||format==='markdown'?'text/markdown':'text/html');
   }
   const contractPath=path.match(/^\/tools\/([a-z0-9-]+)\/(contract|checks|examples)(\.md)?$/);
   if(contractPath){
    const tool=model.tools.find(p=>p.id===contractPath[1]),document=tool&&contractDocument(model,tool,contractPath[2]);
    if(!document)return respond(request,notFoundPage(model),'text/html',404,{'Cache-Control':'no-store'});
    if(format==='json'&&!contractPath[3])return json(request,document.data);
    return respond(request,contractPath[3]||format==='markdown'?document.markdown:documentPage(model,document.markdown,path.replace(/\.md$/,'')),contractPath[3]||format==='markdown'?'text/markdown':'text/html');
   }
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
   if(path==='/sitemap.xml')return respond(request,'<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['/','/tools','/buy','/sell','/humans','/reviews','/feedback',...model.tools.map(p=>p.guide_url)].map(path=>'<url><loc>'+model.siteOrigin+path+'</loc></url>').join('')+'</urlset>','application/xml');
   if(path==='/agent.json')return json(request,compactManifest(model));
   if(['/llms.txt','/AGENTS.md','/index.md'].includes(path))return respond(request,homeMarkdown(model),'text/markdown');
   if(path==='/buy.md')return respond(request,buyMarkdown(model),'text/markdown');
   if(path==='/sell.md')return respond(request,sellMarkdown(model),'text/markdown');
   const match=path.match(/^\/tools\/([a-z0-9-]+)(\.md)?$/),tool=match&&model.tools.find(p=>p.id===match[1]);
   if(path==='/'){
    if(format==='json')return json(request,compactManifest(model));
    if(format==='markdown')return respond(request,homeMarkdown(model),'text/markdown');
    return respond(request,homePage(model));
   }
   if(path==='/buy')return respond(request,format==='markdown'?buyMarkdown(model):buyPage(model),format==='markdown'?'text/markdown':'text/html');
   if(path==='/sell')return respond(request,format==='markdown'?sellMarkdown(model):sellPage(model),format==='markdown'?'text/markdown':'text/html');
   if(tool){
    if(match[2]||format==='markdown')return respond(request,toolMarkdown(model,tool),'text/markdown');
    if(format==='json')return json(request,toolManifest(model,tool));
    return respond(request,toolPage(model,tool));
   }
   if(match)return respond(request,notFoundPage(model),'text/html',404,{'Cache-Control':'no-store'});
  }
  if(!env.METRICS_DB||env.PUBLIC_ORIGIN!==model.origin||!env.CLIENT_LIMIT||!env.SERVICE_LIMIT)
   return json(request,{error:{code:'configuration_unavailable',message:'Service is not ready.'}},503,{'Cache-Control':'no-store'});
  const app=createPlatform({db:env.METRICS_DB,origin:env.PUBLIC_ORIGIN,assets:{fetch:assetFetch},
   // Keep suspended/archived product identities here. The platform checks
   // installation eligibility while preserving original signed paid replay.
   catalog,handlers,
   index402VerificationHash:env.INDEX402_VERIFICATION_HASH,
   telemetryEnabled:false,
   feedbackLimit:async client=>!!env.FEEDBACK_LIMIT&&(await env.FEEDBACK_LIMIT.limit({key:client})).success,
   payments,
   limit:async client=>(await env.SERVICE_LIMIT.limit({key:'catalog'})).success&&(await env.CLIENT_LIMIT.limit({key:client})).success,
   ...platformOptions,payoutRequestsEnabled});
  // Execute locally: never proxy an authorization or capability to another host.
  const response=await app(request,request.headers.get('CF-Connecting-IP')??'unknown');
  if(read&&request.method!=='HEAD'&&response.headers.get('Content-Type')?.startsWith('text/html')){
   let html=themeWorkflowHtml(await response.text(),path);
   // Only exact, trusted registry links are rewritten. Machine endpoints retain
   // their JSON contracts; the destination documents link back to those APIs.
   for(const tool of model.tools){
    for(const [suffix,view]of [['/criteria','checks'],['/examples','examples'],['','contract']])
     html=html.replaceAll('href="/v1/products/'+tool.id+suffix+'"','href="/tools/'+tool.id+'/'+view+'"');
   }
   html=html.replaceAll('href="/v1/creator-terms"','href="/sell/terms"').replaceAll('href="/#feedback"','href="/feedback"');
   return new Response(html,{status:response.status,headers:response.headers});
  }
  return response;
 }
 };
}
export default createAgi();
