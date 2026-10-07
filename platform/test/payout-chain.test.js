import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyBaseUsdcTransfer,PAYOUT_CHAIN_LIMITS} from '../src/payout-chain.js';
import {BASE_USDC,MAX_UINT256} from '../src/payment-config.js';
const sender='0x'+'11'.repeat(20),recipient='0x'+'22'.repeat(20),transactionHash='0x'+'33'.repeat(32),blockHash='0x'+'44'.repeat(32),finalHash='0x'+'55'.repeat(32);
const topic=address=>'0x'+address.slice(2).padStart(64,'0');
function fixture(amountAtomic='1000001'){
 const data='0x'+BigInt(amountAtomic).toString(16).padStart(64,'0');
 const tx={hash:transactionHash,chainId:'0x2105',nonce:'0x7',from:sender,to:BASE_USDC,value:'0x0',input:'0xa9059cbb'+topic(recipient).slice(2)+data.slice(2),blockNumber:'0x10',blockHash,transactionIndex:'0x0'};
 const log={address:BASE_USDC,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(sender),topic(recipient)],data,transactionHash,blockNumber:'0x10',blockHash,transactionIndex:'0x0',logIndex:'0x2',removed:false};
 const receipt={transactionHash,from:sender,to:BASE_USDC,status:'0x1',blockNumber:'0x10',blockHash,transactionIndex:'0x0',logs:[log]};
 const finalized={number:'0x20',hash:finalHash},canonical={number:'0x10',hash:blockHash,transactions:[transactionHash],timestamp:'0x65000000'},calls=[];
 const f={tx,receipt,log,finalized,canonical,chain:'0x2105',calls};
 f.rpc=async(method,params)=>{calls.push({method,params});if(method==='eth_chainId')return f.chain;if(method==='eth_getTransactionByHash')return f.tx;if(method==='eth_getTransactionReceipt')return f.receipt;if(method==='eth_getBlockByNumber')return params[0]==='finalized'||params[0]===finalized.number?finalized:canonical;throw Error('unexpected method');};
 f.run=(overrides={})=>verifyBaseUsdcTransfer({rpc:f.rpc,transactionHash,sender,recipient,amountAtomic,...overrides});return f;
}
test('finalized native Base USDC transfer returns only stable frozen evidence through read-only methods',async()=>{
 const f=fixture(),evidence=await f.run();
 assert.deepEqual(evidence,{network:'eip155:8453',chainId:8453,token:BASE_USDC.toLowerCase(),transactionHash,nonce:'0x7',logIndex:'0x2',blockNumber:'0x10',blockHash,blockTimestamp:'0x65000000',finalizedBlockNumber:'0x20',amountAtomic:'1000001',sender,recipient});
 assert.ok(Object.isFrozen(evidence));assert.ok(f.calls.every(c=>['eth_chainId','eth_getTransactionByHash','eth_getTransactionReceipt','eth_getBlockByNumber'].includes(c.method)));
 assert.ok(f.calls.filter(c=>c.method==='eth_getBlockByNumber').every(c=>c.params[1]===false));
});
test('uint256 arithmetic is exact, including values above safe integer and maximum uint256',async()=>{
 for(const amount of ['9007199254740993',MAX_UINT256])assert.equal((await fixture(amount).run()).amountAtomic,amount);
 for(const amountAtomic of [0,1,1.5,'0','01','1e6','-1',String(BigInt(MAX_UINT256)+1n),null]){const f=fixture();await assert.rejects(f.run({amountAtomic}),{code:'payout_chain_invalid'});assert.equal(f.calls.length,0);}
});
test('pending, reverted, wrong chain, sender, token, recipient and amount fail closed',async()=>{
 const changes=[f=>f.tx=null,f=>f.receipt=null,f=>f.tx.blockNumber=null,f=>f.receipt.status='0x0',f=>f.chain='0x1',f=>f.tx.chainId='0x1',f=>f.tx.from=recipient,f=>f.receipt.from=recipient,f=>f.tx.to=recipient,f=>f.receipt.to=recipient,f=>f.tx.value='0x1',f=>f.tx.input+='00',f=>f.tx.input='0xa9059cbb'+topic(sender).slice(2)+f.log.data.slice(2),f=>f.log.data='0x'+'00'.repeat(32),f=>f.log.topics[1]=topic(recipient),f=>f.log.topics[2]=topic(sender),f=>f.log.address=recipient];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(f.run(),{code:'payout_chain_invalid'});}
});
test('canonical transaction, receipt, event and finalized block metadata must agree',async()=>{
 const changes=[f=>f.tx.hash=finalHash,f=>f.receipt.transactionHash=finalHash,f=>f.tx.blockHash=finalHash,f=>f.tx.blockNumber='0x11',f=>f.tx.transactionIndex='0x1',f=>f.canonical.hash=finalHash,f=>f.canonical.number='0x11',f=>f.finalized.number='0xf',f=>f.log.blockHash=finalHash,f=>f.log.blockNumber='0x11',f=>f.log.transactionHash=finalHash,f=>f.log.transactionIndex='0x1',f=>f.log.removed=true,f=>delete f.log.removed,f=>f.log.logIndex='0x02',f=>f.receipt.logs=[],f=>f.receipt.logs.push({...f.log}),f=>f.receipt.logs.push({...f.log,logIndex:'0x3'}),f=>f.log.topics.pop(),f=>f.log.data='0x01'];
 for(const change of changes){const f=fixture();change(f);await assert.rejects(f.run(),{code:'payout_chain_invalid'});}
 const f=fixture(),rpc=f.rpc;f.rpc=async(method,params)=>method==='eth_getBlockByNumber'&&params[0]==='0x20'?{number:'0x20',hash:blockHash}:rpc(method,params);await assert.rejects(f.run(),{code:'payout_chain_invalid'});
});
test('changing canonical inclusion after evidence collection is rejected',async()=>{
 const f=fixture(),rpc=f.rpc;let reads=0;f.rpc=async(method,params)=>method==='eth_getBlockByNumber'&&params[0]==='0x10'&&++reads===2?{number:'0x10',hash:finalHash}:rpc(method,params);await assert.rejects(f.run(),{code:'payout_chain_invalid'});
});
test('both inclusion reads require exact indexed membership in a hash-only transaction list',async()=>{
 const invalid=[undefined,null,[],[finalHash],[finalHash,transactionHash],[{hash:transactionHash}],[transactionHash,'invalid'],[transactionHash,transactionHash]];
 for(const transactions of invalid)for(const read of [1,2]){
  const f=fixture(),rpc=f.rpc;let reads=0;
  f.rpc=async(method,params)=>{const result=await rpc(method,params);return method==='eth_getBlockByNumber'&&params[0]==='0x10'&&++reads===read?{...result,transactions}:result;};
  await assert.rejects(f.run(),{code:'payout_chain_invalid'});
 }
 for(const index of ['0x1','0x'+BigInt(MAX_UINT256).toString(16)]){
  const f=fixture();f.tx.transactionIndex=f.receipt.transactionIndex=f.log.transactionIndex=index;await assert.rejects(f.run(),{code:'payout_chain_invalid'});
 }
 const f=fixture();f.tx.transactionIndex=f.receipt.transactionIndex=f.log.transactionIndex='0x1';f.canonical.transactions=[finalHash,transactionHash.toUpperCase().replace('0X','0x')];assert.equal((await f.run()).transactionHash,transactionHash);
});
test('block hash-list capacity is separate from unchanged log and decoded-result budgets',async()=>{
 const hashes=count=>Array.from({length:count},(_,i)=>'0x'+BigInt(i+1).toString(16).padStart(64,'0'));
 for(const length of [257,PAYOUT_CHAIN_LIMITS.blockTransactions]){
  const f=fixture();f.canonical.transactions=hashes(length);f.canonical.transactions[length-1]=transactionHash;f.tx.transactionIndex=f.receipt.transactionIndex=f.log.transactionIndex='0x'+(length-1).toString(16);assert.equal((await f.run()).transactionHash,transactionHash);
 }
 for(const change of [f=>f.canonical.transactions=hashes(PAYOUT_CHAIN_LIMITS.blockTransactions+1),f=>f.canonical.extra=Array(257).fill('0x0'),f=>f.receipt.logs=Array(257).fill(f.log),f=>f.canonical.extra='x'.repeat(PAYOUT_CHAIN_LIMITS.resultBytes)]){
  const f=fixture();change(f);await assert.rejects(f.run(),{code:'payout_chain_invalid'});
 }
 const f=fixture(),rpc=f.rpc;f.rpc=async(method,params)=>{const result=await rpc(method,params);return method==='eth_getBlockByNumber'&&params[0]==='finalized'?{...result,transactions:hashes(PAYOUT_CHAIN_LIMITS.blockTransactions+1)}:result;};await assert.rejects(f.run(),{code:'payout_chain_invalid'});
});
test('truncated, oversized and malformed decoded RPC results are rejected',async()=>{
 for(const change of [f=>delete f.tx.chainId,f=>delete f.receipt.logs,f=>f.receipt.logs=Array(257).fill(f.log),f=>f.tx.extra='x'.repeat(262145),f=>f.tx.input=123,f=>f.receipt.status='0x01',f=>f.chain={result:'0x2105'},f=>f.log.topics=['bad'],f=>f.log.logIndex=null]){const f=fixture();change(f);await assert.rejects(f.run(),{code:'payout_chain_invalid'});}
 const f=fixture();f.rpc=async()=>{throw Error('RPC unavailable');};await assert.rejects(f.run(),/RPC unavailable/);
});
test('source has only the trusted RPC read allowlist and no signing, broadcast or network capability',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../src/payout-chain.js',import.meta.url),'utf8');
 assert.deepEqual([...new Set(source.match(/eth_[A-Za-z]+/g))].sort(),['eth_chainId','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt'].sort());
 assert.equal(/\b(?:fetch|WebSocket|XMLHttpRequest|signTransaction|signMessage|sendTransaction|sendRawTransaction|privateKey)\b/.test(source),false);
 assert.deepEqual([...source.matchAll(/from\s+['"]([^'"]+)['"]/g)].map(m=>m[1]),['./payment-config.js']);
 const f=fixture(),rpc=f.rpc,allowed=new Set(['eth_chainId','eth_getBlockByNumber','eth_getTransactionByHash','eth_getTransactionReceipt']);
 f.rpc=async(method,params)=>{assert.ok(allowed.has(method),'RPC must be read-only');return rpc(method,params);};await f.run();
});

