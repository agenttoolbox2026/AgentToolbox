// Public, static fixtures authored by AgentToolbox. Importing or reading a
// manifest never invokes a handler, fetches a URL or touches a payment ledger.
const FIXED_TIME='2026-10-07T00:00:00.000Z';
const DOC_URL='https://docs.python.org/3/agenttoolbox-fixture.txt';
const ENDPOINT='https://agi.agenttoolbox2026.workers.dev/mcp';
const OLD='2025-11-25',MODERN='2026-07-28';
const AUTHORITY='I own this endpoint or am authorized to request its anonymous read-only MCP discovery.';
const DOC_TEXT='# Fixture guide\n\nRetries wait before the next request.\n';
const QUOTE_TEXT='Alpha\n beta. Exact phrase. again again. 😀 end.';
const draft='https://json-schema.org/draft/2020-12/schema';
const check=(pointer,value)=>({pointer,value});
const expectation=(outcome_qualifies,checks=[])=>({input_valid:true,outcome_qualifies,checks});
const rejected={input_valid:false,outcome_qualifies:false,checks:[]};
const response=(body,contentType='text/plain',status=200)=>({status,headers:{'Content-Type':contentType},body});
const documentFixture=(body,type='text/plain',robots='User-agent: *\nAllow: /')=>({kind:'http_responses',responses:[
 {url:'https://docs.python.org/robots.txt',...response(robots)},
 {url:DOC_URL,...response(body,type)},
]});
const rpc=(method,version,id,result)=>({method,protocol_version:version,request_id:id,response:id===null?{status:202,headers:{},body:null}:response(JSON.stringify({jsonrpc:'2.0',id,result}),'application/json')});
const initialize=(capabilities={tools:{}})=>rpc('initialize',OLD,1,{protocolVersion:OLD,capabilities,serverInfo:{name:'AgentToolbox offline fixture',version:'0'}});
const discover=(capabilities={tools:{}})=>rpc('server/discover',MODERN,1,{resultType:'complete',supportedVersions:[MODERN],capabilities});
const list=version=>rpc('tools/list',version,2,{...(version===MODERN?{resultType:'complete'}:{}),tools:[{name:'fixture_lookup',inputSchema:{type:'object',properties:{query:{type:'string'}}}}]});
const wireInput=versions=>({endpoint:ENDPOINT,protocol_versions:versions,authority:AUTHORITY});
const quoteInput=quotes=>({urls:[DOC_URL],quotes:quotes.map(quote=>({source_index:0,quote}))});
const boundedInteger={schema:{$schema:draft,type:'integer',minimum:1,maximum:3},valid_example:2,max_cases:12};
const contractCase=(id,value,keyword,valid,checked_assertions=3)=>({id,kind:valid?'positive_boundary':'negative_mutation',instance_pointer:'',schema_pointer:'/'+keyword,keyword,value,expected_verdict:valid?'valid':'invalid',validation:{valid,checked_assertions,errors:valid?[]:[{instance_pointer:'',schema_pointer:'/'+keyword,keyword}]}});
const quoteEvidence=(start_char,end_char)=>({start_char,end_char,anchor_fragment:null,context:{text:QUOTE_TEXT,start_char:0,end_char:47}});
const quoteResult=(quote_index,status,occurrences,spans)=>({quote_index,source_index:0,status,reason:status==='absent'?'complete_text':status==='ambiguous'?'repeated_occurrence':'single_occurrence',occurrences,evidence:spans.map(([start,end])=>quoteEvidence(start,end))});

