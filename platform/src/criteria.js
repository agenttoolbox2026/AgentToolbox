// Published predicates and runtime charge checks share these exact expressions.
const path=value=>({path:value}),count=value=>({count:path(value)}),eq=(a,b)=>({eq:[a,b]}),and=(...rules)=>({and:rules}),every=(source,as,test,index_as)=>({every:{source:path(source),as,...(index_as?{index_as}:{}),test}});
export const WIRE_DECISIVE_REASONS=Object.freeze(['checked_scope_passed','tools_capability_absent','invalid_initialize_shape','invalid_discovery_shape','invalid_tools_shape','invalid_header_annotation','duplicate_tool_name','invalid_jsonrpc','response_id_mismatch','invalid_notification_ack','invalid_session_header','unexpected_session_change','unexpected_modern_session','unsupported_content_type','invalid_json']);
const negative=and(eq(path('case.expected_verdict'),'invalid'),eq(path('case.validation.valid'),false),eq(count('case.validation.errors'),1),eq(path('case.validation.errors.0.schema_pointer'),path('case.schema_pointer')),eq(path('case.validation.errors.0.keyword'),path('case.keyword')),eq(path('case.validation.errors.0.instance_pointer'),path('case.instance_pointer')));
// Source ordinal validation makes this lookup equivalent to sources[result.source_index].
const quoteSources=test=>every('results','result',{some:{source:path('sources'),as:'source',test:and(eq(path('source.source_index'),path('result.source_index')),test)}});
const when=(condition,test)=>({if:[condition,test,true]});
const matchedQuote={in:[path('result.status'),['exact_match','whitespace_normalized_match','ambiguous']]};
const RULES={
 'docs-pack':[
  {id:'sources_present',test:{gt:[count('sources'),0]}},
  {id:'all_sources_matched_with_exact_offsets',test:every('sources','source',and(eq(path('source.status'),200),every('source.excerpts','excerpt',and({gt:[count('excerpt.matched_terms'),0]},eq({subtract:[path('excerpt.end_char'),path('excerpt.start_char')]},count('excerpt.text'))))))},
  {id:'requested_excerpt_budget',test:{lte:[path('excerpt_chars'),path('max_excerpt_chars')]}}
 ],
 'quote-proof':[
  {id:'decisive_result_required',test:{gt:[path('summary.decisive'),0]}},
  {id:'decisive_count_matches_results',test:eq(path('summary.decisive'),{count_where:{source:path('results'),as:'result',test:{not:eq(path('result.status'),'unknown')}}})},
  {id:'unknown_count_matches_results',test:eq(path('summary.unknown'),{count_where:{source:path('results'),as:'result',test:eq(path('result.status'),'unknown')}})},
  {id:'source_indices_preserve_input_order',test:every('sources','source',eq(path('source.source_index'),path('source_ordinal')),'source_ordinal')},
  {id:'quote_indices_preserve_input_order',test:every('results','result',eq(path('result.quote_index'),path('quote_ordinal')),'quote_ordinal')},
  {id:'results_reference_existing_sources',test:quoteSources(true)},
  {id:'absence_requires_complete_plain_text',test:quoteSources(when(eq(path('result.status'),'absent'),and(eq(path('source.extraction'),'complete_plain_text'),eq(path('result.occurrences'),'0'),eq(count('result.evidence'),0))))},
  {id:'unknown_results_have_no_matching_evidence',test:every('results','result',when(eq(path('result.status'),'unknown'),and(eq(path('result.occurrences'),'unknown'),eq(count('result.evidence'),0))))},
  {id:'matches_require_complete_source_evidence',test:quoteSources(when(matchedQuote,and(eq(path('source.http_status'),200),{not:eq(path('source.content_sha256'),null)},{not:eq(path('source.extraction_sha256'),null)},{not:eq(path('source.extraction'),'unavailable')},eq(count('result.evidence'),{if:[eq(path('result.status'),'ambiguous'),2,1]}),eq(path('result.occurrences'),{if:[eq(path('result.status'),'ambiguous'),'2_or_more','1']}))))},
  {id:'evidence_offsets_identify_extracted_text',test:quoteSources(every('result.evidence','evidence',and({gt:[path('evidence.end_char'),path('evidence.start_char')]},{lte:[path('evidence.end_char'),path('source.extracted_chars')]})))},
  {id:'context_offsets_match_text',test:quoteSources(every('result.evidence','evidence',when({not:eq(path('evidence.context'),null)},and(eq({subtract:[path('evidence.context.end_char'),path('evidence.context.start_char')]},count('evidence.context.text')),{lte:[path('evidence.context.end_char'),path('source.extracted_chars')]}))))}
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
const identifier=value=>typeof value==='string'&&/^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
function validateExpression(expr){
 if(expr===null||['boolean','string'].includes(typeof expr)||typeof expr==='number'&&Number.isFinite(expr))return;
 if(Array.isArray(expr)){for(const item of expr){if(item&&typeof item==='object'&&!Array.isArray(item))throw new Error('Malformed criterion literal');validateExpression(item);}return;}
 if(!expr||typeof expr!=='object'||![Object.prototype,null].includes(Object.getPrototypeOf(expr))||Reflect.ownKeys(expr).length!==1)throw new Error('Malformed criterion expression');
 const [op,value]=Object.entries(expr)[0]??[];
 if(op==='path'){if(typeof value!=='string'||!value||value.split('.').some(part=>!part))throw new Error('Malformed criterion path');return;}
 if(['count','json_bytes','not'].includes(op)){validateExpression(value);return;}
 if(['and','if','eq','gt','lte','subtract','add','in'].includes(op)){
  if(!Array.isArray(value)||(op==='if'?value.length!==3:op!=='and'&&value.length!==2))throw new Error('Malformed criterion operands');
  value.forEach(validateExpression);return;
 }
 if(['every','some','count_where'].includes(op)){
  const fields=op==='every'?['source','as','test','index_as']:['source','as','test'];
  if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value))||Reflect.ownKeys(value).some(key=>!fields.includes(key))||!['source','as','test'].every(key=>Object.hasOwn(value,key))||!identifier(value.as)||Object.hasOwn(value,'index_as')&&(!identifier(value.index_as)||value.index_as===value.as))throw new Error('Malformed criterion iterator');
  validateExpression(value.source);validateExpression(value.test);return;
 }
 throw new Error('Unknown criterion operator');
}
Object.values(RULES).forEach(rules=>rules.forEach(rule=>validateExpression(rule.test)));
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
 if(['every','some','count_where'].includes(op)){const rows=run(value.source);if(!Array.isArray(rows))return false;const test=(row,index)=>evaluate(value.test,output,{...vars,[value.as]:row,...(op==='every'&&Object.hasOwn(value,'index_as')?{[value.index_as]:index}:{})});return op==='every'?rows.every(test):op==='some'?rows.some(test):rows.filter(test).length;}
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
