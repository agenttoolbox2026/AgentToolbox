import {z} from 'zod';
import {DOC_HOSTS,publicDocUrl,robotsPermit,USER_AGENT} from './docs-pack.js';
import {hash} from './telemetry.js';
import {passesCriteria} from './criteria.js';

export const QUOTE_PROOF_HOSTS=DOC_HOSTS;
export const QUOTE_PROOF_LIMITS=Object.freeze({urls:5,quotes:10,source_bytes:100000,robots_bytes:16384,redirects:2,deadline_ms:12000,context_words_per_source:200,output_bytes:14000});
export const QUOTE_PROOF_NORMALIZATION='Case-sensitive; collapse Unicode whitespace runs to one ASCII space and trim; no case, punctuation, Unicode composition, or semantic folding. Offsets are UTF-16 code units in the extracted text before whitespace normalization.';
const fail=code=>{throw new Error(code);};
const safeUrl=value=>{const url=publicDocUrl(value);return url&&url.length<=512?url:null;};
const normalize=value=>value.replace(/\s+/gu,' ').trim();
const countWords=value=>value.match(/\S+/gu)?.length??0;
const reasons=['complete_text','single_occurrence','repeated_occurrence','html_absence_unverifiable','source_too_large','empty_source','robots_unavailable','source_disallows_access','source_disallows_excerpts','unsupported_redirect','redirect_limit','source_unavailable','unsupported_content_type','unsupported_encoding','extraction_uncertain','html_runtime_unavailable','deadline_exceeded'];
export const quoteProofInput=z.strictObject({
 urls:z.array(z.string().max(512).refine(v=>!!safeUrl(v),'Use a supported public HTTPS documentation URL without credentials, port or query.')).min(1).max(5),
 quotes:z.array(z.strictObject({source_index:z.number().int().min(0).max(4),quote:z.string().min(1).max(512).refine(v=>normalize(v).length>0,'Quote must include non-whitespace text.')})).min(1).max(10),
}).superRefine((value,ctx)=>{
 if(new Set(value.urls.map(safeUrl)).size!==value.urls.length)ctx.addIssue({code:'custom',message:'URLs must be distinct.'});
 for(const [i,quote] of value.quotes.entries())if(quote.source_index>=value.urls.length)ctx.addIssue({code:'custom',path:['quotes',i,'source_index'],message:'Quote source_index must identify a supplied URL.'});
 if(value.urls.some((_,i)=>!value.quotes.some(q=>q.source_index===i)))ctx.addIssue({code:'custom',message:'Each URL must have at least one quote.'});
});
const contextSchema=z.strictObject({text:z.string().max(180),start_char:z.number().int().nonnegative(),end_char:z.number().int().nonnegative()});
const evidenceSchema=z.strictObject({start_char:z.number().int().nonnegative(),end_char:z.number().int().positive(),anchor_fragment:z.string().max(361).nullable(),context:contextSchema.nullable()});
export const quoteProofOutput=z.strictObject({
 source_content:z.literal('untrusted_data'),scope:z.literal('textual_quotation_not_truth'),normalization:z.literal(QUOTE_PROOF_NORMALIZATION),
 sources:z.array(z.strictObject({source_index:z.number().int().min(0).max(4),url:z.string().max(512).url(),final_url:z.string().max(512).url(),fetched_at:z.string().datetime(),http_status:z.number().int().min(100).max(599).nullable(),content_type:z.string().max(80).nullable(),source_bytes:z.number().int().min(0).max(100000).nullable(),content_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),extraction_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),extraction:z.enum(['complete_plain_text','static_html','unavailable']),extracted_chars:z.number().int().min(0).max(200000).nullable(),reason:z.enum(reasons).nullable()})).min(1).max(5),
 results:z.array(z.strictObject({quote_index:z.number().int().min(0).max(9),source_index:z.number().int().min(0).max(4),status:z.enum(['exact_match','whitespace_normalized_match','absent','ambiguous','unknown']),reason:z.enum(reasons),occurrences:z.enum(['0','1','2_or_more','unknown']),evidence:z.array(evidenceSchema).max(2)})).min(1).max(10),
 summary:z.strictObject({decisive:z.number().int().min(0).max(10),unknown:z.number().int().min(0).max(10)}),
}).superRefine((output,ctx)=>{
 const issue=message=>ctx.addIssue({code:'custom',message});
 if(output.summary.decisive!==output.results.filter(r=>r.status!=='unknown').length||output.summary.unknown!==output.results.filter(r=>r.status==='unknown').length)issue('Summary must reflect the result counts.');
 for(const [i,source] of output.sources.entries())if(source.source_index!==i)issue('Source indices must preserve input order.');
 for(const [i,result] of output.results.entries()){
  const source=output.sources[result.source_index],matched=['exact_match','whitespace_normalized_match','ambiguous'].includes(result.status);
  if(result.quote_index!==i||!source)issue('Results must reference their input quote and source.');
  if(result.status==='absent'&&(source?.extraction!=='complete_plain_text'||result.occurrences!=='0'||result.evidence.length))issue('Absence requires complete plain text and no matching evidence.');
  if(result.status==='unknown'&&(result.occurrences!=='unknown'||result.evidence.length))issue('Unknown results cannot claim a known occurrence.');
  if(matched&&(source?.http_status!==200||!source.content_sha256||!source.extraction_sha256||source.extraction==='unavailable'||result.evidence.length!==(result.status==='ambiguous'?2:1)||result.occurrences!==(result.status==='ambiguous'?'2_or_more':'1')))issue('Matches require complete source evidence.');
  for(const evidence of result.evidence){
   if(evidence.end_char<=evidence.start_char||evidence.end_char>(source?.extracted_chars??0))issue('Evidence offsets must identify extracted text.');
   if(evidence.context&&(evidence.context.end_char-evidence.context.start_char!==evidence.context.text.length||evidence.context.end_char>(source?.extracted_chars??0)))issue('Context offsets must match its text.');
  }
 }
});

