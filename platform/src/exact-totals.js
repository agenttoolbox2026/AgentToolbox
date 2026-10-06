// Aggregate money with BigInt; serialized totals remain decimal strings.
export function exactLedgerTotals(rows){
 const groups=new Map(),daily=new Map();
 const add=(map,dimensions,row)=>{const key=JSON.stringify(dimensions);let item=map.get(key);if(!item){item={...dimensions,events:0,recorded_atomic_units:0n};map.set(key,item);}item.events++;item.recorded_atomic_units+=BigInt(row.amount_atomic);};
 for(const row of rows){if(typeof row.amount_atomic!=='string'||!/^(0|[1-9][0-9]*)$/.test(row.amount_atomic))throw new Error('Noncanonical ledger amount; refusing rounded total.');const dimensions={product_id:row.product_id,version:row.version,sample_kind:row.sample_kind,event:row.event};add(groups,dimensions,row);add(daily,{day:row.created_at.slice(0,10),...dimensions},row);}
 const serialize=map=>[...map.values()].map(row=>({...row,recorded_atomic_units:row.recorded_atomic_units.toString()}));
 return {ledger_totals:serialize(groups),daily_ledger_totals:serialize(daily),interpretation:'Facilitator reports are not independently reconciled on-chain revenue. Synthetic/unclassified events remain separate.'};
}
