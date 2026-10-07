import {z} from 'zod';
import {InitializeResultSchema,ListToolsResultSchema} from '@modelcontextprotocol/sdk/types.js';
import {passesCriteria,WIRE_DECISIVE_REASONS} from './criteria.js';

// Cloudflare owns and routes workers.dev; customers select Worker/account
// labels, not arbitrary A/AAAA/CNAME records or destination IPs. See the
// provider-boundary evidence in docs/mcp-wirecheck.md. Custom domains remain
// excluded: a DNS preflight cannot pin a subsequent Workers fetch connection.
// This list contains examples, not an exhaustive endpoint allowlist.
export const MCP_WIRE_ENDPOINTS=Object.freeze(['https://agnttoolbx.agenttoolbox2026.workers.dev/mcp']);
export const MCP_WIRE_ENDPOINT_SCOPE=Object.freeze({provider:'Cloudflare Workers',hostname_format:'<worker>.<account>.workers.dev',paths:Object.freeze(['/mcp','/mcp/']),custom_domains:false,redirects:0});
const workerLabel='[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const endpointPattern=new RegExp('^https://'+workerLabel+'\\.'+workerLabel+'\\.workers\\.dev/mcp/?$');
export const MCP_WIRE_VERSIONS=Object.freeze(['2025-11-25','2026-07-28']);
export const MCP_WIRE_LIMITS=Object.freeze({max_versions:2,max_response_bytes:65536,max_total_bytes:262144,max_tool_pages:3,max_tools:100,max_sse_events:16,max_requests:10,request_timeout_ms:4000,total_timeout_ms:20000,max_output_bytes:14000,redirects:0});
export const MCP_WIRE_AUTHORITY='I own this endpoint or am authorized to request its anonymous read-only MCP discovery.';

export function publicMcpEndpoint(value){
 if(typeof value!=='string'||value.length>256||!endpointPattern.test(value))return null;
 // Some ASCII labels pass the shape check but fail URL's IDNA parser.
 // Treat those as ordinary invalid input rather than an internal error.
 let u;try{u=new URL(value);}catch{return null;}
 const labels=u.hostname.split('.');
 // Punycode is not needed for the documented lowercase ASCII Worker names.
 if(labels.some(label=>label.startsWith('xn--')))return null;
 return u.href===value&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&!u.search&&!u.hash?u.href:null;
}
const endpointSchema=z.string().max(256).regex(endpointPattern).refine(value=>!!publicMcpEndpoint(value),'Use canonical https://<worker>.<account>.workers.dev/mcp (optional trailing slash); no credentials, query, fragments, encoded names or ports.');
export const mcpWireCheckInput=z.strictObject({
 endpoint:endpointSchema,
 protocol_versions:z.array(z.enum(MCP_WIRE_VERSIONS)).min(1).max(2).default(['2025-11-25','2026-07-28']),
 authority:z.literal(MCP_WIRE_AUTHORITY),
}).refine(input=>new Set(input.protocol_versions).size===input.protocol_versions.length,'Protocol versions must be distinct.');

const methods=['initialize','notifications/initialized','server/discover','tools/list'];
const locations=methods;
const reasons=['checked_scope_passed','requested_version_not_negotiated','unsupported_negotiated_version','version_not_supported','method_not_supported','tools_capability_absent','invalid_initialize_shape','invalid_discovery_shape','invalid_tools_shape','invalid_header_annotation','schema_inspection_limit','duplicate_tool_name','invalid_jsonrpc','response_id_mismatch','invalid_notification_ack','invalid_session_header','unexpected_session_change','unexpected_modern_session','unsupported_content_type','invalid_json','redirect_not_followed','authentication_required','access_blocked','http_error','rpc_error','network_error','timeout','response_limit','total_byte_limit','sse_event_limit','sse_incomplete','server_request_not_supported','page_limit','tool_limit','cursor_loop','cursor_limit','request_limit'];
const decisive=new Set(WIRE_DECISIVE_REASONS);
const transcriptSchema=z.strictObject({
 method:z.enum(methods),http_status:z.number().int().min(100).max(599).nullable(),
 media_type:z.enum(['application/json','text/event-stream','other','none']),
 response_kind:z.enum(['result','notification_ack','rpc_error','http_error','invalid','incomplete']),
 response_bytes:z.number().int().min(0).max(MCP_WIRE_LIMITS.max_response_bytes),
 rpc_error_code:z.number().int().safe().nullable(),tool_count:z.number().int().min(0).max(100).nullable(),session_present:z.boolean(),
});
const rowSchema=z.strictObject({
 requested_version:z.enum(MCP_WIRE_VERSIONS),effective_version:z.enum(MCP_WIRE_VERSIONS).nullable(),
 status:z.enum(['compatible','incompatible','unsupported','auth_required','blocked','unknown']),reason:z.enum(reasons),
 discovery_valid:z.boolean(),
 failure_location:z.enum(locations).nullable(),tool_count:z.number().int().min(0).max(100).nullable(),
 pagination:z.enum(['complete','not_run','limited']),transcript:z.array(transcriptSchema).max(5),
 replay:z.strictObject({initialize:z.string().max(1100).nullable(),initialized:z.string().max(800).nullable(),discover:z.string().max(1100).nullable(),tools_list:z.string().max(1100),session_header_required:z.boolean()}),
});
export const mcpWireCheckOutput=z.strictObject({
 endpoint:endpointSchema,checked_at:z.string().datetime(),source_content:z.literal('untrusted_data'),
 scope:z.literal('Version-specific discovery and bounded tools/list wire-shape checks; not protocol or security certification'),
 versions:z.array(rowSchema).min(1).max(2),request_count:z.number().int().min(0).max(10),response_bytes:z.number().int().min(0).max(262144),
 complete:z.boolean(),preview_supported:z.literal(false),
});

