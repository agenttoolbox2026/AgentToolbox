import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {start} from '../scripts/dev.js';
import {start as startAgi} from '../../agi/scripts/dev.js';

test('documented local server serves the workflow entrypoint and its imported retry module',async()=>{
 const server=await start({port:0,persist:false});
 try{
  for(const name of ['site.js','retry-envelope.js']){
   const response=await fetch(server.origin+'/'+name);
   assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/javascript/);
   assert.equal(await response.text(),await readFile(new URL('../public/'+name,import.meta.url),'utf8'));
  }
 }finally{await server.close();}
});

test('AGI local server serves the wallet entrypoints and their shared busy-control dependency',async()=>{
 const server=await startAgi({port:0});
 try{
  for(const name of ['creator-wallet.js','wallet-proof.js','busy-controls.js']){
   const response=await fetch(server.origin+'/'+name);
   assert.equal(response.status,200);assert.match(response.headers.get('Content-Type'),/javascript/);
   assert.equal(await response.text(),await readFile(new URL('../../agi/public/'+name,import.meta.url),'utf8'));
  }
 }finally{await server.close();}
});