const examples={
 'docs-pack':{
  purpose:'Inspect exact query-matched excerpts and their hashes/offsets before deciding whether the bounded pack is useful.',
  independent_check:'SHA-256 the fixture bytes; trim its final newline for normalized text, then slice each excerpt at its UTF-16 offsets and check the literal query match.',
  live_example_path:'/v1/products/docs-pack/example',
  real_input_preview:{supported:true,path:'/v1/products/docs-pack/prepare',scope:'Optional limited private preview; full output withheld. Separate capability, budget, quote and payment flow applies.'},
  cases:[
   {id:'matched_excerpt',description:'A short Markdown source contains the query. This is invented fixture prose, not Python documentation.',input:{urls:[DOC_URL],query:'retries',max_excerpt_chars:1000},fixture:documentFixture(DOC_TEXT,'text/markdown'),expected:expectation(true,[
    check('/fetched_at',FIXED_TIME),check('/excerpt_chars',54),check('/sources/0/source_bytes',55),check('/sources/0/source_sha256','525016463d3005964dc57581da43669f8c8934d62e95b12870ce0a829569f0b3'),check('/sources/0/text_sha256','8fc0078e21ab3599d0f3020dbf212132a26f5a3e43a2615ef8e8c6aae1aaed6a'),
    check('/sources/0/excerpts',[{text:DOC_TEXT.trim(),start_char:0,end_char:54,heading:'Fixture guide',anchor:null,matched_terms:['retries']}]),
   ])},
   {id:'no_match',description:'Valid input with no literal source match fails the whole pack before settlement.',input:{urls:[DOC_URL],query:'cancellation',max_excerpt_chars:1000},fixture:documentFixture(DOC_TEXT,'text/markdown'),expected:{...expectation(false),failure_reason:'no_matching_excerpt'}},
   {id:'unsupported_host',description:'Arbitrary hosts are rejected by the input contract without a fetch.',input:{urls:['https://example.invalid/guide'],query:'retries',max_excerpt_chars:1000},fixture:{kind:'none'},expected:rejected},
  ],
 },
 'quote-proof':{
  purpose:'Distinguish exact, whitespace-normalized, missing, repeated and unknown quotations with independently checkable positions.',
  independent_check:'Use ordinary case-sensitive substring search after collapsing whitespace; slice the original UTF-16 string at each evidence offset and compute its SHA-256. A textual match does not prove a claim true.',
  real_input_preview:{supported:false,path:null,scope:'A real-input verdict is the paid output. These offline fixtures are not a source-fetch dry run.'},
  cases:[
   {id:'quotation_boundaries',description:'Five fixed quotes show exact text, whitespace folding, absence, ambiguity and UTF-16 emoji offsets.',input:quoteInput(['Exact phrase','Alpha beta','missing','again','😀 end']),fixture:documentFixture(QUOTE_TEXT),expected:expectation(true,[
    check('/scope','textual_quotation_not_truth'),check('/summary',{decisive:5,unknown:0}),check('/sources/0/content_sha256','73ffdf97403c6fc406b2dbd9f52ab0e2767299c1056db09c86b0279ce6185c39'),check('/sources/0/extraction','complete_plain_text'),
    check('/results',[
     quoteResult(0,'exact_match','1',[[13,25]]),quoteResult(1,'whitespace_normalized_match','1',[[0,11]]),quoteResult(2,'absent','0',[]),quoteResult(3,'ambiguous','2_or_more',[[27,32],[33,38]]),quoteResult(4,'exact_match','1',[[40,46]]),
    ]),
   ])},
   {id:'robots_denied',description:'An inaccessible source yields unknown, not absence. An all-unknown result does not qualify for payment.',input:quoteInput(['Exact phrase']),fixture:documentFixture(QUOTE_TEXT,'text/plain','User-agent: *\nDisallow: /'),expected:expectation(false,[check('/summary',{decisive:0,unknown:1}),check('/results',[{quote_index:0,source_index:0,status:'unknown',reason:'source_disallows_access',occurrences:'unknown',evidence:[]}])])},
   {id:'invalid_source_index',description:'A quotation must refer to one of the supplied URLs.',input:{urls:[DOC_URL],quotes:[{source_index:1,quote:'Exact phrase'}]},fixture:{kind:'none'},expected:rejected},
  ],
 },
 'contract-cases':{
  purpose:'Obtain checked boundary witnesses and isolated negative cases for a supported schema, without claiming exhaustive test coverage.',
  independent_check:'Validate every returned value against the supplied schema with a separate JSON Schema 2020-12 validator such as Ajv. An isolated negative must have exactly its named keyword failure at its named instance.',
  real_input_preview:{supported:true,path:'/v1/products/contract-cases/prepare',scope:'Optional limited private preview where enough cases exist; full case set withheld. Separate capability, budget, quote and payment flow applies.'},
  cases:[
   {id:'integer_boundaries',description:'An integer allowance from 1 through 3 yields both endpoints and isolated below/above/type failures.',input:boundedInteger,fixture:{kind:'none'},expected:expectation(true,[
    check('/schema_sha256','adb45e34363271e35a1ce39ba9d8f514e154eeeebe7eacfff613764bdccdce7c'),
    check('/cases',[contractCase('case-1',1,'minimum',true),contractCase('case-2',0,'minimum',false),contractCase('case-3',3,'maximum',true),contractCase('case-4',4,'maximum',false),contractCase('case-5',null,'type',false,1)]),
    check('/summary/positive_cases',2),check('/summary/negative_cases',3),check('/coverage_gaps',[]),
   ])},
   {id:'unsupported_keyword',description:'The format keyword is unsupported; it is rejected rather than silently ignored.',input:{schema:{$schema:draft,type:'string',format:'email'},valid_example:'fixture@example.invalid',max_cases:12},fixture:{kind:'none'},expected:rejected},
   {id:'invalid_seed',description:'The starting example must already satisfy the complete accepted schema.',input:{...boundedInteger,valid_example:0},fixture:{kind:'none'},expected:rejected},
  ],
 },
 'mcp-wirecheck':{
  purpose:'Inspect a bounded discovery/tools-list compatibility matrix; no tool is invoked and no conformance or security certification is implied.',
  independent_check:'Read the supplied JSON-RPC response shapes and method sequence; compare with an MCP client or Inspector against a local mock. Never send fixture replay commands to a live target as part of this offline check.',
  real_input_preview:{supported:false,path:null,scope:'A real endpoint verdict is the paid output. These fixtures send no target probes and are not a live endpoint dry run.'},
  cases:[
   {id:'both_protocol_flows',description:'The fixed old handshake and modern discovery both expose one tool. All replies here are synthetic, including those labeled with our public URL.',input:wireInput([OLD,MODERN]),fixture:{kind:'rpc_sequence',requests:[initialize(),rpc('notifications/initialized',OLD,null),list(OLD),discover(),list(MODERN)]},expected:expectation(true,[
    check('/checked_at',FIXED_TIME),check('/request_count',5),check('/complete',true),check('/preview_supported',false),
    check('/versions/0/status','compatible'),check('/versions/0/reason','checked_scope_passed'),check('/versions/0/tool_count',1),check('/versions/0/pagination','complete'),
    check('/versions/1/status','compatible'),check('/versions/1/reason','checked_scope_passed'),check('/versions/1/tool_count',1),check('/versions/1/pagination','complete'),
   ])},
   {id:'no_tools_capability',description:'Valid modern discovery explicitly lacks tools support. A decisive incompatibility finding is a qualifying outcome.',input:wireInput([MODERN]),fixture:{kind:'rpc_sequence',requests:[discover({})]},expected:expectation(true,[check('/request_count',1),check('/versions/0/discovery_valid',true),check('/versions/0/status','incompatible'),check('/versions/0/reason','tools_capability_absent'),check('/versions/0/failure_location','server/discover')])},
   {id:'authentication_required',description:'A 401 yields no validated discovery and does not qualify for payment.',input:wireInput([MODERN]),fixture:{kind:'rpc_sequence',requests:[{method:'server/discover',protocol_version:MODERN,request_id:1,response:response('Fixture requires authentication.','text/plain',401)}]},expected:expectation(false,[check('/request_count',1),check('/versions/0/discovery_valid',false),check('/versions/0/status','auth_required'),check('/versions/0/reason','authentication_required')])},
   {id:'unsupported_endpoint',description:'Custom domains are outside this product scope and fail input validation without any request.',input:{...wireInput([MODERN]),endpoint:'https://example.invalid/mcp'},fixture:{kind:'none'},expected:rejected},
  ],
 },
};

