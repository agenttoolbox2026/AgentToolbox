import model from './generated.json' with {type:'json'};
import {homePage,buyPage,sellPage,humansPage,toolPage,notFoundPage} from './pages.js';
import {compactManifest,homeMarkdown,buyMarkdown,sellMarkdown,toolMarkdown} from './machine.js';

// No operational handler, storage, credential, proxy, scheduled task or financial
// binding belongs in this Worker. Clients must address the canonical API directly.
const security={
 'Content-Security-Policy':"default-src 'none'; style-src 'self'; img-src 'self'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'",
 'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
 'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
 'Strict-Transport-Security':'max-age=31536000',
};
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
export default {
 async fetch(request,env){
  const url=new URL(request.url),path=url.pathname;
  // Do not redirect or forward bodies, signatures, capabilities or query strings.
  // A caller may already have attached credentials to a mistaken origin.
  if(path==='/mcp'||path==='/v1'||path.startsWith('/v1/'))return json(request,{error:{code:'canonical_api_required',message:'Send operational requests directly to the canonical API. This host is presentation only.',canonical_api_origin:model.origin,mcp_endpoint:model.machine.mcp}},421,{'Cache-Control':'no-store'});
  if(!['GET','HEAD'].includes(request.method))return json(request,{error:{code:'method_not_allowed',message:'This presentation host supports GET and HEAD only.',canonical_api_origin:model.origin}},405,{Allow:'GET, HEAD','Cache-Control':'no-store'});
  if(path==='/openapi.json'||path==='/.well-known/x402')return respond(request,null,'text/plain',307,{Location:model.origin+path,'Cache-Control':'no-store'});
  if(['/style.css','/agenttoolbox-icon.png'].includes(path)){
   if(!env?.ASSETS)return json(request,{error:{code:'asset_unavailable'}},503,{'Cache-Control':'no-store'});
   const asset=await env.ASSETS.fetch(new Request(model.siteOrigin+path,{method:request.method}));
   const headers=new Headers(asset.headers);for(const [k,v]of Object.entries(security))headers.set(k,v);
   headers.set('Cache-Control','public, max-age=3600');return new Response(request.method==='HEAD'?null:asset.body,{status:asset.status,headers});
  }
  if(path==='/health')return json(request,{ok:true,service:'agenttoolbox-presentation',canonical_api_origin:model.origin,catalog_version:model.registryVersion,ledger:false,payments:false});
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
  if(path==='/humans')return respond(request,humansPage(model));
  if(tool){
   if(match[2]||format==='markdown')return respond(request,toolMarkdown(model,tool),'text/markdown');
   if(format==='json')return json(request,compactManifest(model).tools.find(p=>p.id===tool.id));
   return respond(request,toolPage(model,tool));
  }
  return respond(request,notFoundPage(model),'text/html',404,{'Cache-Control':'no-store'});
 },
};
