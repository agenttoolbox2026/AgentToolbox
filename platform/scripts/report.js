import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {exactLedgerTotals} from '../src/exact-totals.js';
const root=new URL('../../',import.meta.url);
function query(sql){
 const result=spawnSync(process.execPath,[new URL('node_modules/wrangler/bin/wrangler.js',root).pathname,'d1','execute','METRICS_DB','--remote','--config',new URL('../wrangler.jsonc',import.meta.url).pathname,'--json','--command='+sql],{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
 if(result.status!==0)throw new Error('D1 report read failed. No partial totals reported.');
 return JSON.parse(result.stdout);
}
const report=query(readFileSync(new URL('./report.sql',import.meta.url),'utf8'));
const rows=[],cutoff=new Date().toISOString();let cursor='';
for(let page=0;;page++){
 if(page>=100)throw new Error('Report exceeds 100,000 ledger rows; export for exact offline aggregation. No partial totals reported.');
 const batch=query(`SELECT event_id,product_id,version,sample_kind,event,amount_atomic,created_at FROM platform_payment_ledger WHERE event_id>'${cursor}' AND created_at<='${cutoff}' ORDER BY event_id LIMIT 1000`)[0]?.results;
 if(!Array.isArray(batch))throw new Error('Missing ledger rows.');rows.push(...batch);
 if(batch.length<1000)break;
 cursor=batch.at(-1).event_id;if(!/^[0-9a-f-]{32,36}$/.test(cursor))throw new Error('Invalid event cursor.');
}
console.log(JSON.stringify({report,...exactLedgerTotals(rows)},null,2));
