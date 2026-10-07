import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createModel} from '../src/model.js';
const root=new URL('../',import.meta.url);
const text=JSON.stringify(await createModel(),null,2)+'\n';
const assets={'agenttoolbox-icon.png':'agenttoolbox-icon.png','style.css':'workflow.css','site.js':'site.js','retry-envelope.js':'retry-envelope.js'};
if(process.argv.includes('--check')){
 if(await readFile(new URL('src/generated.json',root),'utf8')!==text)throw new Error('AGI snapshot differs from canonical source. Run npm run agi:build.');
 for(const [source,target]of Object.entries(assets))if(!(await readFile(new URL('public/'+target,root))).equals(await readFile(new URL('../platform/public/'+source,root))))throw new Error('AGI workflow asset differs from platform: '+target);
 console.log('AGI snapshot and workflow assets match canonical source.');
}else{
 await mkdir(new URL('public/',root),{recursive:true});
 await writeFile(new URL('src/generated.json',root),text);
 for(const [source,target]of Object.entries(assets))await copyFile(new URL('../platform/public/'+source,root),new URL('public/'+target,root));
 console.log('Built AGI discovery from canonical registry, criteria, creator and referral terms.');
}