// Limited entity support is intentional. Unknown/invalid entities make the whole
// HTML extraction uncertain instead of manufacturing a positive or negative.
const entities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',hellip:'…',mdash:'—',ndash:'–',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',copy:'©',reg:'®',trade:'™',times:'×',divide:'÷',minus:'−',le:'≤',ge:'≥',bull:'•',middot:'·',laquo:'«',raquo:'»'});
function decodeEntities(value){
 return value.replace(/&(?:#[xX][0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);?/g,entity=>{
  if(!entity.endsWith(';'))fail('extraction_uncertain');
  const name=entity.slice(1,-1);if(!name.startsWith('#')){if(!Object.hasOwn(entities,name))fail('extraction_uncertain');return entities[name];}
  const cp=name[1]?.toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));
  if(!Number.isInteger(cp)||cp<=0||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff)||(cp>=0x80&&cp<=0x9f))fail('extraction_uncertain');
  return String.fromCodePoint(cp);
 });
}

export async function quoteProofHtmlText(html){
 if(typeof HTMLRewriter==='undefined')fail('html_runtime_unavailable');
 const pieces=[],anchors=[],ids=new Map();let length=0,excluded=0,bodyDepth=0,nodeText='',nodeIncluded=false;
 const blocked=new Set(['script','style','head','nav','header','footer','aside','form','svg','noscript','template','iframe','object','canvas']);
 const blocks=new Set(['address','article','blockquote','br','dd','div','dl','dt','h1','h2','h3','h4','h5','h6','hr','li','main','ol','p','pre','section','table','td','th','tr','ul']);
 const voidTags=new Set(['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr']);
 const append=value=>{pieces.push(value);length+=value.length;if(length>200000)fail('extraction_uncertain');};
 const parser=new HTMLRewriter().on('*',{element(el){
  const tag=el.tagName;
  if(tag==='meta'&&['robots','agenttoolboxdocs'].includes((el.getAttribute('name')??'').toLowerCase())&&/noindex|nosnippet|noai/i.test(el.getAttribute('content')??''))fail('source_disallows_excerpts');
  const hidden=el.hasAttribute('hidden')||el.getAttribute('aria-hidden')==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(el.getAttribute('style')??'');
  const ignored=blocked.has(tag)||hidden,voidTag=voidTags.has(tag);
  if(tag==='body')bodyDepth++;
  if(!excluded&&bodyDepth&&(blocks.has(tag)||ignored))append('\n');
  if(ignored&&!voidTag)excluded++;
  let anchor=null;const id=el.getAttribute('id');
  if(id){ids.set(id,(ids.get(id)??0)+1);if(id.length<=120&&!excluded&&bodyDepth&&!/[\u0000-\u001f\u007f]/.test(id))anchor={id,start:length,end:length};}
  if(!voidTag)el.onEndTag(()=>{if(anchor){anchor.end=length;anchors.push(anchor);}if(ignored)excluded--;if(!excluded&&bodyDepth&&(blocks.has(tag)||ignored))append('\n');if(tag==='body')bodyDepth--;});
 }}).onDocument({text(chunk){
  // Text node boundaries need not match streaming chunk boundaries.
  if(!nodeText)nodeIncluded=!excluded&&bodyDepth>0;
  nodeText+=chunk.text;
  if(chunk.lastInTextNode){if(nodeIncluded)append(decodeEntities(nodeText));nodeText='';}
 }});
 await parser.transform(new Response(html)).arrayBuffer();
 if(nodeText)fail('extraction_uncertain');
 return {text:pieces.join(''),anchors:anchors.filter(a=>ids.get(a.id)===1)};
}

