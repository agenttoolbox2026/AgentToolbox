import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {Readable} from 'node:stream';
import {createAgi} from '../src/worker.js';
import {createModel} from '../src/model.js';
import {database} from '../../platform/scripts/local-db.js';
const assets={'/style.css':'text/css','/humans.css':'text/css','/header.css':'text/css','/workflow.css':'text/css','/site.js':'text/javascript','/retry-envelope.js':'text/javascript','/agenttoolbox-icon.png':'image/png'};
export async function start({port=8791}={}){
 const db=database(':memory:');let worker,env;
 const server=createServer(async(req,res)=>{
  try{
   const request=new Request('http://'+req.headers.host+req.url,{method:req.method,headers:req.headers,...(!['GET','HEAD'].includes(req.method)?{body:Readable.toWeb(req),duplex:'half'}:{})});
   const response=await worker.fetch(request,env);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Local service unavailable.');}
 });
 server.requestTimeout=10000;server.headersTimeout=5000;
 await new Promise(resolve=>server.listen(port,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const allow={limit:async()=>({success:true})};
 env={METRICS_DB:db,PUBLIC_ORIGIN:origin,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow,
  ASSETS:{fetch:async request=>{const path=new URL(request.url).pathname;if(!assets[path])return new Response(null,{status:404});return new Response(await readFile(new URL('../public'+path,import.meta.url)),{headers:{'Content-Type':assets[path]}});}}};
 worker=createAgi({model:await createModel({origin}),platformOptions:{
  payments:{enabled:true,live:false,receiverConfirmed:true,network:'eip155:8453',asset:'0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',payTo:'0xD43350dD5a40Dd8689C644A0477Bb75e3A59129D'},
  paymentAdapterFactory:()=>({verify:async()=>{throw new Error('Local development never authorizes payments.');},settle:async()=>{throw new Error('Local development never settles payments.');}})
 }});
 return {origin,close:async()=>{await new Promise(resolve=>server.close(resolve));db.close();}};
}
if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){const run=await start({port:Number(process.env.PORT??8791)});console.log('AgentToolbox AGI (local database, payments disabled): '+run.origin);for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await run.close();process.exit(0);});}
