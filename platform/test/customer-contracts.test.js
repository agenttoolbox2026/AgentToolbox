import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {validateRetryEnvelope,retryBodyFingerprint,retryFingerprint} from '../public/retry-envelope.js';
import {CREATOR_RESPONSE_SCHEMAS} from '../src/creator-responses.js';
import {openapi} from '../src/discovery.js';
import {database} from '../scripts/local-db.js';
import {submitTool,getSubmission,CREATOR_TERMS} from '../src/submissions.js';
import {getCreatorTool,submitToolUpdate,getToolUpdate} from '../src/tool-updates.js';
import {hash} from '../src/telemetry.js';
const require=createRequire(import.meta.url),sdkRequire=createRequire(require.resolve('@modelcontextprotocol/sdk/package.json'));
const Ajv=sdkRequire('ajv/dist/2020.js').default,ajv=new Ajv({strict:false,allErrors:true,validateFormats:false});
const proposal={name:'LOCAL <script>fixture</script>',summary:'Local customer regression',endpoint_url:'https://tool.example/api',input_schema:{type:'object'},output_schema:{type:'object'}};
const capability='atbc_'+Buffer.alloc(32,11).toString('base64url'),tool='creator-00000000-0000-4000-8000-000000000001';
const body={terms_version:CREATOR_TERMS.terms_version,creator_secret_hash:await hash(capability),proposal,request_id:crypto.randomUUID()};
const envelope={api_version:'1',kind:'creator_submission',path:'/v1/tool-submissions',body};
test('saved creator retry envelope round-trips the same request without exporting its capability',()=>{
 const restored=validateRetryEnvelope(JSON.parse(JSON.stringify(envelope)),'creator_submission');assert.deepEqual(restored,envelope);assert(!JSON.stringify(restored).includes(capability));
 const {request_id,...withoutKey}=body;
 assert.equal(retryBodyFingerprint(restored),retryFingerprint({path:envelope.path,body:withoutKey}));
 const reordered={body:Object.fromEntries(Object.entries(withoutKey).reverse()),path:envelope.path};assert.equal(retryBodyFingerprint(restored),retryFingerprint(reordered));
});
test('retry import rejects external routes, role/header grants, capabilities, wrong kinds, malformed IDs and bounds',()=>{
 for(const bad of [
  {...envelope,path:'https://evil.example/v1/tool-submissions'}, {...envelope,path:'//evil.example/v1/tool-submissions'},
  {...envelope,headers:{'X-Creator-Capability':capability}}, {...envelope,kind:'creator_update'},
  {...envelope,body:{...body,request_id:12}}, {...envelope,body:{...body,request_id:'short'}},
  {...envelope,body:{...body,creator_secret_hash:null}}, {...envelope,body:{...body,proposal:{...proposal,summary:capability}}},
  {...envelope,body:{...body,proposal:{...proposal,input_schema:{description:'x'.repeat(4001)}}}},
 ])assert.throws(()=>validateRetryEnvelope(bad,'creator_submission'));
});
test('update retry export preserves stale head and identity for server-authorized exact replay',()=>{
 const update={api_version:'1',kind:'creator_update',path:'/v1/creator-tools/'+tool+'/updates',body:{...body,base_version:'0.1.0',expected_head_revision:0,proposed_version:'0.2.0'}};
 assert.deepEqual(validateRetryEnvelope(JSON.parse(JSON.stringify(update)),'creator_update'),update);
 for(const change of [{expected_head_revision:-1},{expected_head_revision:0.5},{base_version:'00.1.0'},{proposed_version:'1.2.3-beta'}])assert.throws(()=>validateRetryEnvelope({...update,body:{...update.body,...change}},'creator_update'));
 assert.throws(()=>validateRetryEnvelope({...update,path:'/v1/creator-tools/'+tool+'/updates?capability=secret'},'creator_update'));
});
test('typed seller OpenAPI schemas validate real pending, approved, rejected, head/history and update responses',async()=>{
 const db=database(),validate=name=>ajv.compile({$ref:'#/components/schemas/'+name,components:{schemas:CREATOR_RESPONSE_SCHEMAS}});
 const check=(name,value)=>{const schema=validate(name);assert(schema(value),JSON.stringify(schema.errors));assert(!JSON.stringify(value).includes(capability));};
 try {
  const saved=await submitTool({db,body,capability,client:'customer-test'});check('CreatorSubmission',saved);
  await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),saved.submission_id,'local-owner',await hash(crypto.randomUUID()),'a'.repeat(64),0,1,'approved','Local only','2026-10-07T10:00:00.000Z').run();
  check('CreatorSubmission',await getSubmission({db,id:saved.submission_id,capability}));check('CreatorTool',await getCreatorTool({db,tool:saved.tool_id,capability}));
  const rejected=await submitTool({db,body:{...body,request_id:crypto.randomUUID()},capability,client:'customer-test'});
  await db.prepare('INSERT INTO platform_submission_decisions VALUES(?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),rejected.submission_id,'local-owner',await hash(crypto.randomUUID()),'b'.repeat(64),0,1,'rejected','Local only','2026-10-07T10:00:00.000Z').run();
  check('CreatorSubmission',await getSubmission({db,id:rejected.submission_id,capability}));
  const update=await submitToolUpdate({db,tool:saved.tool_id,body:{...body,request_id:crypto.randomUUID(),base_version:'0.1.0',expected_head_revision:0,proposed_version:'0.2.0'},capability,client:'customer-test'});check('CreatorUpdate',update);
  await db.prepare('INSERT INTO platform_tool_update_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),update.update_id,'local-owner',await hash(crypto.randomUUID()),'c'.repeat(64),0,1,0,'approved','Local only','2026-10-07T10:00:00.000Z').run();
  check('CreatorUpdate',await getToolUpdate({db,id:update.update_id,capability}));check('CreatorTool',await getCreatorTool({db,tool:saved.tool_id,capability}));
  const spec=openapi('https://example.invalid');for(const [path,method,name] of [['/v1/tool-submissions','post','CreatorSubmission'],['/v1/tool-submissions/{id}','get','CreatorSubmission'],['/v1/creator-tools/{tool_id}','get','CreatorTool'],['/v1/creator-tools/{tool_id}/updates','post','CreatorUpdate'],['/v1/tool-updates/{id}','get','CreatorUpdate']])assert.equal(spec.paths[path][method].responses[200].content['application/json'].schema.$ref,'#/components/schemas/'+name);
 } finally {db.sqlite.close();}
});