function normalizedIndex(text){
 // Most prose has single spaces. Record only collapsed runs rather than
 // allocating two per-character arrays for every retrieved document.
 const runs=[];let delta=0;
 const normalized=text.replace(/\s+/gu,(space,at)=>{if(space.length>1){runs.push({at:at-delta,start:at,end:at+space.length,delta:delta+space.length-1});delta+=space.length-1;}return ' ';});
 return {text:normalized,position(index,end=false){
  let lo=0,hi=runs.length-1,previous=null;
  while(lo<=hi){const mid=(lo+hi)>>>1;if(runs[mid].at<=index){previous=runs[mid];lo=mid+1;}else hi=mid-1;}
  if(previous?.at===index)return end?previous.end:previous.start;
  return index+(previous?.delta??0)+(end?1:0);
 }};
}
function occurrences(text,quote){
 const matches=[];let at=0;
 while(matches.length<2){const found=text.indexOf(quote,at);if(found<0)break;matches.push(found);at=found+1;}
 return matches;
}
function aborted(signal,promise){
 if(signal.aborted)return Promise.reject(new Error('deadline_exceeded'));
 return new Promise((resolve,reject)=>{const stop=()=>{cleanup();reject(new Error('deadline_exceeded'));},cleanup=()=>signal.removeEventListener('abort',stop);signal.addEventListener('abort',stop,{once:true});Promise.resolve(promise).then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});
}
async function boundedRead(response,limit,signal){
 if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();fail('source_too_large');}
 if(!response.body)fail('empty_source');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await aborted(signal,reader.read());if(done)break;size+=value.length;if(size>limit)fail('source_too_large');chunks.push(value);}}
 catch(error){reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
function utf8(bytes){try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{fail('unsupported_encoding');}}
function boundedContext(text,start,end,wordBudget,byteBudget){
 if(wordBudget<=0||byteBudget<=0)return null;
 const begin=Math.max(0,start-40);let value=text.slice(begin,Math.min(text.length,Math.max(start+80,Math.min(end+40,begin+180))));
 while(value&&(countWords(value)>wordBudget||new TextEncoder().encode(value).length>byteBudget))value=value.slice(0,-1);
 return value?{text:value,start_char:begin,end_char:begin+value.length}:null;
}

export function createQuoteProof({fetchImpl=fetch,fetcher=fetchImpl,htmlExtractor=quoteProofHtmlText,now=()=>new Date(),deadlineMs=QUOTE_PROOF_LIMITS.deadline_ms}={}){
 return {input:quoteProofInput,output:quoteProofOutput,previewSupported:false,
  failureReason:error=>reasons.includes(error?.message)?error.message:error?.message==='output_too_large'?'output_too_large':'quote_proof_failed',
  success:output=>quoteProofOutput.safeParse(output).success&&passesCriteria('quote-proof',output),
  async run(rawInput){
   const input=quoteProofInput.parse(rawInput),control=new AbortController(),signal=control.signal,timer=setTimeout(()=>control.abort(),Math.max(1,Math.min(12000,deadlineMs))),policies=new Map();
   const request=(url,accept)=>{if(signal.aborted)fail('deadline_exceeded');return aborted(signal,fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',headers:{'User-Agent':USER_AGENT,'Accept':accept},signal}));};
   const policy=async url=>{
    const u=new URL(url);
    if(!policies.has(u.origin))policies.set(u.origin,(async()=>{
     const response=await request(u.origin+'/robots.txt','text/plain');
     if(response.status===404){await response.body?.cancel();return '';}
     if(response.status!==200){await response.body?.cancel();fail('robots_unavailable');}
     return utf8(await boundedRead(response,QUOTE_PROOF_LIMITS.robots_bytes,signal));
    })());
    if(!robotsPermit(await policies.get(u.origin),u.pathname))fail('source_disallows_access');
   };
   try{
    const loaded=await Promise.all(input.urls.map(async(raw,source_index)=>{
     const url=safeUrl(raw),metadata={source_index,url,final_url:url,fetched_at:now().toISOString(),http_status:null,content_type:null,source_bytes:null,content_sha256:null,extraction_sha256:null,extraction:'unavailable',extracted_chars:null,reason:null};
     try{
      let response;
      for(let hop=0;hop<=2;hop++){
       await policy(metadata.final_url);response=await request(metadata.final_url,'text/plain, text/markdown;q=0.9, text/html;q=0.8');metadata.http_status=response.status;
       if(![301,302,303,307,308].includes(response.status))break;
       const location=response.headers.get('location');await response.body?.cancel();if(hop===2||!location)fail('redirect_limit');
       let target;try{target=safeUrl(new URL(location,metadata.final_url).href);}catch{fail('unsupported_redirect');}if(!target)fail('unsupported_redirect');metadata.final_url=target;
      }
      if(response.status!==200){await response.body?.cancel();fail('source_unavailable');}
      if(/noindex|nosnippet|noai/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();fail('source_disallows_excerpts');}
      const header=response.headers.get('content-type')??'',type=header.split(';')[0].trim().toLowerCase(),charset=header.match(/charset\s*=\s*["']?([^;\s"']+)/i)?.[1]?.toLowerCase();
      metadata.content_type=type.slice(0,80);
      if(!['text/plain','text/markdown','text/x-markdown','text/html','application/xhtml+xml'].includes(type)){await response.body?.cancel();fail('unsupported_content_type');}
      if(charset&&!['utf-8','utf8','us-ascii'].includes(charset)){await response.body?.cancel();fail('unsupported_encoding');}
      const bytes=await boundedRead(response,QUOTE_PROOF_LIMITS.source_bytes,signal);metadata.source_bytes=bytes.length;metadata.content_sha256=await hash(bytes);metadata.fetched_at=now().toISOString();
      const source=utf8(bytes);if(!source.trim())fail('empty_source');
      // Common 200-status interstitials are not the requested document. Err on
      // the side of uncertainty; do not quote a challenge as source evidence.
      if(/<title[^>]*>\s*(?:just a moment|access denied|attention required|verify (?:you are|you're) human)/i.test(source)||/(?:id|class)\s*=\s*["'][^"']*cf-chl-/i.test(source)||/^\s*(?:access denied|permission denied|too many requests|please (?:enable javascript|sign in|log in)|verify (?:you are|you're) human)\b/i.test(source))fail('source_unavailable');
      const isHtml=type.includes('html');let extracted;
      if(isHtml)extracted=await aborted(signal,htmlExtractor(source));else extracted={text:source,anchors:[]};
      if(typeof extracted.text!=='string'||!extracted.text.trim()||extracted.text.length>200000||extracted.uncertain===true)fail('extraction_uncertain');
      metadata.extraction=isHtml?'static_html':'complete_plain_text';metadata.extracted_chars=extracted.text.length;metadata.extraction_sha256=await hash(extracted.text);
      return {metadata,text:extracted.text,anchors:extracted.anchors??[],index:normalizedIndex(extracted.text)};
     }catch(error){metadata.reason=signal.aborted?'deadline_exceeded':reasons.includes(error?.message)?error.message:'source_unavailable';return {metadata};}
    }));
    const words=new Array(input.urls.length).fill(200);let contextBytes=2000;
    const results=input.quotes.map(({source_index,quote},quote_index)=>{
     const source=loaded[source_index],result={quote_index,source_index,status:'unknown',reason:source.metadata.reason??'html_absence_unverifiable',occurrences:'unknown',evidence:[]};
     if(source.text===undefined)return result;
     const query=normalize(quote),matches=occurrences(source.index.text,query);
     if(!matches.length){if(source.metadata.extraction==='complete_plain_text')Object.assign(result,{status:'absent',reason:'complete_text',occurrences:'0'});return result;}
     const spans=matches.map(start=>({start:source.index.position(start),end:source.index.position(start+query.length-1,true)}));
     Object.assign(result,{status:matches.length>1?'ambiguous':source.text.slice(spans[0].start,spans[0].end)===quote?'exact_match':'whitespace_normalized_match',reason:matches.length>1?'repeated_occurrence':'single_occurrence',occurrences:matches.length>1?'2_or_more':'1'});
     result.evidence=spans.map(({start,end})=>{
      const context=boundedContext(source.text,start,end,words[source_index],contextBytes);
      if(context){words[source_index]-=countWords(context.text);contextBytes-=new TextEncoder().encode(context.text).length;}
      const anchor=source.anchors.filter(a=>typeof a.id==='string'&&a.id.length<=120&&Number.isInteger(a.start)&&Number.isInteger(a.end)&&a.start<=start&&a.end>=end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
      const fragment=anchor?'#'+encodeURIComponent(anchor.id):null;
      return {start_char:start,end_char:end,anchor_fragment:fragment?.length<=361?fragment:null,context};
     });return result;
    });
    const output={source_content:'untrusted_data',scope:'textual_quotation_not_truth',normalization:QUOTE_PROOF_NORMALIZATION,sources:loaded.map(s=>s.metadata),results,summary:{decisive:results.filter(r=>r.status!=='unknown').length,unknown:results.filter(r=>r.status==='unknown').length}};
    // Evidence offsets and hashes survive context removal if unusually long URLs
    // or escaped characters consume the envelope budget.
    for(const result of [...results].reverse())for(const evidence of [...result.evidence].reverse())if(new TextEncoder().encode(JSON.stringify(output)).length>14000)evidence.context=null;
    if(new TextEncoder().encode(JSON.stringify(output)).length>14000)fail('output_too_large');
    return quoteProofOutput.parse(output);
   }finally{clearTimeout(timer);control.abort();}
  },
 };
}
