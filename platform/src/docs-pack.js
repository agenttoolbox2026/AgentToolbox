import {z} from 'zod';
import {hash} from './telemetry.js';

export const DOC_HOSTS=Object.freeze(['developers.cloudflare.com','docs.payai.network','docs.x402.org','docs.python.org','nodejs.org','developer.mozilla.org','docs.github.com','www.typescriptlang.org']);
export const MAX_SOURCE_BYTES=262144;
export const USER_AGENT='AgentToolboxDocs/1.0 (+https://agnttoolbx.agenttoolbox2026.workers.dev/humans)';
const fail=code=>{throw new Error(code);};
export function publicDocUrl(value){
 let u;try{u=new URL(value);}catch{return null;}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.search||!DOC_HOSTS.includes(u.hostname)||/[\\\u0000-\u0020]/.test(value)||/%(?:2f|5c|00)/i.test(u.pathname))return null;
 u.hash='';return u.href;
}
export const docsPackInput=z.strictObject({
 urls:z.array(z.string().max(512).refine(v=>!!publicDocUrl(v),'Use a supported public HTTPS documentation URL without credentials, port or query.')).min(1).max(5),
 query:z.string().trim().min(2).max(120).refine(v=>terms(v).length>0,'Include a word with at least two characters.'),
 max_excerpt_chars:z.number().int().min(1000).max(6000).default(4000),
}).refine(v=>new Set(v.urls.map(publicDocUrl)).size===v.urls.length,'URLs must be distinct.');
const excerptSchema=z.strictObject({text:z.string().min(1).max(1800),start_char:z.number().int().min(0),end_char:z.number().int().min(1),heading:z.string().max(180).nullable(),anchor:z.string().max(512).nullable(),matched_terms:z.array(z.string()).min(1).max(8)});
export const docsPackOutput=z.strictObject({
 query:z.string(),fetched_at:z.string(),source_content:z.literal('untrusted_data'),
 sources:z.array(z.strictObject({url:z.string().url(),final_url:z.string().url(),status:z.literal(200),selection_status:z.literal('matched'),content_type:z.string(),source_bytes:z.number().int().positive().max(MAX_SOURCE_BYTES),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),text_sha256:z.string().regex(/^[a-f0-9]{64}$/),title:z.string().max(180),text_chars:z.number().int().positive(),code_blocks_omitted:z.number().int().min(0),excerpts:z.array(excerptSchema).min(1).max(2)})).min(1).max(5),
 excerpt_chars:z.number().int().min(1).max(6000),max_excerpt_chars:z.number().int(),
 match_method:z.literal('case-insensitive literal terms; ranked by distinct term coverage'),
});
export function terms(query){return [...new Set((query.toLowerCase().match(/[\p{L}\p{N}_-]{2,40}/gu)??[]))].slice(0,8);}
const normalizePath=v=>v.replace(/%[a-f0-9]{2}/gi,c=>/[A-Za-z0-9_.~-]/.test(String.fromCharCode(parseInt(c.slice(1),16)))?String.fromCharCode(parseInt(c.slice(1),16)):c.toUpperCase());
function pathMatch(pattern,path){
 const exact=pattern.endsWith('$');if(exact)pattern=pattern.slice(0,-1);
 const parts=normalizePath(pattern).split('*');path=normalizePath(path);
 if(!path.startsWith(parts[0]))return false;
 let at=parts[0].length;
 for(let i=1;i<parts.length;i++){const pos=exact&&i===parts.length-1?path.length-parts[i].length:path.indexOf(parts[i],at);if(pos<at||!path.startsWith(parts[i],pos))return false;at=pos+parts[i].length;}
 return !exact||at===path.length||(parts.at(-1)===''&&pattern.endsWith('*'));
}
export function robotsPermit(text,path){
 const groups=[];let group=null,started=false;
 for(const line of text.split(/\r?\n/)){
  const match=line.replace(/#.*/,'').trim().match(/^([^:]+):\s*(.*)$/);if(!match)continue;
  const key=match[1].trim().toLowerCase(),value=match[2].trim();
  if(key==='user-agent'){
   if(!group||started){group={agents:[],rules:[],signals:[],delay:0};groups.push(group);started=false;}
   group.agents.push(value.toLowerCase());
  }else if(group){started=true;if(['allow','disallow'].includes(key)&&value)group.rules.push({allow:key==='allow',pattern:value});
   if(key==='content-signal')group.signals.push(value.toLowerCase());
   if(key==='crawl-delay')group.delay=Number(value)||0;
  }
 }
 const agent='agenttoolboxdocs';let selected=[],specificity=-1;
 for(const g of groups){const score=Math.max(-1,...g.agents.map(a=>a==='*'?0:agent.includes(a)?a.length:-1));if(score>specificity){specificity=score;selected=[g];}else if(score===specificity&&score>=0)selected.push(g);}
 if(selected.some(g=>g.delay>0||g.signals.some(s=>/(?:^|,)\s*(?:ai-input|search)\s*=\s*no\b/.test(s))))return false;
 let best=-1,allowed=true;
 for(const g of selected)for(const rule of g.rules){if(pathMatch(rule.pattern,path)){const len=rule.pattern.replace(/[*$]/g,'').length;if(len>best){best=len;allowed=rule.allow;}else if(len===best&&rule.allow)allowed=true;}}
 return allowed;
}
export async function boundedBytes(response,limit){
 if(Number(response.headers.get('content-length')??0)>limit){await response.body?.cancel();fail('source_too_large');}
 if(!response.body)fail('empty_source');
 const reader=response.body.getReader(),chunks=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail('source_too_large');}chunks.push(value);}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}return bytes;
}
export async function htmlText(html){
 if(typeof HTMLRewriter==='undefined')fail('html_runtime_unavailable');
 let excluded=0,scoped=0,bodyDepth=0,title='',heading=null;const all=[],main=[],anchors=[];
 const blocked=new Set(['script','style','nav','footer','header','aside','form','svg','noscript','template']);
 const blocks=new Set(['p','div','section','article','main','h1','h2','h3','h4','h5','h6','pre','li','tr','blockquote']);
 const append=t=>{if(!excluded&&bodyDepth){all.push(t);if(scoped)main.push(t);}};
 const parser=new HTMLRewriter().on('*',{element(el){
  const tag=el.tagName,hidden=el.hasAttribute('hidden')||el.getAttribute('aria-hidden')==='true',ignore=blocked.has(tag)||hidden;
  if(tag==='meta'&&['robots','agenttoolboxdocs'].includes((el.getAttribute('name')??'').toLowerCase())&&/noindex|nosnippet|noai/i.test(el.getAttribute('content')??''))fail('source_disallows_excerpts');
  const voidTag=['area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'].includes(tag);
  if(ignore&&!voidTag)excluded++;
  if(tag==='body')bodyDepth++;
  if(tag==='main'||tag==='article')scoped++;
  if(tag==='br'||blocks.has(tag))append('\n');
  if(/^h[1-6]$/.test(tag)){append('#'.repeat(Number(tag[1]))+' ');if(!excluded)heading={text:'',id:el.getAttribute('id')};}
  if(tag==='pre')append('```\n');
  if(!voidTag)el.onEndTag(()=>{if(/^h[1-6]$/.test(tag)&&heading){anchors.push(heading);heading=null;}if(tag==='pre')append('\n```');if(blocks.has(tag))append('\n');if(ignore)excluded--;if(tag==='main'||tag==='article')scoped--;if(tag==='body')bodyDepth--;});
 }}).on('title',{text(t){title+=t.text;}}).onDocument({text(t){append(t.text);if(heading&&!excluded)heading.text+=t.text;}});
 await parser.transform(new Response(html)).arrayBuffer();
 return {text:(main.join('').trim()?main:all).join(''),title:title.trim().slice(0,180),anchors};
}
// Preserve source code indentation and line breaks. Offsets refer to this text.
export function normalizeText(text){
 const normalized=text.replace(/\r\n?/g,'\n').trim();
 // Published Markdown metadata and index/navigation precede the first H1 on
 // these documentation hosts. Keep the document body; offsets/hash describe it.
 if(normalized.startsWith('---\n')){
  const end=normalized.indexOf('\n---',4),heading=normalized.indexOf('\n# ',end+4);
  if(end>=0&&heading>=0&&heading<4096)return normalized.slice(heading+1).trim();
 }
 return normalized;
}
export function codeBlocks(text){
 const blocks=[];let opened=null,at=0;
 for(const line of text.split('\n')){const fence=line.match(/^ {0,3}(`{3,}|~{3,})/);if(fence){
  if(!opened)opened={start:at,marker:fence[1][0],length:fence[1].length};
  else if(fence[1][0]===opened.marker&&fence[1].length>=opened.length&&line.slice(fence[0].length).trim()===''){blocks.push({start:opened.start,end:Math.min(text.length,at+line.length+1),closed:true});opened=null;}
 }at+=line.length+1;}
 if(opened)blocks.push({start:opened.start,end:text.length,closed:false});return blocks;
}
export function extractExcerpts(text,query,budget){
 const wanted=terms(query),lower=text.toLowerCase(),candidates=[],blocks=codeBlocks(text),window=Math.min(900,budget);
 const headings=[...text.matchAll(/^#{1,6}\s+(.+)$/gm)].filter(h=>!blocks.some(b=>h.index>=b.start&&h.index<b.end));
 // At most 64 occurrences per term: bounded scanning, no caller-supplied regex.
 for(const term of wanted){let at=0;for(let i=0;i<64;i++){const found=lower.indexOf(term,at);if(found<0)break;at=found+term.length;
  const oversized=blocks.find(b=>b.start<=found&&found<b.end&&(!b.closed||b.end-b.start>window));
  if(oversized){at=oversized.end;continue;}
  let start=Math.max(0,found-180),end=Math.min(text.length,start+window);
  if(found+term.length>end)end=found+term.length;
  start=Math.max(0,end-window);
  for(const b of blocks){if(start<b.end&&end>b.start){
   if(!b.closed||b.end-b.start>window){if(found>=b.end)start=b.end;else end=b.start;}
   else {start=Math.min(start,b.start);end=Math.max(end,b.end);}
  }}
  if(end-start>Math.min(1800,budget)||end<=start)continue;
  const content=text.slice(start,end),matched=wanted.filter(t=>content.toLowerCase().includes(t));
  candidates.push({start,end,found,matched,score:matched.length});
 }}
 candidates.sort((a,b)=>b.score-a.score||a.start-b.start);const picked=[];let remaining=budget;
 for(const c of candidates){if(picked.length===2||remaining<100)break;if(picked.some(p=>c.start<p.end_char&&c.end>p.start_char))continue;
  if(c.end-c.start>remaining)continue;
  const end=c.end,value=text.slice(c.start,end),matched=wanted.filter(t=>value.toLowerCase().includes(t));if(!matched.length)continue;
  picked.push({text:value,start_char:c.start,end_char:end,heading:headings.filter(h=>h.index<=c.found).at(-1)?.[1]?.slice(0,180)??null,anchor:null,matched_terms:matched});remaining-=value.length;
 }
 return picked.sort((a,b)=>a.start_char-b.start_char);
}
export function createDocsPack({fetcher=fetch,htmlExtractor=htmlText,now=()=>new Date()}={}){
 return {input:docsPackInput,output:docsPackOutput,
  failureReason:e=>['source_too_large','empty_source','robots_unavailable','source_disallows_access','unsupported_url','redirect_limit','unsupported_redirect','fetch_failed','source_disallows_excerpts','unsupported_content_type','no_matching_excerpt','output_too_large'].includes(e?.message)?e.message:'source_unavailable',
  async run(input){
   const control=new AbortController(),timer=setTimeout(()=>control.abort(),12000),policies=new Map();
   const request=async(url,accept)=>fetcher(url,{method:'GET',redirect:'manual',credentials:'omit',headers:{'User-Agent':USER_AGENT,'Accept':accept},signal:control.signal});
   const policy=async url=>{
    const u=new URL(url);if(!policies.has(u.origin))policies.set(u.origin,(async()=>{
     const response=await request(u.origin+'/robots.txt','text/plain');
     if(response.status===404){await response.body?.cancel();return '';}
     if(response.status!==200){await response.body?.cancel();fail('robots_unavailable');}
     return new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(response,32768));
    })());
    if(!robotsPermit(await policies.get(u.origin),u.pathname))fail('source_disallows_access');
   };
   try{
    const eachBudget=Math.floor(input.max_excerpt_chars/input.urls.length);
    const sources=await Promise.all(input.urls.map(async raw=>{
     const original=publicDocUrl(raw);if(!original)fail('unsupported_url');let url=original,response;
     for(let hop=0;hop<=2;hop++){
      await policy(url);response=await request(url,'text/markdown, text/plain;q=0.9, text/html;q=0.8');
      if(![301,302,303,307,308].includes(response.status))break;
      const location=response.headers.get('location');await response.body?.cancel();if(hop===2||!location)fail('redirect_limit');
      url=publicDocUrl(new URL(location,url).href);if(!url)fail('unsupported_redirect');
     }
     if(response.status!==200){await response.body?.cancel();fail('fetch_failed');}
     if(/noindex|nosnippet|noai/i.test(response.headers.get('x-robots-tag')??'')){await response.body?.cancel();fail('source_disallows_excerpts');}
     const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
     if(!['text/plain','text/markdown','text/x-markdown','text/html','application/xhtml+xml'].includes(type)){await response.body?.cancel();fail('unsupported_content_type');}
     const bytes=await boundedBytes(response,MAX_SOURCE_BYTES),source=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
     if(!source.trim())fail('empty_source');
     let extracted;
     if(type.includes('html')){
      if(/<meta\b[^>]*(?:name\s*=\s*["'](?:robots|agenttoolboxdocs)["'])[^>]*(?:noindex|nosnippet|noai)/i.test(source))fail('source_disallows_excerpts');
      extracted=await htmlExtractor(source);
     }else extracted={text:source,title:(source.match(/^#\s+(.+)$/m)?.[1]??'').slice(0,180)};
     const text=normalizeText(extracted.text),excerpts=extractExcerpts(text,input.query,eachBudget);if(!excerpts.length)fail('no_matching_excerpt');
     for(const excerpt of excerpts){const anchor=extracted.anchors?.find(a=>a.text.trim().slice(0,180)===excerpt.heading&&a.id&&a.id.length<=120);if(anchor)excerpt.anchor='#'+encodeURIComponent(anchor.id);}
     return {url:original,final_url:url,status:200,selection_status:'matched',content_type:type,source_bytes:bytes.length,source_sha256:await hash(bytes),text_sha256:await hash(text),title:extracted.title,text_chars:text.length,code_blocks_omitted:codeBlocks(text).filter(b=>!b.closed||b.end-b.start>Math.min(900,eachBudget)).length,excerpts};
    }));
    const output={query:input.query,fetched_at:now().toISOString(),source_content:'untrusted_data',sources,excerpt_chars:sources.flatMap(s=>s.excerpts).reduce((n,e)=>n+e.text.length,0),max_excerpt_chars:input.max_excerpt_chars,match_method:'case-insensitive literal terms; ranked by distinct term coverage'};
    if(new TextEncoder().encode(JSON.stringify(output)).length>14000)fail('output_too_large');return output;
   }finally{clearTimeout(timer);control.abort();}
  },
  success:output=>output.sources.length>0&&output.sources.every(s=>s.status===200&&s.excerpts.every(e=>e.matched_terms.length>0&&e.end_char-e.start_char===e.text.length))&&output.excerpt_chars<=output.max_excerpt_chars,
 };
}
