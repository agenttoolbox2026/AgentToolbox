import {mkdir,writeFile,copyFile,readFile} from 'node:fs/promises';
import {createModel} from '../src/model.js';
const root=new URL('../',import.meta.url);
const text=JSON.stringify(await createModel(),null,2)+'\n';
if(process.argv.includes('--check')){
 if(await readFile(new URL('src/generated.json',root),'utf8')!==text)throw new Error('AGI snapshot differs from canonical source. Run npm run agi:build.');
 console.log('AGI snapshot matches canonical source.');
}else{
 await mkdir(new URL('public/',root),{recursive:true});
 await writeFile(new URL('src/generated.json',root),text);
 await copyFile(new URL('../platform/public/agenttoolbox-icon.png',root),new URL('public/agenttoolbox-icon.png',root));
 console.log('Built AGI discovery from canonical registry, criteria, creator and referral terms.');
}
