import {z} from 'zod';
import {PlatformError} from './service.js';
import {proposalSchema,creatorSecretHash,SUBMISSION_BUDGET_SQL} from './submissions.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';

const versionSchema=z.string().regex(/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/).describe('Canonical major.minor.patch, each component 0–999999; metadata approval version, no prerelease/build suffix.');
export const creatorToolIdSchema=z.string().regex(/^creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
export const updateSchema=z.strictObject({request_id:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),creator_secret_hash:z.string().regex(/^[0-9a-f]{64}$/),terms_version:z.string().min(1).max(80),base_version:versionSchema,expected_head_revision:z.number().int().min(0).max(2147483646),proposed_version:versionSchema,proposal:proposalSchema});
export const toolHistorySchema=z.strictObject({limit:z.coerce.number().int().min(1).max(20).default(10),cursor:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/).optional()});
const denied=()=>new PlatformError(403,'creator_capability_invalid','No matching private approved-tool capability.');
const headConflict=()=>new PlatformError(409,'tool_head_conflict','Read the current approved metadata head before proposing an update. The last approved version is retained.');
const increasing=(next,base)=>{const a=next.split('.').map(Number),b=base.split('.').map(Number);for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;};
async function authorized(db,tool,commitment){
 const row=await db.prepare(`SELECT e.tool_id,e.creator_id,e.share_bps,e.revenue_basis,s.terms_json,s.terms_version,h.current_version,h.revision,h.updated_at,v.proposal_json
 FROM platform_creator_entitlements e JOIN platform_creators c ON c.creator_id=e.creator_id
 JOIN platform_tool_submissions s ON s.submission_id=e.submission_id JOIN platform_creator_tool_heads h ON h.tool_id=e.tool_id
 JOIN platform_creator_tool_versions v ON v.tool_id=h.tool_id AND v.version=h.current_version
 WHERE e.tool_id=? AND c.capability_hash=? AND s.state='approved'`).bind(tool,commitment).first();
 if(!row)throw denied();return row;
}
const decisionFor=(db,id)=>db.prepare('SELECT decision,reason,created_at FROM platform_tool_update_decisions WHERE update_id=?').bind(id).first();
function view(row,decision){return {api_version:'1',update_id:row.update_id,tool_id:row.tool_id,base_version:row.base_version,expected_head_revision:row.expected_head_revision,proposed_version:row.proposed_version,state:row.state,revision:row.revision,proposal:JSON.parse(row.proposal_json),terms:JSON.parse(row.terms_json),decision:decision?{decision:decision.decision,reason:decision.reason,created_at:decision.created_at}:null,approval_effect:'metadata_only',payment_effect:'none',transfers_enabled:false,created_at:row.created_at};}
export async function getToolUpdate({db,id,capability}){
 const commitment=await creatorSecretHash(capability);
 const row=await db.prepare('SELECT p.* FROM platform_tool_update_proposals p JOIN platform_creators c ON c.creator_id=p.creator_id WHERE p.update_id=? AND c.capability_hash=?').bind(id,commitment).first();
 if(!row)throw denied();return view(row,await decisionFor(db,id));
}
export async function getCreatorTool({db,tool,capability,params={}}){
 const commitment=await creatorSecretHash(capability),head=await authorized(db,tool,commitment),parsed=toolHistorySchema.safeParse(params);
 if(!parsed.success)throw new PlatformError(400,'invalid_history_query','Use limit 1–20 and the returned cursor.');
 const data=parsed.data;let before=head.revision+1;
 if(data.cursor){try{const cursor=JSON.parse(atob(data.cursor.replaceAll('-','+').replaceAll('_','/')));if(cursor.tool!==tool||!Number.isInteger(cursor.before)||cursor.before<0||cursor.before>2147483648||Object.keys(cursor).length!==2)throw new Error();before=cursor.before;}catch{throw new PlatformError(400,'invalid_cursor','Use the cursor returned for this tool.');}}
 const rows=(await db.prepare('SELECT version,approved_revision,proposal_json,approved_at FROM platform_creator_tool_versions WHERE tool_id=? AND approved_revision<? ORDER BY approved_revision DESC LIMIT ?').bind(tool,before,data.limit+1).all()).results;
 const page=rows.slice(0,data.limit),next=rows.length>data.limit?btoa(JSON.stringify({tool,before:page.at(-1).approved_revision})).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''):null;
 return {api_version:'1',tool_id:tool,current_version:head.current_version,head_revision:head.revision,proposal:JSON.parse(head.proposal_json),terms:JSON.parse(head.terms_json),entitlement:{share_bps:head.share_bps,revenue_basis:head.revenue_basis},history:page.map(r=>({version:r.version,approved_revision:r.approved_revision,proposal:JSON.parse(r.proposal_json),approved_at:r.approved_at})),next_cursor:next,approval_effect:'metadata_only',installed_execution:'separately_reviewed; metadata approval never changes an adapter',payment_effect:'none',transfers_enabled:false};
}
export async function submitToolUpdate({db,tool,body,capability,client,now=()=>new Date()}){
 const parsed=updateSchema.safeParse(body);if(!parsed.success)throw new PlatformError(400,'invalid_tool_update','Use the published bounded update schema.');
 const data=parsed.data,commitment=await creatorSecretHash(capability);
 if(commitment!==data.creator_secret_hash)throw denied();
 if(JSON.stringify(data.proposal).includes(capability))throw new PlatformError(400,'capability_in_proposal','Keep your private capability out of the proposal.');
 const head=await authorized(db,tool,commitment),keyHash=await hash(data.request_id),requestHash=await hash(canonical(data));
 const prior=()=>db.prepare('SELECT * FROM platform_tool_update_proposals WHERE tool_id=? AND creator_id=? AND request_key_hash=?').bind(tool,head.creator_id,keyHash).first();
 const replay=async row=>{if(row.request_hash!==requestHash)throw new PlatformError(409,'tool_update_conflict','Reuse the original request ID, body and capability.');return view(row,await decisionFor(db,row.update_id));};
 const existing=await prior();if(existing)return replay(existing); // Replay survives later head changes.
 if(data.terms_version!==head.terms_version)throw new PlatformError(400,'update_terms_mismatch','Updates preserve the original frozen terms.');
 if(!increasing(data.proposed_version,data.base_version))throw new PlatformError(400,'invalid_update_version','Proposed metadata version must exceed the base version.');
 if(head.current_version!==data.base_version||head.revision!==data.expected_head_revision)throw headConflict();
 const date=now().toISOString(),day=date.slice(0,10)+'T00:00:00.000Z',clientHash=await hash(client),id=crypto.randomUUID();
 try{await db.prepare(`INSERT OR IGNORE INTO platform_tool_update_proposals(update_id,tool_id,creator_id,base_version,expected_head_revision,proposed_version,request_key_hash,request_hash,proposal_json,terms_json,created_at,client_hash)
 SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${SUBMISSION_BUDGET_SQL} AND EXISTS(SELECT 1 FROM platform_creator_tool_heads WHERE tool_id=? AND current_version=? AND revision=?)`)
 .bind(id,tool,head.creator_id,data.base_version,data.expected_head_revision,data.proposed_version,keyHash,requestHash,JSON.stringify(data.proposal),head.terms_json,date,clientHash,day,day,day,clientHash,day,clientHash,tool,data.base_version,data.expected_head_revision).run();}
 catch(e){if(!/tool_head_conflict/.test(String(e)))throw e;const raced=await prior();if(raced)return replay(raced);throw headConflict();}
 const saved=await prior();if(saved)return replay(saved);
 const current=await authorized(db,tool,commitment);if(current.current_version!==data.base_version||current.revision!==data.expected_head_revision)throw headConflict();
 throw new PlatformError(429,'submission_budget_exhausted','The bounded submission budget is exhausted; retry later. No fee was charged.');
}