class CheckFailure extends Error{constructor(code){super(code);this.code=code;}}
const fail=code=>{throw new CheckFailure(code);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const mediaType=response=>{const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();return !type?'none':['application/json','text/event-stream'].includes(type)?type:'other';};
const quoted=value=>"'"+value.replace(/'/g,"'\\''")+"'";

function replayCommands(endpoint,version,sessionRequired){
 const base=`curl --proto '=https' --max-redirs 0 --max-time 4 -sS -i --request POST ${quoted(endpoint)} --header 'Content-Type: application/json' --header 'Accept: application/json, text/event-stream'`;
 if(version==='2026-07-28'){
  const command=(method,id)=>base+` --header 'MCP-Protocol-Version: ${version}' --header 'Mcp-Method: ${method}' --data-raw `+quoted(JSON.stringify({jsonrpc:'2.0',id,method,params:{_meta:modernMeta()}}));
  return {initialize:null,initialized:null,discover:command('server/discover',1),tools_list:command('tools/list',2),session_header_required:false};
 }
 const init=JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:version,capabilities:{},clientInfo:{name:'AgentToolbox-WireCheck',version:'0.1.0'}}});
 const subsequent=base+` --header 'MCP-Protocol-Version: ${version}'`+(sessionRequired?' --header "Mcp-Session-Id: ${MCP_SESSION_ID:?set locally from the initialize response}"':'');
 return {initialize:base+' --data-raw '+quoted(init),initialized:subsequent+' --data-raw '+quoted(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})),discover:null,tools_list:subsequent+' --data-raw '+quoted(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/list',params:{}})),session_header_required:sessionRequired};
}

