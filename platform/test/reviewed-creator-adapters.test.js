import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {database} from '../scripts/local-db.js';
import {submitTool,CREATOR_TERMS} from '../src/submissions.js';
import {hash} from '../src/telemetry.js';
import {successContractPin} from '../src/contract-pins.js';
import {resolveCreatorInstallation} from '../src/creator-installations.js';
import {createReviewedCreatorRegistry,reviewedCreatorRegistry} from '../src/reviewed-creator-adapters.js';
const capability='atbc_'+Buffer.alloc(32,29).toString('base64url'),date='2026-10-07T10:00:00.000Z';
async function entry(toolId='creator-00000000-0000-4000-8000-000000000001'){
 const input=z.strictObject({value:z.number().int()}),output=z.strictObject({doubled:z.number().int()});
 const product={id:toolId,version:'0.1.0',name:'Local fixture',summary:'Local test fixture only',status:'active',provider:{type:'creator',id:'local'},outcome:{success_criterion:'Integer doubled exactly'},limits:{max_output_bytes:1000},input_schema:z.toJSONSchema(input),output_schema:z.toJSONSchema(output)};
 const pin=await successContractPin(product);
 return {manifestId:'local-reviewed-v1',toolId,metadataRevision:0,metadataVersion:'0.1.0',sourceCommit:'a'.repeat(40),artifactSha256:'b'.repeat(64),successContractSha256:pin.sha256,productVersion:'0.1.0',adapterId:'compiled-local-fixture-v1',product,handler:{input,output,run:async({value})=>({doubled:value*2}),success:r=>Number.isInteger(r.doubled),creatorAdapterId:'compiled-local-fixture-v1',creatorArtifactSha256:'b'.repeat(64),creatorContractSha256:pin.sha256}};
}
const invalid=e=>e.code==='invalid_reviewed_creator_manifest';
test('default compiled registry contains no invented seller; owner manifests expose bounded metadata only',async()=>{
 const empty=await reviewedCreatorRegistry;assert.deepEqual(empty.listManifests(),[]);assert.deepEqual(empty.getRuntime(),{products:[],handlers:{}});
 const e=await entry();
 const registry=await createReviewedCreatorRegistry([e]),manifest=registry.readManifest(e.manifestId);
 assert.equal(manifest.sourceCommit,e.sourceCommit);assert.equal(manifest.name,'Local fixture');
 for(const key of ['product','handler','env','run','input','output'])assert(!Object.hasOwn(manifest,key));assert(!JSON.stringify(registry.listManifests()).includes('never-in-owner-read'));
 assert(Object.isFrozen(registry));assert(Object.isFrozen(manifest));assert(Object.isFrozen(registry.listManifests()));
 assert.throws(()=>registry.readManifest('unknown'),e=>e.code==='reviewed_creator_manifest_not_found');
});
test('trusted manifests reject unknown fields, duplicate tools, invalid provenance, mismatched declarations and actual contract pins',async()=>{
 const e=await entry();
 for(const patch of [{toolId:'creator-local-fixture'},{toolId:'creator-00000000-0000-0000-0000-000000000001'},{manifestId:'https://source.example/code'},{sourceCommit:'main'},{artifactSha256:'x'.repeat(64)},{metadataRevision:-1},{metadataVersion:'latest'},{productVersion:'1.2.3'},{url:'https://source.example/code'},{successContractSha256:'c'.repeat(64)}])await assert.rejects(createReviewedCreatorRegistry([{...e,...patch}]),invalid);
 for(const field of ['creatorAdapterId','creatorArtifactSha256','creatorContractSha256'])await assert.rejects(createReviewedCreatorRegistry([{...e,handler:{...e.handler,[field]:'wrong'}}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([{...e,product:{...e.product,outcome:{success_criterion:'Changed'}}}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([{...e,handler:{...e.handler,run:'eval-code'}}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([{...e,handler:{...e.handler,env:{secret:'never-in-owner-read'}}}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([{...e,handler:{...e.handler,input:z.strictObject({different:z.string()})}}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([e,{...e,manifestId:'second'}]),invalid);
 await assert.rejects(createReviewedCreatorRegistry([e,e]),invalid);
});
test('compiled product and handler declarations are snapshotted; runtime includes known products for tombstones',async()=>{
 const e=await entry(),registry=await createReviewedCreatorRegistry([e]),runtime=registry.getRuntime();
 e.product.outcome.success_criterion='Mutated';e.product.limits.max_output_bytes=1;e.handler.creatorArtifactSha256='c'.repeat(64);e.handler.run=()=>{throw Error('Mutated');};
 assert.equal(runtime.products[0].outcome.success_criterion,'Integer doubled exactly');assert.equal(runtime.products[0].limits.max_output_bytes,1000);assert.equal(runtime.handlers[e.toolId].creatorArtifactSha256,'b'.repeat(64));
 assert(Object.isFrozen(runtime.products[0].outcome));assert(Object.isFrozen(runtime.handlers));
 assert.deepEqual(await runtime.handlers[e.toolId].run({value:2}),{doubled:4});
 assert.throws(()=>{runtime.products[0].outcome.success_criterion='Changed';},TypeError);
});
test('approved local fixture installs from allowlist, executes with audited bindings, suspends and preserves replay',async()=>{
 const db=database();try{
 db.sqlite.exec('PRAGMA foreign_keys=ON');
 const s=await submitTool({db,body:{request_id:crypto.randomUUID(),creator_secret_hash:await hash(capability),terms_version:CREATOR_TERMS.terms_version,proposal:{name:'Local fixture',summary:'Local reviewed fixture only',endpoint_url:'https://fixture.example/api',input_schema:{type:'object'},output_schema:{type:'object'}}},capability,client:'reviewed-fixture',now:()=>new Date(date)});
 await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),s.submission_id,'local-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'approved','Local fixture',date).run();
 const e=await entry(s.tool_id),registry=await createReviewedCreatorRegistry([e]),runtime=registry.getRuntime();
 const install={db,reviewer:'local-owner',requestId:crypto.randomUUID(),manifestId:e.manifestId,expectedRevision:0,now:()=>new Date(date)};
 await assert.rejects(registry.install({...install,manifestId:'unknown'}),e=>e.code==='reviewed_creator_manifest_not_found');
 for(const overrides of [{artifactSha256:'c'.repeat(64)},{toolId:s.tool_id},{url:'https://source.example/code'},{entries:[e]}])await assert.rejects(registry.install({...install,...overrides}),invalid);
 const approved=await registry.install(install),product=runtime.products[0],handler=runtime.handlers[s.tool_id];
 assert.equal((await resolveCreatorInstallation({db,product,handler})).installation_id,approved.installation_id);
 assert.deepEqual(await handler.run(handler.input.parse({value:3})),{doubled:6});
 const suspend={db,reviewer:'local-owner',requestId:crypto.randomUUID(),toolId:s.tool_id,expectedRevision:1,now:()=>new Date(date)};
 await assert.rejects(registry.suspend({...suspend,artifactSha256:'c'.repeat(64)}),invalid);
 const suspended=await registry.suspend(suspend);assert.equal(suspended.state,'suspended');
 await assert.rejects(resolveCreatorInstallation({db,product,handler}),e=>e.code==='creator_adapter_unavailable');
 assert.deepEqual(await registry.install(install),approved);assert.deepEqual(await registry.suspend(suspend),suspended);
 assert.equal(registry.getRuntime().products[0].id,s.tool_id);assert.equal(registry.readManifest(e.manifestId).toolId,s.tool_id);
 assert.equal(db.sqlite.prepare('SELECT count(*) n FROM platform_creator_installation_events').get().n,2);
 }finally{db.close();}
});
