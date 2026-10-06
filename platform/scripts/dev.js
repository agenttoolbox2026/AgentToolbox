import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {readFileSync,mkdirSync} from 'node:fs';
import {database} from './local-db.js';
import {createPlatform} from '../src/app.js';
import {createDocsPack} from '../src/docs-pack.js';
export async function start({port=8787,persist=false,handlers}={}){
 if(persist)mkdirSync('.data',{recursive:true});
 const db=database(persist?'.data/platform.sqlite':':memory:');
 let app;
 const server=createServer(async(req,res)=>{
  try{
   const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const response=await app(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('{"error":{"code":"internal_error"}}');}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 app=createPlatform({db,origin,handlers:handlers??{'docs-pack':createDocsPack()},assets:{fetch:async r=>{
  const path=new URL(r.url).pathname;const files={'/agenttoolbox-icon.png':'image/png','/style.css':'text/css','/site.js':'text/javascript'};
  if(!files[path])return new Response(null,{status:404});
  return new Response(readFileSync(new URL('../public'+path,import.meta.url)),{headers:{'Content-Type':files[path]}});
 }}});
 return {origin,db,close:async()=>{await new Promise(resolve=>server.close(resolve));db.close();}};
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){const run=await start({port:Number(process.env.PORT??8787),persist:true});console.log('AgentToolbox: '+run.origin);for(const sig of ['SIGINT','SIGTERM'])process.once(sig,async()=>{await run.close();process.exit(0);});}
