// A user-saved private request, never browser storage or an authorization grant.
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const bounded=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max;
const version=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/.test(value);
export function retryFingerprint(value){
 if(Array.isArray(value))return '['+value.map(retryFingerprint).join(',')+']';
 if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+retryFingerprint(value[k])).join(',')+'}';
 return JSON.stringify(value);
}
export function validateRetryEnvelope(value,kind){
 const fail=()=>{throw new Error('Use an unchanged private retry request exported by this form. No request was sent.');};
 if(!exact(value,['api_version','kind','path','body'])||value.api_version!=='1'||value.kind!==kind||bytes(value)>20000)fail();
 const update=kind==='creator_update';if(!update&&kind!=='creator_submission')fail();
 if(update?!/^\/v1\/creator-tools\/creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/updates$/.test(value.path):value.path!=='/v1/tool-submissions')fail();
 const body=value.body,keys=['terms_version','creator_secret_hash','proposal','request_id'];
 if(update)keys.push('base_version','expected_head_revision','proposed_version');
 if(!exact(body,keys)||bytes(body)>16384||typeof body.request_id!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(body.request_id)||typeof body.creator_secret_hash!=='string'||!/^[0-9a-f]{64}$/.test(body.creator_secret_hash)||!bounded(body.terms_version,80))fail();
 if(update&&(!version(body.base_version)||!version(body.proposed_version)||!Number.isInteger(body.expected_head_revision)||body.expected_head_revision<0||body.expected_head_revision>2147483646))fail();
 const p=body.proposal;
 if(!exact(p,['name','summary','endpoint_url','input_schema','output_schema'])||!bounded(p.name,120)||!bounded(p.summary,1000)||!bounded(p.endpoint_url,800))fail();
 for(const field of ['input_schema','output_schema'])if(!object(p[field])||bytes(p[field])>4000)fail();
 if(/atbc_[A-Za-z0-9_-]{43}/.test(JSON.stringify(value)))fail();
 // No URL from this envelope is fetched; only the fixed platform route is used.
 return value;
}
export function retryBodyFingerprint(envelope){const {request_id,...body}=envelope.body;return retryFingerprint({path:envelope.path,body});}
