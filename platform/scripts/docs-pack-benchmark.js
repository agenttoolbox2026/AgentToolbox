import {writeFileSync,mkdirSync} from 'node:fs';
import {performance} from 'node:perf_hooks';
import {createDocsPack,docsPackInput,USER_AGENT} from '../src/docs-pack.js';
const input=docsPackInput.parse({urls:[
 'https://developers.cloudflare.com/workers/platform/limits/index.md',
 'https://developers.cloudflare.com/d1/platform/limits/index.md',
 'https://developers.cloudflare.com/workers/platform/pricing/index.md'
],query:'limits',max_excerpt_chars:3600});
// A competent local baseline: parallel fetch, then literal matches with adjacent lines.
let started=performance.now();
const raw=await Promise.all(input.urls.map(async url=>{
 const response=await fetch(url,{headers:{Accept:'text/markdown','User-Agent':USER_AGENT},signal:AbortSignal.timeout(12000)});
 if(response.status!==200)throw new Error('Baseline source unavailable');
 return {url,text:await response.text(),content_type:response.headers.get('content-type')};
}));
const baseline=raw.map(source=>{
 const lines=source.text.split('\n'),chosen=new Set();
 for(let i=0;i<lines.length;i++)if(/limits/i.test(lines[i]))for(let j=Math.max(0,i-2);j<=Math.min(lines.length-1,i+3);j++)chosen.add(j);
 return {url:source.url,excerpts:[...chosen].sort((a,b)=>a-b).map(i=>lines[i]).join('\n').slice(0,1200)};
});
const baselineMs=performance.now()-started;
let networkCalls=0;const handler=createDocsPack({fetcher:(...args)=>{networkCalls++;return fetch(...args);}});
started=performance.now();const output=await handler.run(input);const packMs=performance.now()-started;
if(!handler.output.safeParse(output).success||!handler.success(output))throw new Error('Product contract failed');
const report={checked_at:new Date().toISOString(),task:'Inspect Workers request/CPU and D1 limits and their pricing context.',input,
 baseline:{method:'One local command; parallel GETs and query-matching lines with two preceding/three following context lines; 1200 chars/page cap.',source_requests:3,source_bytes:raw.reduce((n,s)=>n+Buffer.byteLength(s.text),0),returned_json_bytes:Buffer.byteLength(JSON.stringify(baseline)),elapsed_ms:Math.round(baselineMs),code_preservation:'not guaranteed at line/budget boundaries'},
 docs_pack:{method:'Actual product handler; public sources and robots checks, exact excerpts with hashes/offsets; no payment.',source_requests:3,total_network_requests:networkCalls,source_bytes:output.sources.reduce((n,s)=>n+s.source_bytes,0),returned_json_bytes:Buffer.byteLength(JSON.stringify(output)),excerpt_chars:output.excerpt_chars,elapsed_ms:Math.round(packMs),source_metadata:output.sources.map(({excerpts,...s})=>({...s,excerpt_count:excerpts.length,matched_terms:[...new Set(excerpts.flatMap(e=>e.matched_terms))]}))},
 interpretation:'A bounded convenience/output-contract experiment. Both paths use one scripted client round trip and produce compact source text. This single ordered run does not establish speed, token, correctness or agent-task improvement over a competent baseline. Baseline is smaller; product adds validated complete code handling, access rules, hashes and exact offsets. No provider/model usage, payments or demand tested.',
 production_cpu_ms:null,actual_tokens:null,settlements_attempted:0};
mkdirSync(new URL('../evidence/',import.meta.url),{recursive:true});writeFileSync(new URL('../evidence/docs-pack-benchmark.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
writeFileSync('/tmp/agenttoolbox-docs-pack-output.json',JSON.stringify(output,null,2));console.log(JSON.stringify(report,null,2));
