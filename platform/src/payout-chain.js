import {BASE_NETWORK,BASE_USDC,isAtomicAmount} from './payment-config.js';

const TRANSFER='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ADDRESS=/^0x[0-9a-fA-F]{40}$/,HASH=/^0x[0-9a-fA-F]{64}$/,QUANTITY=/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/;
export const PAYOUT_CHAIN_LIMITS=Object.freeze({blockTransactions:2048,receiptLogs:256,resultBytes:262144,resultNodes:10000,resultDepth:12,objectKeys:256});
function reject(reason){const error=new Error(`Payout receipt rejected: ${reason}`);error.code='payout_chain_invalid';throw error;}
function address(value){if(typeof value!=='string'||!ADDRESS.test(value))reject('invalid address');return value.toLowerCase();}
function hash(value){if(typeof value!=='string'||!HASH.test(value))reject('invalid hash');return value.toLowerCase();}
function quantity(value){if(typeof value!=='string'||value.length>66||!QUANTITY.test(value))reject('invalid quantity');return BigInt(value);}
function bounded(value,{block=false}={}){
 let nodes=0,bytes=0;
 function visit(item,depth,transactions=false){
  if(++nodes>PAYOUT_CHAIN_LIMITS.resultNodes||depth>PAYOUT_CHAIN_LIMITS.resultDepth)reject('oversized RPC result');
  if(transactions&&(!Array.isArray(item)||item.length>PAYOUT_CHAIN_LIMITS.blockTransactions))reject('missing or oversized block transactions');
  if(typeof item==='string'){bytes+=item.length;if(bytes>PAYOUT_CHAIN_LIMITS.resultBytes)reject('oversized RPC result');}
  else if(item&&typeof item==='object'){
   if(Array.isArray(item)&&!transactions&&item.length>PAYOUT_CHAIN_LIMITS.receiptLogs)reject('oversized RPC array');
   const keys=Object.keys(item);if(!transactions&&keys.length>PAYOUT_CHAIN_LIMITS.objectKeys)reject('oversized RPC object');
   if(transactions){
    if(keys.length!==item.length)reject('invalid block transactions');
    const hashes=new Set();
    for(let i=0;i<item.length;i++){const txHash=hash(item[i]);if(hashes.has(txHash))reject('duplicate block transaction');hashes.add(txHash);}
   }
   for(const key of keys){bytes+=key.length;if(bytes>PAYOUT_CHAIN_LIMITS.resultBytes)reject('oversized RPC result');visit(item[key],depth+1,block&&depth===0&&key==='transactions');}
  }else if(item!==null&&!['number','boolean'].includes(typeof item))reject('invalid RPC result');
 }
 visit(value,0);return value;
}
function object(value){if(!value||typeof value!=='object'||Array.isArray(value))reject('missing RPC object');return value;}
function inclusion(block,index,txHash){
 if(!Array.isArray(block.transactions)||index>=BigInt(block.transactions.length)||hash(block.transactions[Number(index)])!==txHash)reject('inconsistent block transaction membership');
}
// Trusted server-injected read-only RPC; results are decoded values, never JSON-RPC envelopes.
export async function verifyBaseUsdcTransfer({rpc,transactionHash,sender,recipient,amountAtomic}={}){
 if(typeof rpc!=='function')reject('missing trusted RPC');
 const txHash=hash(transactionHash),from=address(sender),to=address(recipient),token=BASE_USDC.toLowerCase();
 if(from===to)reject('self transfer');
 if(!isAtomicAmount(amountAtomic)||BigInt(amountAtomic)===0n)reject('invalid amount');
 const read=async(method,params)=>bounded(await rpc(method,params),{block:method==='eth_getBlockByNumber'});
 if(quantity(await read('eth_chainId',[]))!==8453n)reject('wrong chain');
 const tx=object(await read('eth_getTransactionByHash',[txHash]));
 const receipt=object(await read('eth_getTransactionReceipt',[txHash]));
 if(hash(tx.hash)!==txHash||hash(receipt.transactionHash)!==txHash)reject('wrong transaction');
 if(quantity(tx.chainId)!==8453n)reject('wrong transaction chain');
 const nonce='0x'+quantity(tx.nonce).toString(16);
 if(address(tx.from)!==from||address(tx.to)!==token||address(receipt.from)!==from||address(receipt.to)!==token)reject('wrong sender or token');
 if(quantity(tx.value)!==0n||quantity(receipt.status)!==1n)reject('unsuccessful transfer');
 const input='0xa9059cbb'+to.slice(2).padStart(64,'0')+BigInt(amountAtomic).toString(16).padStart(64,'0');
 if(typeof tx.input!=='string'||tx.input.toLowerCase()!==input)reject('wrong transfer input');
 const height=quantity(receipt.blockNumber),blockHash=hash(receipt.blockHash),index=quantity(receipt.transactionIndex);
 if(quantity(tx.blockNumber)!==height||hash(tx.blockHash)!==blockHash||quantity(tx.transactionIndex)!==index)reject('inconsistent inclusion');
 const blockNumber='0x'+height.toString(16);
 const finalized=object(await read('eth_getBlockByNumber',['finalized',false]));
 const finalizedHeight=quantity(finalized.number),finalizedHash=hash(finalized.hash);
 if(height>finalizedHeight)reject('unfinalized transaction');
 const canonical=object(await read('eth_getBlockByNumber',[blockNumber,false]));
 if(quantity(canonical.number)!==height||hash(canonical.hash)!==blockHash)reject('noncanonical receipt');
 inclusion(canonical,index,txHash);
 const timestamp=quantity(canonical.timestamp),blockTimestamp='0x'+timestamp.toString(16);
 const finalCanonical=object(await read('eth_getBlockByNumber',['0x'+finalizedHeight.toString(16),false]));
 if(quantity(finalCanonical.number)!==finalizedHeight||hash(finalCanonical.hash)!==finalizedHash)reject('noncanonical finalized block');
 if(!Array.isArray(receipt.logs)||receipt.logs.length>PAYOUT_CHAIN_LIMITS.receiptLogs)reject('missing or oversized logs');
 const matches=[],indices=new Set();
 for(const value of receipt.logs){
  const log=object(value),logIndex=quantity(log.logIndex).toString();
  if(log.removed!==false||hash(log.transactionHash)!==txHash||hash(log.blockHash)!==blockHash||quantity(log.blockNumber)!==height||quantity(log.transactionIndex)!==index||indices.has(logIndex))reject('inconsistent log');
  indices.add(logIndex);
  const emitter=address(log.address);
  if(!Array.isArray(log.topics)||log.topics.length>4||!log.topics.every(t=>typeof t==='string'&&HASH.test(t))||typeof log.data!=='string'||!/^0x(?:[0-9a-fA-F]{2})*$/.test(log.data))reject('invalid log encoding');
  if(emitter===token&&log.topics[0]?.toLowerCase()===TRANSFER){
   if(log.topics.length!==3||log.topics[1].toLowerCase()!=='0x'+from.slice(2).padStart(64,'0')||log.topics[2].toLowerCase()!=='0x'+to.slice(2).padStart(64,'0')||log.data.toLowerCase()!=='0x'+BigInt(amountAtomic).toString(16).padStart(64,'0'))reject('wrong transfer event');
   matches.push(log);
  }
 }
 if(matches.length!==1)reject('missing or ambiguous transfer event');
 // Re-read the inclusion after collecting evidence to fail closed on a changing canonical view.
 const checked=object(await read('eth_getBlockByNumber',[blockNumber,false]));
 if(quantity(checked.number)!==height||hash(checked.hash)!==blockHash||quantity(checked.timestamp)!==timestamp)reject('changed canonical receipt');
 inclusion(checked,index,txHash);
 return Object.freeze({network:BASE_NETWORK,chainId:8453,token,transactionHash:txHash,nonce,logIndex:'0x'+quantity(matches[0].logIndex).toString(16),blockNumber,blockHash,blockTimestamp,finalizedBlockNumber:'0x'+finalizedHeight.toString(16),amountAtomic,sender:from,recipient:to});
}
