import {z} from 'zod';
import {CREATOR_TERMS,proposalSchema} from './submissions.js';
const ref=name=>({$ref:'#/components/schemas/'+name});
const text={type:'string'},date={type:'string',format:'date-time'},uuid={type:'string',format:'uuid'};
const tool={type:'string',pattern:'^creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'};
const version={type:'string',pattern:'^(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})\\.(0|[1-9][0-9]{0,5})$'};
const integer={type:'integer',minimum:0},revision={type:'integer',enum:[0,1]};
const state={type:'string',enum:['pending','approved','rejected'],description:'pending: await owner review; rejected: read the decision; approved: initial submissions may use the approved-tool API, updates advance metadata only. Publication/execution requires separate adapter review.'};
const obj=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const noPayment={api_version:{type:'string',const:'1'},payment_effect:{type:'string',const:'none'},transfers_enabled:{type:'boolean',const:false}};
const status={...noPayment,tool_id:tool,state,revision,proposal:ref('CreatorProposal'),terms:ref('CreatorFrozenTerms'),decision:{anyOf:[ref('CreatorDecision'),{type:'null'}]},created_at:date};
export const CREATOR_RESPONSE_SCHEMAS={
 CreatorProposal:z.toJSONSchema(proposalSchema),
 CreatorFrozenTerms:obj(Object.fromEntries(Object.entries(CREATOR_TERMS).map(([key,value])=>[key,{type:typeof value==='number'?'integer':typeof value}]))),
 CreatorDecision:obj({decision:{type:'string',enum:['approved','rejected']},reason:text,created_at:date}),
 CreatorSubmission:obj({...status,submission_id:uuid,refund_due_atomic:{type:['string','null'],pattern:'^(0|[1-9][0-9]*)$'},publication:{type:'string',const:'not_published_by_submission'}}),
 CreatorUpdate:obj({...status,update_id:uuid,base_version:version,expected_head_revision:{...integer,maximum:2147483646},proposed_version:version,approval_effect:{type:'string',const:'metadata_only'}}),
 CreatorTool:obj({...noPayment,tool_id:tool,current_version:version,head_revision:integer,proposal:ref('CreatorProposal'),terms:ref('CreatorFrozenTerms'),entitlement:obj({share_bps:{type:'integer',const:9000},revenue_basis:{type:'string',const:'gross'}}),history:{type:'array',maxItems:20,items:obj({version,approved_revision:integer,proposal:ref('CreatorProposal'),approved_at:date})},next_cursor:{type:['string','null'],maxLength:256},approval_effect:{type:'string',const:'metadata_only'},installed_execution:{type:'string',const:'separately_reviewed; metadata approval never changes an adapter'}}),
};