test('nonce and canonical block timestamp are required canonical quantities and stable evidence',async()=>{
 for(const change of [f=>delete f.tx.nonce,f=>f.tx.nonce=null,f=>f.tx.nonce='0x07',f=>f.tx.nonce=7,f=>delete f.canonical.timestamp,f=>f.canonical.timestamp=null,f=>f.canonical.timestamp='0x065000000',f=>f.canonical.timestamp=-1]){const f=fixture();change(f);await assert.rejects(f.run(),{code:'payout_chain_invalid'});}
 const f=fixture(),rpc=f.rpc;let reads=0;f.rpc=async(method,params)=>method==='eth_getBlockByNumber'&&params[0]==='0x10'&&++reads===2?{...f.canonical,timestamp:'0x65000001'}:rpc(method,params);await assert.rejects(f.run(),{code:'payout_chain_invalid'});
 const zero=fixture();zero.tx.nonce='0x0';zero.canonical.timestamp='0x0';const evidence=await zero.run();assert.equal(evidence.nonce,'0x0');assert.equal(evidence.blockTimestamp,'0x0');
});
test('self transfers reject before RPC including differently cased addresses',async()=>{
 const address='0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
 for(const [from,to] of [[sender,sender],[address,address.toUpperCase().replace('0X','0x')],[address.toUpperCase().replace('0X','0x'),address]]){
  const f=fixture();await assert.rejects(f.run({sender:from,recipient:to}),{code:'payout_chain_invalid'});assert.equal(f.calls.length,0);
 }
});
