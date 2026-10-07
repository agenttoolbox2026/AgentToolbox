import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import worker from '../src/worker.js';
const assets={'/style.css':'text/css','/agenttoolbox-icon.png':'image/png'};
export async function start({port=8791}={}){
 const server=createServer(async(req,res)=>{
  try{
   const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const response=await worker.fetch(request,{ASSETS:{fetch:async request=>{
    const path=new URL(request.url).pathname;if(!assets[path])return new Response(null,{status:404});
    return new Response(await readFile(new URL('../public'+path,import.meta.url)),{headers:{'Content-Type':assets[path]}});
   }}});
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Presentation unavailable.');}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 return {origin:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(resolve=>server.close(resolve))};
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){const run=await start({port:Number(process.env.PORT??8791)});console.log('AgentToolbox AGI: '+run.origin);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await run.close();process.exit(0);});}
