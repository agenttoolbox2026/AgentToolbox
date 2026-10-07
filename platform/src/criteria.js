// Published predicates and runtime charge checks share these exact expressions.
const path=value=>({path:value}),count=value=>({count:path(value)}),eq=(a,b)=>({eq:[a,b]}),and=(...rules)=>({and:rules}),every=(source,as,test)=>({every:{source:path(source),as,test}});
export const WIRE_DECISIVE_REASONS=Object.freeze(['checked_scope_passed','tools_capability_absent','invalid_initialize_shape','invalid_discovery_shape','invalid_tools_shape','invalid_header_annotation','duplicate_tool_name','invalid_jsonrpc','response_id_mismatch','invalid_notification_ack','invalid_session_header','unexpected_session_change','unexpected_modern_session','unsupported_content_type','invalid_json']);
const negative=and(eq(path('case.expected_verdict'),'invalid'),eq(path('case.validation.valid'),false),eq(count('case.validation.errors'),1),eq(path('case.validation.errors.0.schema_pointer'),path('case.schema_pointer')),eq(path('case.validation.errors.0.keyword'),path('case.keyword')),eq(path('case.validation.errors.0.instance_pointer'),path('case.instance_pointer')));
const RULES={
 'docs-pack':[
  {id:'sources_present',test:{gt:[count('sources'),0]}},
  {id:'all_sources_matched_with_exact_offsets',test:every('sources','source',and(eq(path('source.status'),200),every('source.excerpts','excerpt',and({gt:[count('excerpt.matched_terms'),0]},eq({subtract:[path('excerpt.end_char'),path('excerpt.start_char')]},count('excerpt.text'))))))},
  {id:'requested_excerpt_budget',test:{lte:[path('excerpt_chars'),path('max_excerpt_chars')]}}
 ],
 'quote-proof':[
  {id:'decisive_result_required',test:{gt:[path('summary.decisive'),0]}},
  {id:'decisive_count_matches_results',test:eq(path('summary.decisive'),{count_where:{source:path('results'),as:'result',test:{not:eq(path('result.status'),'unknown')}}})}
 ],
 'contract-cases':[
  {id:'positive_count_matches_cases',test:eq(path('summary.positive_cases'),{count_where:{source:path('cases'),as:'case',test:eq(path('case.kind'),'positive_boundary')}})},
  {id:'negative_count_matches_cases',test:eq(path('summary.negative_cases'),{count_where:{source:path('cases'),as:'case',test:eq(path('case.kind'),'negative_mutation')}})},
  {id:'coverage_gaps_counted',test:eq(path('summary.coverage_gaps'),{add:[count('coverage_gaps'),path('coverage_gaps_omitted')]})},
  {id:'every_case_revalidated_at_intended_location',test:every('cases','case',{if:[eq(path('case.kind'),'positive_boundary'),and(eq(path('case.expected_verdict'),'valid'),eq(path('case.validation.valid'),true),eq(count('case.validation.errors'),0)),negative]})},
  {id:'product_output_byte_bound',test:{lte:[{json_bytes:path('$')},14000]}}
 ],
 'mcp-wirecheck':[
  {id:'decisive_discovery_valid_wire_verdict',test:{some:{source:path('versions'),as:'wire',test:and(eq(path('wire.discovery_valid'),true),{in:[path('wire.status'),['compatible','incompatible']]},{in:[path('wire.reason'),WIRE_DECISIVE_REASONS]})}}}
 ]
};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
freeze(RULES);
export const criteriaFor=id=>RULES[id]?{criteria_version:'1',rule_language:'agenttoolbox-predicate-v1',evaluation:'Output must pass the published output_schema, then every predicate below. These expressions are also evaluated by the server handler.',rules:RULES[id],failure:{before_settlement:['invalid_input','output_schema_invalid','predicate_false','execution_error','output_bound_exceeded','durable_result_write_failed'],settlement:'One attempt only after durable validated output; unknown or unconfirmed settlement withholds output and requires reconciliation.'},scope:'Deterministic bounded checks, not usefulness, truth, certification or independent live-payment proof.'}:null;
function evaluate(expr,output,vars={}){
 if(expr===null||typeof expr!=='object'||Array.isArray(expr))return expr;
 const [op,value]=Object.entries(expr)[0];
 const run=v=>evaluate(v,output,vars),pair=()=>value.map(run);
 if(op==='path'){if(value==='$')return output;const parts=value.split('.');return parts.reduce((v,k)=>v?.[k],Object.hasOwn(vars,parts[0])?{...output,...vars}:output);}
 if(op==='count')return run(value)?.length;
 if(op==='json_bytes')return new TextEncoder().encode(JSON.stringify(run(value))).length;
 if(op==='and')return value.every(run);
 if(op==='not')return !run(value);
 if(op==='if')return run(value[0])?run(value[1]):run(value[2]);
 if(['every','some','count_where'].includes(op)){const rows=run(value.source);if(!Array.isArray(rows))return false;const test=row=>evaluate(value.test,output,{...vars,[value.as]:row});return op==='every'?rows.every(test):op==='some'?rows.some(test):rows.filter(test).length;}
 const [a,b]=pair();
 if(op==='eq')return a===b;
 if(op==='gt')return a>b;
 if(op==='lte')return a<=b;
 if(op==='subtract')return a-b;
 if(op==='add')return a+b;
 if(op==='in')return b.includes(a);
 throw new Error('Unknown criterion operator');
}
export const passesCriteria=(id,output)=>RULES[id].every(rule=>evaluate(rule.test,output));
