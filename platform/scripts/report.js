import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {exactLedgerTotals} from '../src/exact-totals.js';
import {creatorFinancialFacts} from '../src/creator-accounting.js';
const root=new URL('../../',import.meta.url);
function query(sql){
 const result=spawnSync(process.execPath,[new URL('node_modules/wrangler/bin/wrangler.js',root).pathname,'d1','execute','METRICS_DB','--remote','--config',new URL('../wrangler.jsonc',import.meta.url).pathname,'--json','--command='+sql],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw new Error('D1 report read failed. No partial totals reported.');
 return JSON.parse(result.stdout);
}
const report=query(readFileSync(new URL('./report.sql',import.meta.url),'utf8'));
// Ledger rows are append-only. A fixed rowid watermark gives a stable prefix
// even when a new settlement is appended between pages.
const watermark=query('SELECT CAST(COALESCE(MAX(rowid),0) AS TEXT) watermark FROM platform_payment_ledger')[0]?.results?.[0]?.watermark;
if(!/^(0|[1-9][0-9]{0,18})$/.test(watermark??''))throw new Error('Missing ledger watermark.');
const rows=[];let cursor='0';
for(let page=0;;page++){
 if(page>=100)throw new Error('Report exceeds 100,000 ledger rows; export for exact offline aggregation. No partial totals reported.');
 const batch=query(`SELECT CAST(rowid AS TEXT) row_sequence,product_id,version,sample_kind,event,amount_atomic,created_at FROM platform_payment_ledger WHERE rowid>${cursor} AND rowid<=${watermark} ORDER BY rowid LIMIT 1000`)[0]?.results;
 if(!Array.isArray(batch))throw new Error('Missing ledger rows.');rows.push(...batch);
 if(batch.length<1000)break;
 cursor=batch.at(-1).row_sequence;if(!/^[1-9][0-9]{0,18}$/.test(cursor))throw new Error('Invalid ledger cursor.');
}
let creator_accounting={available:false,reason:'Migration 0007 is not installed; financial facts are unavailable.'};
const tables=query("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('platform_live_receipts','platform_creator_allocations')")[0]?.results;
if(tables?.length===2){
 const boundary=query('SELECT CAST(COALESCE(MAX(rowid),0) AS TEXT) watermark FROM platform_live_receipts')[0]?.results?.[0]?.watermark;
 if(!/^(0|[1-9][0-9]{0,18})$/.test(boundary??''))throw new Error('Missing authoritative receipt watermark.');
 const receipts=[],allocations=[];let after='0';
 for(let page=0;;page++){
  if(page>=100)throw new Error('Financial report exceeds 100,000 receipts; export for exact aggregation.');
  const batch=query(`SELECT CAST(rowid AS TEXT) row_sequence,* FROM platform_live_receipts WHERE rowid>${after} AND rowid<=${boundary} ORDER BY rowid LIMIT 1000`)[0]?.results;
  if(!Array.isArray(batch))throw new Error('Missing authoritative receipts.');receipts.push(...batch);
  const upper=batch.at(-1)?.row_sequence??after;if(!/^(0|[1-9][0-9]{0,18})$/.test(upper))throw new Error('Invalid financial cursor.');
  const allocationBatch=query(`SELECT a.* FROM platform_creator_allocations a JOIN platform_live_receipts r USING(operation_id) WHERE r.rowid>${after} AND r.rowid<=${upper} ORDER BY r.rowid`)[0]?.results;
  if(!Array.isArray(allocationBatch))throw new Error('Missing creator allocations.');allocations.push(...allocationBatch);
  if(batch.length<1000)break;
  after=batch.at(-1).row_sequence;if(!/^[1-9][0-9]{0,18}$/.test(after))throw new Error('Invalid financial cursor.');
 }
 creator_accounting=creatorFinancialFacts(receipts,allocations);
}
console.log(JSON.stringify({report,...exactLedgerTotals(rows),creator_accounting},null,2));
