import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=new URL('../../',import.meta.url);
const result=spawnSync(process.execPath,[new URL('node_modules/wrangler/bin/wrangler.js',root).pathname,'d1','execute','METRICS_DB','--remote','--config',new URL('../wrangler.jsonc',import.meta.url).pathname,'--json','--command='+readFileSync(new URL('./report.sql',import.meta.url),'utf8')],{stdio:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});
process.exit(result.status??1);