const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const manifests=Object.fromEntries(Object.entries(examples).map(([product_id,example])=>[product_id,{
 api_version:'1',fixture_version:'1',product_id,version:'0.1.0',publisher:'AgentToolbox',provenance:'first_party_synthetic_fixture',
 example_kind:'offline_contract_examples',execution:'none',payment:{status:'not_required',amount_settled_atomic:'0'},fixed_clock:FIXED_TIME,
 interpretation:'Static authored examples, not live remote observations, payment verification, customer outcomes or proof of usefulness. Fixture URLs identify mocked responses; do not invoke the live service with these fixture inputs.',
 expected_format:'input_valid means the complete handler input validation passed, including runtime restrictions such as supported hosts, schema keywords and a valid seed. It is not just validation against the published JSON Schema, which cannot express every runtime restriction. outcome_qualifies tests the handler success predicate, not a payment. checks compare exact values at RFC 6901 JSON Pointers into the output; unlisted fields are not asserted. failure_reason names the handler failure code when no output is returned.',
 contract_path:'/v1/products/'+product_id,criteria_path:'/v1/products/'+product_id+'/criteria',...example,
}]));
freeze(manifests);
export const FREE_EXAMPLE_PRODUCT_IDS=Object.freeze(Object.keys(manifests));
export function freeExampleManifest(productId){return Object.hasOwn(manifests,productId)?manifests[productId]:null;}
