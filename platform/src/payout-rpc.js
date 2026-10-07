const HASH=/^0x[0-9a-fA-F]{64}$/,QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/;
class PayoutRpcError extends Error{}
function failure(reason,code='payout_rpc_failed'){const error=new PayoutRpcError(`Payout RPC rejected: ${reason}`);error.code=code;return error;}
function invalid(reason){throw failure(reason,'payout_rpc_invalid');}
function endpoint(value){
 if(typeof value!=='string'||value.length>4096)invalid('invalid endpoint');
 let parsed;try{parsed=new URL(value);}catch{invalid('invalid endpoint');}
 const host=parsed.hostname.toLowerCase();
 if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.hash||parsed.port&&parsed.port!=='443'||!host.includes('.')||host.endsWith('.')||host.startsWith('[')||/^[0-9.]+$/.test(host)||/(?:^|\.)(?:localhost|local|internal|test|invalid|example)$/.test(host))invalid('invalid endpoint');
 return parsed.href;
}
function parameters(method,params){
 if(!Array.isArray(params))invalid('invalid parameters');
 if(method==='eth_chainId'&&params.length===0)return [];
 if(['eth_getTransactionByHash','eth_getTransactionReceipt'].includes(method)&&params.length===1&&typeof params[0]==='string'&&HASH.test(params[0]))return [params[0].toLowerCase()];
 if(method==='eth_getBlockByNumber'&&params.length===2&&params[1]===false&&typeof params[0]==='string'&&(params[0]==='finalized'||QUANTITY.test(params[0])))return [params[0].toLowerCase(),false];
 invalid('unsupported method or parameters');
}
// Construct only from trusted server configuration; callers cannot supply a URL or fetch options.
export function createPayoutRpc({url,fetchImpl=globalThis.fetch,timeoutMs=10000,maxResponseBytes=262144}={}){
 const target=endpoint(url);
 if(typeof fetchImpl!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||!Number.isInteger(maxResponseBytes)||maxResponseBytes<1||maxResponseBytes>1048576)invalid('invalid configuration');
 let nextId=0;
 return async function rpc(method,params){
  const checked=parameters(method,params);
  if(nextId>=Number.MAX_SAFE_INTEGER)invalid('request ID exhausted');
  const id=++nextId,body=JSON.stringify({jsonrpc:'2.0',id,method,params:checked});
  if(body.length>1024)invalid('oversized request');
  const controller=new AbortController();let reader,timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();if(reader)Promise.resolve(reader.cancel()).catch(()=>{});reject(failure('timeout'));},timeoutMs);});
  const request=async()=>{
   const response=await fetchImpl(target,{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body,signal:controller.signal,redirect:'manual',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
   if(controller.signal.aborted)throw failure('timeout');
   if(!response||response.status!==200||response.redirected||response.url&&response.url!==target)throw failure('invalid HTTP response');
   const type=response.headers?.get('content-type');
   if(typeof type!=='string'||!/^application\/json(?:\s*;|$)/i.test(type))throw failure('invalid response content type');
   const length=response.headers.get('content-length');
   if(length!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(length)||BigInt(length)>BigInt(maxResponseBytes)))throw failure('oversized response');
   const encoding=response.headers.get('content-encoding');
   const exactLength=encoding===null||encoding.trim().toLowerCase()==='identity';
   if(!response.body||typeof response.body.getReader!=='function')throw failure('missing response body');
   reader=response.body.getReader();const chunks=[];let size=0;
   for(;;){const {done,value}=await reader.read();if(done)break;if(!(value instanceof Uint8Array))throw failure('invalid response bytes');size+=value.byteLength;if(size>maxResponseBytes)throw failure('oversized response');chunks.push(value);}
   // Fetch may transparently decode compressed bodies while retaining encoded Content-Length.
   if(exactLength&&length!==null&&BigInt(length)!==BigInt(size))throw failure('truncated response');
   const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
   let envelope;try{envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw failure('malformed response');}
   if(!envelope||typeof envelope!=='object'||Array.isArray(envelope)||envelope.jsonrpc!=='2.0'||envelope.id!==id)throw failure('mismatched response');
   const keys=Object.keys(envelope);
   if(keys.length!==3||!keys.every(key=>['jsonrpc','id','result'].includes(key))||!Object.hasOwn(envelope,'result'))throw failure('RPC error or invalid envelope');
   return envelope.result;
  };
  try{return await Promise.race([request(),timeout]);}
  catch(error){if(error instanceof PayoutRpcError)throw error;throw failure('transport failure');}
  finally{clearTimeout(timer);controller.abort();if(reader)Promise.resolve(reader.cancel()).catch(()=>{});}
 };
}
