import test from 'node:test';
import assert from 'node:assert/strict';
import {createPayoutRpc} from '../src/payout-rpc.js';
const url='https://base.provider.com/key-secret?token=secret',hash='0x'+'ab'.repeat(32);
const json=(value,options={})=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'},...options});
function fixture(options={}){
 const calls=[];const rpc=createPayoutRpc({url,fetchImpl:async(target,init)=>{calls.push({target,init});const request=JSON.parse(init.body);return json({jsonrpc:'2.0',id:request.id,result:request.method==='eth_chainId'?'0x2105':null});},...options});return {rpc,calls};
}
test('fixed endpoint read-only calls use unique IDs and return decoded results',async()=>{
 const f=fixture();assert.equal(await f.rpc('eth_chainId',[]),'0x2105');assert.equal(await f.rpc('eth_getTransactionByHash',[hash]),null);await f.rpc('eth_getTransactionReceipt',[hash]);await f.rpc('eth_getBlockByNumber',['finalized',false]);await f.rpc('eth_getBlockByNumber',['0x10',false]);
 assert.deepEqual(f.calls.map(c=>JSON.parse(c.init.body).id),[1,2,3,4,5]);
 for(const {target,init} of f.calls){assert.equal(target,url);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.cache,'no-store');assert.deepEqual(Object.keys(init.headers).sort(),['Accept','Content-Type']);assert.ok(init.signal.aborted);}
});
test('configuration refuses unsafe endpoints and unbounded options without fetching',()=>{
 for(const bad of ['http://base.provider.com','https://localhost','https://127.0.0.1','https://2130706433','https://[::1]','https://metadata.internal','https://provider.com:444','https://user:password@provider.com','https://provider.com/#fragment','not a url',null])assert.throws(()=>fixture({url:bad}),{code:'payout_rpc_invalid'});
 for(const options of [{timeoutMs:0},{timeoutMs:30001},{timeoutMs:1.5},{maxResponseBytes:0},{maxResponseBytes:1048577},{fetchImpl:null}])assert.throws(()=>fixture(options),{code:'payout_rpc_invalid'});
});
test('method, batch, signing, proxy and parameter bypasses fail before fetch',async()=>{
 const f=fixture();
 for(const [method,params] of [['eth_sendRawTransaction',[hash]],['eth_sendTransaction',[]],['eth_sign',[]],['eth_call',[]],['web3_clientVersion',[]],['ETH_CHAINID',[]],[['eth_chainId'],[]],['eth_chainId',[url]],['eth_chainId',{}],['eth_getTransactionByHash',[hash,url]],['eth_getTransactionReceipt',['0x12']],['eth_getBlockByNumber',['latest',false]],['eth_getBlockByNumber',['pending',false]],['eth_getBlockByNumber',['0x01',false]],['eth_getBlockByNumber',['0x1',true]],['eth_getBlockByNumber',['0x'+'f'.repeat(65),false]],['eth_getBlockByNumber',[{url},false]]])await assert.rejects(f.rpc(method,params),{code:'payout_rpc_invalid'});
 assert.equal(f.calls.length,0);
});
test('whole-operation timeout covers hung fetch and hung body even when abort is ignored',async()=>{
 for(const fetchImpl of [async()=>new Promise(()=>{}),async()=>new Response(new ReadableStream({}),{headers:{'content-type':'application/json'}})]){
  const f=fixture({timeoutMs:10,fetchImpl});const started=Date.now();await assert.rejects(f.rpc('eth_chainId',[]),/timeout/);assert.ok(Date.now()-started<500);
 }
});
test('HTTP errors and redirects are rejected without following destinations',async()=>{
 for(const response of [json({}, {status:500}),new Response(null,{status:302,headers:{location:'https://elsewhere.com/key'}}),json({}, {status:206}),new Response('{}',{headers:{'content-type':'text/plain'}})]){
  let count=0;const f=fixture({fetchImpl:async()=>{count++;return response;}});await assert.rejects(f.rpc('eth_chainId',[]),{code:'payout_rpc_failed'});assert.equal(count,1);
 }
 for(const metadata of [{redirected:true},{url:'https://elsewhere.com/key'}]){const response=json({jsonrpc:'2.0',id:1,result:'0x2105'});for(const [key,value] of Object.entries(metadata))Object.defineProperty(response,key,{value});await assert.rejects(fixture({fetchImpl:async()=>response}).rpc('eth_chainId',[]));}
});
test('streamed byte bounds, declared length, truncation and invalid UTF-8 fail closed',async()=>{
 let canceled=false;
 const huge=new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(100));},cancel(){canceled=true;}}),{headers:{'content-type':'application/json'}});
 await assert.rejects(fixture({maxResponseBytes:50,fetchImpl:async()=>huge}).rpc('eth_chainId',[]),/oversized/);assert.ok(canceled);
 for(const response of [new Response('{}',{headers:{'content-type':'application/json','content-length':'10000'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'3'}}),new Response('{}',{headers:{'content-type':'application/json','content-length':'-1'}}),new Response(new Uint8Array([255]),{headers:{'content-type':'application/json'}}),new Response('{"jsonrpc":',{headers:{'content-type':'application/json'}})])await assert.rejects(fixture({maxResponseBytes:100,fetchImpl:async()=>response}).rpc('eth_chainId',[]),{code:'payout_rpc_failed'});
 const body=JSON.stringify({jsonrpc:'2.0',id:1,result:null});assert.equal(await fixture({maxResponseBytes:body.length,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json','content-length':String(body.length)}})}).rpc('eth_chainId',[]),null);
});
test('exact response version, unique ID and result envelope reject malformed and RPC errors',async()=>{
 for(const envelope of [null,[],[{jsonrpc:'2.0',id:1,result:null}],{jsonrpc:'1.0',id:1,result:null},{jsonrpc:'2.0',id:'1',result:null},{jsonrpc:'2.0',id:2,result:null},{jsonrpc:'2.0',id:1},{jsonrpc:'2.0',id:1,error:{code:-32000,message:url}},{jsonrpc:'2.0',id:1,result:null,error:{}},{jsonrpc:'2.0',id:1,result:null,extra:true}]){
  await assert.rejects(fixture({fetchImpl:async()=>json(envelope)}).rpc('eth_chainId',[]),error=>error.code==='payout_rpc_failed'&&!error.message.includes('secret')&&!error.message.includes('provider.com'));
 }
});
test('transport exception details never expose endpoint or provider secrets',async()=>{
 await assert.rejects(fixture({fetchImpl:async()=>{throw Error('failed '+url);}}).rpc('eth_chainId',[]),error=>error.code==='payout_rpc_failed'&&error.message==='Payout RPC rejected: transport failure'&&!error.cause);
});
test('compressed responses bound declared encoded size and decoded stream without comparing their lengths',async()=>{
 const body=JSON.stringify({jsonrpc:'2.0',id:1,result:'0x2105'});
 for(const encoding of ['gzip','br'])assert.equal(await fixture({maxResponseBytes:100,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json','content-encoding':encoding,'content-length':'20'}})}).rpc('eth_chainId',[]),'0x2105');
 for(const length of ['101','-1','not-a-number'])await assert.rejects(fixture({maxResponseBytes:100,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json','content-encoding':'gzip','content-length':length}})}).rpc('eth_chainId',[]),/oversized/);
 await assert.rejects(fixture({maxResponseBytes:30,fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json','content-encoding':'br','content-length':'20'}})}).rpc('eth_chainId',[]),/oversized/);
 await assert.rejects(fixture({fetchImpl:async()=>new Response(body,{headers:{'content-type':'application/json','content-encoding':'identity','content-length':'20'}})}).rpc('eth_chainId',[]),/truncated/);
});
