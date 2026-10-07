import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createAgi} from '../src/worker.js';
import {createWalletClient} from '../public/creator-wallet.js';
import {database} from '../../platform/scripts/local-db.js';
import {hash} from '../../platform/src/telemetry.js';

const origin='https://agi.agenttoolbox2026.workers.dev';
const capability='atbc_'+Buffer.alloc(32,27).toString('base64url');
const address='0x'+'2'.repeat(40);
test('wallet HTML and script keep secrets out of documents, asset requests and native fallback',async()=>{
 const worker=createAgi(),assetRequests=[];
 const env={ASSETS:{fetch:async request=>{assetRequests.push(request);return new Response('// fixture',{headers:{'content-type':'text/javascript'}});}}};
 const headers={'X-Creator-Capability':capability,Authorization:'private-auth'};
 const page=await worker.fetch(new Request(origin+'/creator-wallet?capability=private-query',{headers}),env);
 assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');
 const policy=page.headers.get('content-security-policy');
 for(const value of ["script-src 'self'","connect-src 'self'","form-action 'self'","frame-ancestors 'none'"])assert(policy.includes(value));
 const html=await page.text();assert(!html.includes(capability));assert.doesNotMatch(html,/private-query|private-auth/);
 assert.match(html,/<form[^>]*method="post" action="\/v1\/creators\/me\/payout-wallet"/);
 const head=await worker.fetch(new Request(origin+'/creator-wallet',{method:'HEAD'}),env);assert.equal(await head.text(),'');
 assert.equal((await worker.fetch(new Request(origin+'/creator-wallet',{method:'POST',body:'private-body'}),env)).status,405);
 const asset=await worker.fetch(new Request(origin+'/creator-wallet.js?private=query',{headers}),env);
 assert.equal(asset.headers.get('cache-control'),'no-store');assert.equal(assetRequests.length,1);
 assert.equal(assetRequests[0].url,origin+'/creator-wallet.js');assert.equal([...assetRequests[0].headers].length,0);
});

test('wallet browser client restores a lost response through real AGI routes without duplicating records',async t=>{
 t.mock.method(globalThis,'fetch',()=>{throw new Error('No external requests in wallet integration tests.');});
 const db=database();t.after(()=>db.close());
 await db.prepare('INSERT INTO platform_creators VALUES(?,?,?)').bind('local-wallet-fixture',await hash(capability),new Date().toISOString()).run();
 const allow={limit:async()=>({success:true})};
 const env={METRICS_DB:db,PUBLIC_ORIGIN:origin,CLIENT_LIMIT:allow,SERVICE_LIMIT:allow,FEEDBACK_LIMIT:allow};
 const worker=createAgi();let loseResponse=true;
 const fetchImpl=async(path,init)=>{
  const response=await worker.fetch(new Request(origin+path,init),env);
  if(init.method==='POST'&&loseResponse){loseResponse=false;assert.equal(response.status,200);throw new Error('Local simulated response loss');}
  return response;
 };
 const client=createWalletClient({cryptoImpl:webcrypto,fetchImpl});
 assert.equal(await client.read(capability),null);
 const envelope=await client.prepare(address,capability);
 await assert.rejects(client.send(capability),/uncertain/);
 const reload=createWalletClient({cryptoImpl:webcrypto,fetchImpl});
 await reload.restore(envelope,capability);
 const replay=await reload.send(capability);assert.equal(replay.revision,1);assert.equal(replay.address,address);
 assert.equal((await reload.read(capability)).revision,1);
 assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM platform_creator_wallet_claims').get().n,1);
 for(const table of ['platform_payments','platform_creator_payouts','platform_creator_allocations'])assert.equal(db.sqlite.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 const native=await worker.fetch(new Request(origin+'/v1/creators/me/payout-wallet',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'capability=private-native'}),env);
 assert.equal(native.status,415);assert(!(await native.text()).includes('private-native'));
});
