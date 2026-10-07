import {creatorAccrual} from './submissions.js';
export function creatorFinancialFacts(receipts,allocations){
 const receiptById=new Map(),gross=new Map(),byEntitlement=new Map(),allocated=new Set();
 for(const row of receipts){
  if(receiptById.has(row.operation_id)||typeof row.gross_atomic!=='string'||!/^[1-9][0-9]{0,77}$/.test(row.gross_atomic))throw new Error('Invalid receipt; refusing inaccurate financial facts.');
  receiptById.set(row.operation_id,row);const dimensions={product_id:row.product_id,version:row.version,network:row.network,asset:row.asset},key=JSON.stringify(dimensions),group=gross.get(key)??{...dimensions,gross:0n,receipts:0};group.gross+=BigInt(row.gross_atomic);group.receipts++;gross.set(key,group);
 }
 for(const row of allocations){
  const receipt=receiptById.get(row.operation_id);
  if(allocated.has(row.operation_id)||!receipt||receipt.gross_atomic!==row.gross_atomic||receipt.creator_tool_id!==row.tool_id||receipt.creator_id!==row.creator_id||receipt.creator_share_bps!==row.share_bps)throw new Error('Unmatched or duplicate allocation; refusing inaccurate financial facts.');allocated.add(row.operation_id);
  const key=JSON.stringify([row.tool_id,row.creator_id]),group=byEntitlement.get(key)??[];group.push(row);byEntitlement.set(key,group);
 }
 for(const receipt of receipts)if(receipt.creator_tool_id&&!allocated.has(receipt.operation_id))throw new Error('Missing creator allocation; reconciliation required.');
 return {available:true,coverage:'Receipts captured after migration 0007; historical receipts are not backfilled. No inference from public purchase counts or buyer sample headers.',receipt_basis:'Facilitator-confirmed, not independently reconciled on-chain.',gross_totals:[...gross.values()].map(({gross,receipts,...dimensions})=>({...dimensions,gross_atomic:gross.toString(),receipt_count:receipts})),creator_accruals:[...byEntitlement.values()].map(rows=>({tool_id:rows[0].tool_id,creator_id:rows[0].creator_id,...creatorAccrual(rows)})),transfers:'Unavailable: no payout/refund transfer processor exists.'};
}