const modernMeta=()=>({'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'AgentToolbox-WireCheck',version:'0.1.0'},'io.modelcontextprotocol/clientCapabilities':{}});
const modernDiscovery=z.object({resultType:z.literal('complete').optional(),supportedVersions:z.array(z.string()).min(1).max(20),capabilities:z.object({tools:z.object({}).optional()}).catchall(z.unknown())});
// 2026 permits non-object output schemas. Do not reuse the SDK 1.32.1
// legacy outputSchema restriction, or pretend to validate schema semantics.
const modernTools=z.object({resultType:z.literal('complete').optional(),tools:z.array(z.object({name:z.string(),inputSchema:z.object({type:z.literal('object')}).catchall(z.unknown()),outputSchema:z.union([z.object({}).catchall(z.unknown()),z.boolean()]).optional()})),nextCursor:z.string().optional()});
function inspectHeaderAnnotations(root){
 const stack=[{node:root,reachable:true,property:false,depth:0}],seen=new Set();let count=0;
 while(stack.length){
  const {node,reachable,property,depth}=stack.pop();if(!object(node))continue;
  if(++count>1024||depth>24)fail('schema_inspection_limit');
  if(own(node,'x-mcp-header')){
   const name=node['x-mcp-header'];
   if(typeof name==='string'&&name.length>128)fail('schema_inspection_limit');
   if(!property||!reachable||typeof name!=='string'||!name||!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)||!['string','integer','boolean'].includes(node.type)||seen.has(name.toLowerCase()))fail('invalid_header_annotation');
   seen.add(name.toLowerCase());
  }
  for(const key of ['properties','patternProperties','$defs','definitions','dependentSchemas'])if(object(node[key]))for(const child of Object.values(node[key]))stack.push({node:child,reachable:reachable&&key==='properties',property:key==='properties',depth:depth+1});
  for(const key of ['anyOf','oneOf','allOf','prefixItems'])if(Array.isArray(node[key]))for(const child of node[key])stack.push({node:child,reachable:false,property:false,depth:depth+1});
  for(const key of ['items','additionalProperties','unevaluatedProperties','contains','not','if','then','else','propertyNames'])if(object(node[key]))stack.push({node:node[key],reachable:false,property:false,depth:depth+1});
 }
}

function parseJson(text){try{return JSON.parse(text);}catch{fail('invalid_json');}}
function envelope(value,id,allowNotification=false){
 if(!object(value)||value.jsonrpc!=='2.0')fail('invalid_jsonrpc');
 if(typeof value.method==='string'){
  if(own(value,'id'))fail('server_request_not_supported');
  if(allowNotification&&!own(value,'result')&&!own(value,'error'))return null;
  fail('invalid_jsonrpc');
 }
 if(value.id!==id)fail('response_id_mismatch');
 if(own(value,'result')===own(value,'error'))fail('invalid_jsonrpc');
 if(own(value,'error')&&(!object(value.error)||!Number.isSafeInteger(value.error.code)||typeof value.error.message!=='string'))fail('invalid_jsonrpc');
 return value;
}

// Only fixed structural facts enter transcripts. Server descriptions, names,
// instructions, headers, cursors, error text/data and session IDs never leave.
async function readReply(response,id,entry,state,signal,notification=false){
 const expected=Number(response.headers.get('content-length')??0);
 if(expected>MCP_WIRE_LIMITS.max_response_bytes){await response.body?.cancel();fail('response_limit');}
 if(!response.body){if(notification)return null;fail('sse_incomplete');}
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 let buffer='',events=0,bytes=0;
 const read=()=>new Promise((resolve,reject)=>{
  const abort=()=>reject(new CheckFailure('timeout'));
  if(signal.aborted)return abort();
  signal.addEventListener('abort',abort,{once:true});
  reader.read().then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
 try{
  while(true){
   let chunk;try{chunk=await read();}catch(error){if(error instanceof CheckFailure)throw error;fail('network_error');}
   if(chunk.done){
    try{buffer+=decoder.decode();}catch{fail('invalid_json');}
    if(notification){if(bytes)fail('invalid_notification_ack');return null;}
    if(entry.media_type==='application/json')return envelope(parseJson(buffer),id);
    fail('sse_incomplete');
   }
   bytes+=chunk.value.byteLength;
   if(bytes>MCP_WIRE_LIMITS.max_response_bytes)fail('response_limit');
   if(state.bytes+chunk.value.byteLength>MCP_WIRE_LIMITS.max_total_bytes)fail('total_byte_limit');
   state.bytes+=chunk.value.byteLength;entry.response_bytes=bytes;
   if(notification)fail('invalid_notification_ack');
   try{buffer+=decoder.decode(chunk.value,{stream:true});}catch{fail('invalid_json');}
   if(entry.media_type!=='text/event-stream')continue;
   // Normalize CRLF and CR only after retaining an incomplete final CR.
   let end;
   while((end=/\r\n\r\n|\n\n|\r\r/.exec(buffer))){
    const event=buffer.slice(0,end.index);buffer=buffer.slice(end.index+end[0].length);
    if(++events>MCP_WIRE_LIMITS.max_sse_events)fail('sse_event_limit');
    const lines=event.split(/\r\n|\r|\n/),data=lines.filter(line=>line.startsWith('data:')).map(line=>line.slice(5).replace(/^ /,'')),eventName=lines.find(line=>line.startsWith('event:'))?.slice(6).trim();
    if(eventName&&eventName!=='message')continue;
    if(!data.join('\n'))continue;
    const message=envelope(parseJson(data.join('\n')),id,true);
    if(message)return message;
   }
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export function createMcpWireCheck({fetchImpl=fetch,now=()=>new Date(),requestTimeoutMs=MCP_WIRE_LIMITS.request_timeout_ms,totalTimeoutMs=MCP_WIRE_LIMITS.total_timeout_ms}={}){
 // Injection can shorten deadlines for local tests but cannot raise bounds.
 const perRequest=Math.max(1,Math.min(MCP_WIRE_LIMITS.request_timeout_ms,requestTimeoutMs));
 const totalTime=Math.max(1,Math.min(MCP_WIRE_LIMITS.total_timeout_ms,totalTimeoutMs));
 return {input:mcpWireCheckInput,output:mcpWireCheckOutput,previewSupported:false,
  failureReason:error=>error instanceof CheckFailure?error.code:'wirecheck_unavailable',
  success:output=>mcpWireCheckOutput.safeParse(output).success&&passesCriteria('mcp-wirecheck',output),
  async run(raw){
   const parsed=mcpWireCheckInput.safeParse(raw);if(!parsed.success)fail('invalid_wirecheck_input');
   const input=parsed.data,state={requests:0,bytes:0},versions=[],start=Date.now();
   for(const version of input.protocol_versions){
    const modern=version==='2026-07-28',firstMethod=modern?'server/discover':'initialize';
    const row={requested_version:version,effective_version:null,status:'unknown',reason:'network_error',discovery_valid:false,failure_location:firstMethod,tool_count:null,pagination:'not_run',transcript:[],replay:replayCommands(input.endpoint,version,false)};
    let session=null,phase=firstMethod;
    const exchange=async(method,params,id)=>{
     if(!methods.includes(method))fail('invalid_wirecheck_method');
     phase=method;
     const remaining=totalTime-(Date.now()-start);if(remaining<=0)fail('timeout');
     if(state.requests>=MCP_WIRE_LIMITS.max_requests)fail('request_limit');
     const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(perRequest,remaining));
     const entry={method,http_status:null,media_type:'none',response_kind:'incomplete',response_bytes:0,rpc_error_code:null,tool_count:null,session_present:false};row.transcript.push(entry);
     const headers={'Content-Type':'application/json','Accept':'application/json, text/event-stream','User-Agent':'AgentToolbox-WireCheck/0.1 (+https://agnttoolbx.agenttoolbox2026.workers.dev/humans)'};
     if(modern){headers['MCP-Protocol-Version']=version;headers['Mcp-Method']=method;params={...(params??{}),_meta:modernMeta()};}
     else if(method!=='initialize'){headers['MCP-Protocol-Version']=row.effective_version;if(session)headers['Mcp-Session-Id']=session;}
     const message={jsonrpc:'2.0',...(id===undefined?{}:{id}),method,...(params===undefined?{}:{params})};
     try{
      state.requests++;
      const response=await new Promise((resolve,reject)=>{
       const aborted=()=>reject(new CheckFailure('timeout'));
       controller.signal.addEventListener('abort',aborted,{once:true});
       Promise.resolve().then(()=>fetchImpl(input.endpoint,{method:'POST',headers,body:JSON.stringify(message),redirect:'manual',credentials:'omit',signal:controller.signal})).then(value=>{if(controller.signal.aborted){value.body?.cancel().catch(()=>{});return;}resolve(value);},reject).finally(()=>controller.signal.removeEventListener('abort',aborted));
      });
      entry.http_status=response.status;entry.media_type=mediaType(response);
      if(response.redirected||response.status>=300&&response.status<400||response.url&&response.url!==input.endpoint){await response.body?.cancel();fail('redirect_not_followed');}
      if(response.status>=400){
       entry.response_kind='http_error';
       if(modern&&[400,404].includes(response.status)&&['application/json','text/event-stream'].includes(entry.media_type)){
        let errorReply;try{errorReply=await readReply(response,id,entry,state,controller.signal);}catch(error){if(['timeout','response_limit','total_byte_limit'].includes(error.code))throw error;fail('http_error');}
        if(own(errorReply,'error')){
         entry.response_kind='rpc_error';entry.rpc_error_code=errorReply.error.code;
         const data=errorReply.error.data;
         if(response.status===400&&errorReply.error.code===-32022&&object(data)&&data.requested===version&&Array.isArray(data.supported)&&data.supported.length>0&&data.supported.length<=20&&data.supported.every(v=>typeof v==='string')&&!data.supported.includes(version))fail('version_not_supported');
         if(response.status===404&&errorReply.error.code===-32601)fail('method_not_supported');
         fail('rpc_error');
        }
       }else await response.body?.cancel();
       fail(response.status===401?'authentication_required':response.status===403?'access_blocked':'http_error');
      }
      const receivedSession=response.headers.get('mcp-session-id');entry.session_present=receivedSession!==null;
      if(receivedSession!==null){
       if(modern){await response.body?.cancel();fail('unexpected_modern_session');}
       if(!/^[\x21-\x7e]{1,256}$/.test(receivedSession)){await response.body?.cancel();fail('invalid_session_header');}
       if(method==='initialize')session=receivedSession;
       else if(receivedSession!==session){await response.body?.cancel();fail('unexpected_session_change');}
      }
      row.replay=replayCommands(input.endpoint,version,session!==null);
      if(method==='notifications/initialized'){
       if(response.status!==202){await response.body?.cancel();fail('invalid_notification_ack');}
       await readReply(response,id,entry,state,controller.signal,true);entry.response_kind='notification_ack';return null;
      }
      if(response.status!==200){await response.body?.cancel();fail('http_error');}
      if(!['application/json','text/event-stream'].includes(entry.media_type)){await response.body?.cancel();fail('unsupported_content_type');}
      const reply=await readReply(response,id,entry,state,controller.signal);
      if(own(reply,'error')){entry.response_kind='rpc_error';entry.rpc_error_code=reply.error.code;fail('rpc_error');}
      entry.response_kind='result';return reply.result;
     }catch(error){
      if(error instanceof CheckFailure){if(decisive.has(error.code))entry.response_kind='invalid';throw error;}
      fail(controller.signal.aborted?'timeout':'network_error');
     }finally{clearTimeout(timer);controller.abort();}
    };
    try{
     if(modern){
      const result=await exchange('server/discover',{},1),discovery=modernDiscovery.safeParse(result);
      if(!discovery.success)fail('invalid_discovery_shape');
      row.discovery_valid=true;
      if(!discovery.data.supportedVersions.includes(version))fail('version_not_supported');
      row.effective_version=version;
      if(!discovery.data.capabilities.tools)fail('tools_capability_absent');
     }else{
      const result=await exchange('initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'AgentToolbox-WireCheck',version:'0.1.0'}},1);
      const init=InitializeResultSchema.safeParse(result);if(!init.success)fail('invalid_initialize_shape');
      row.discovery_valid=true;
      if(!MCP_WIRE_VERSIONS.includes(init.data.protocolVersion))fail('unsupported_negotiated_version');
      row.effective_version=init.data.protocolVersion;
      if(row.effective_version!==version)fail('requested_version_not_negotiated');
      await exchange('notifications/initialized');
      if(!init.data.capabilities.tools){phase='initialize';fail('tools_capability_absent');}
     }
     const names=new Set(),cursors=new Set();let cursor;
     row.pagination='limited';row.tool_count=0;
     for(let page=0;page<MCP_WIRE_LIMITS.max_tool_pages;page++){
      const result=await exchange('tools/list',cursor===undefined?{}:{cursor},page+2);
      const listing=(modern?modernTools:ListToolsResultSchema).safeParse(result);if(!listing.success)fail('invalid_tools_shape');
      if(names.size+listing.data.tools.length>MCP_WIRE_LIMITS.max_tools)fail('tool_limit');
      row.transcript.at(-1).tool_count=listing.data.tools.length;
      for(const tool of listing.data.tools){if(names.has(tool.name))fail('duplicate_tool_name');names.add(tool.name);if(modern)inspectHeaderAnnotations(tool.inputSchema);}
      row.tool_count=names.size;
      if(listing.data.nextCursor===undefined){row.pagination='complete';break;}
      cursor=listing.data.nextCursor;
      if(cursor.length>512)fail('cursor_limit');
      if(cursors.has(cursor))fail('cursor_loop');cursors.add(cursor);
      if(page===MCP_WIRE_LIMITS.max_tool_pages-1)fail('page_limit');
     }
     row.status='compatible';row.reason='checked_scope_passed';row.failure_location=null;
    }catch(error){
     row.reason=error instanceof CheckFailure&&reasons.includes(error.code)?error.code:'network_error';
     row.status=decisive.has(row.reason)?'incompatible':['version_not_supported','method_not_supported','requested_version_not_negotiated','unsupported_negotiated_version'].includes(row.reason)?'unsupported':row.reason==='authentication_required'?'auth_required':['access_blocked','redirect_not_followed'].includes(row.reason)?'blocked':'unknown';row.failure_location=phase;
    }
    versions.push(row);
   }
   const output={endpoint:input.endpoint,checked_at:now().toISOString(),source_content:'untrusted_data',scope:'Version-specific discovery and bounded tools/list wire-shape checks; not protocol or security certification',versions,request_count:state.requests,response_bytes:state.bytes,complete:versions.every(row=>row.status!=='unknown'),preview_supported:false};
   if(new TextEncoder().encode(JSON.stringify(output)).byteLength>MCP_WIRE_LIMITS.max_output_bytes)fail('wirecheck_output_limit');
   return output;
  },
 };
}
