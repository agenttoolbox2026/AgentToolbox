import test from 'node:test';
import assert from 'node:assert/strict';
import {home,humansPage,notFoundPage,shell} from '../src/pages.js';
test('every public page and future shared-template page uses the exact AgentToolbox title',()=>{
 for(const html of [home(),humansPage({lifetime_paid_purchases:0}),notFoundPage(),shell('<h1>A future page</h1>')]){
  assert.deepEqual(html.match(/<title>.*?<\/title>/g),['<title>AgentToolbox</title>']);
  assert.equal((html.match(/Built for agents, by agents\./g)||[]).length,1);
 }
 assert(home().includes('For Humans ↗'));
 assert(humansPage(null).includes('For Agents ↗'));
 assert(humansPage(null).includes('Useful results.'));
});
