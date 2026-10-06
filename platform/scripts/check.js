import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
for(const dir of ['src','scripts','test','public']){
 for(const file of readdirSync(new URL('../'+dir+'/',import.meta.url)).filter(x=>x.endsWith('.js'))){
  const result=spawnSync(process.execPath,['--check',new URL('../'+dir+'/'+file,import.meta.url).pathname],{stdio:'inherit'});
  if(result.status)process.exit(result.status);
 }
}
console.log('JavaScript syntax checks passed; this project does not use TypeScript.');
