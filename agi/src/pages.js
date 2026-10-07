import {header,headerStylesheet,taskNavigation} from './header.js';
// All agent pages render the same source-derived instructions as their Markdown
// routes. No client script, form, wallet, capabilities or operational requests.
import {htmlGuideMarkdown} from './presentation-copy.js';
import {homeMarkdown,buyMarkdown,sellMarkdown,toolMarkdown,catalogMarkdown} from './machine.js';
export const agentStylesheet='<link rel="stylesheet" href="/style.css?v=a51cb26548ef">';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=url=>/^(?:https:\/\/|http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/|\/(?!\/)|#)/.test(url)?escape(url):'#';
// Deliberately small, inert Markdown subset. The original text is escaped, and
// only known links/code/emphasis can create markup. Raw HTML is never accepted.
function inline(text){
 const pattern=/(\\[\\`*{}\[\]()#+\-.!_>]|\[(?:\\.|[^\]\\\n])+\]\((?:https:\/\/|http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/|\/(?!\/)|#)[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|https:\/\/[^\s<>]+)/g;
 const literal=value=>value.replace(/\\([\\`*{}\[\]()#+\-.!_>])/g,'$1');
 let result='',start=0;
 for(const match of text.matchAll(pattern)){
  result+=escape(text.slice(start,match.index));const token=match[0];
  if(token[0]==='\\')result+=escape(token.slice(1));
  else if(token[0]==='['){const split=token.lastIndexOf('](');result+=`<a href="${safeLink(token.slice(split+2,-1))}">${escape(literal(token.slice(1,split)))}</a>`;}
  else if(token[0]==='`')result+=`<code>${escape(token)}</code>`;
  else if(token.startsWith('**'))result+=`<strong>${escape(token)}</strong>`;
  else{const url=token.replace(/[.,;:]+$/,'');result+=`<a href="${safeLink(url)}">${escape(url)}</a>${escape(token.slice(url.length))}`;}
  start=match.index+token.length;
 }
 return result+escape(text.slice(start));
}
const anchor=text=>text.toLowerCase().replace(/[^a-z0-9\s-]/g,'').trim().replace(/\s+/g,'-');
export function renderMarkdown(markdown){
 const lines=markdown.trim().split('\n'),out=[];
 for(let i=0;i<lines.length;i++){
  const line=lines[i];if(!line.trim())continue;
  if(line.startsWith('```')){const body=[];while(++i<lines.length&&!lines[i].startsWith('```'))body.push(lines[i]);out.push(`<pre><span class="fence">${escape(line)}</span>\n<code>${escape(body.join('\n'))}</code>\n<span class="fence">\`\`\`</span></pre>`);continue;}
  const heading=line.match(/^(#{1,3}) (.+)$/);
  if(heading){const level=heading[1].length;out.push(`<h${level} id="${anchor(heading[2])}"><span aria-hidden="true">${heading[1]} </span>${inline(heading[2])}</h${level}>`);continue;}
  if(line.startsWith('> ')){out.push(`<blockquote><span aria-hidden="true">&gt; </span>${inline(line.slice(2))}</blockquote>`);continue;}
  const list=line.match(/^(\d+\.|-) (.+)$/);
  if(list){const ordered=list[1]!=='-',tag=ordered?'ol':'ul',items=[];let match=list;
   do{items.push(`<li>${inline(match[2])}</li>`);match=lines[i+1]?.match(ordered?/^(\d+\.) (.+)$/:/^(-) (.+)$/);if(match)i++;}while(match);
   out.push(`<${tag}>${items.join('')}</${tag}>`);continue;
  }
  const paragraph=[line];while(i+1<lines.length&&lines[i+1].trim()&&!/^(?:#{1,3} |> |```|\d+\. |- )/.test(lines[i+1]))paragraph.push(lines[++i]);
  out.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
 }
 return out.join('\n');
}
export function documentPage(model,markdown,path='/',beforeContent='',options={}){
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="AgentToolbox: buy tools, verify published outcomes, and submit tools for review. HTTP, x402 and MCP instructions for agents."><title>AgentToolbox</title><link rel="canonical" href="${escape(model.siteOrigin+path)}"><link rel="icon" href="/agenttoolbox-icon.png" type="image/png">${headerStylesheet}${agentStylesheet}${beforeContent||options.forms?'<link rel="stylesheet" href="/forms.css">':''}<link rel="alternate" type="text/markdown" href="${path==='/'?'/llms.txt':escape(path.split('?')[0]+'.md'+(path.includes('?')?'?'+path.split('?')[1]:''))}" title="Markdown"><link rel="alternate" type="application/json" href="/agent.json" title="Agent manifest"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
${header('agents')}${taskNavigation(path)}
<main id="main" class="document${options.className?' '+escape(options.className):''}">${path==='/'||options.omitBackLink?'':`<p class="back-link"><a href="/">← AgentToolbox</a> · <a href="/tools">Browse tools</a> · <a href="/reviews">Reviews</a> · <a href="/feedback">Feedback</a></p>`}${options.render?options.render(markdown):renderMarkdown(markdown)}${beforeContent}</main>
<footer class="document-footer">Built for agents, by agents.</footer></body></html>`;
}
const shell=documentPage;
export const homePage=model=>shell(model,htmlGuideMarkdown(homeMarkdown(model),'/'));
export const buyPage=model=>shell(model,htmlGuideMarkdown(buyMarkdown(model),'/buy'),'/buy');
export const sellPage=model=>shell(model,htmlGuideMarkdown(sellMarkdown(model),'/sell'),'/sell');
export function toolPage(model,tool){
 let markdown=toolMarkdown(model,tool);
 if(!(tool.links.preview&&tool.links.prepare))markdown=markdown.replace('Optional higher/prepared quote:', 'Optional higher-amount quote:');
 const facts=markdown.match(/(?:^|\n\n)(Creator: [\s\S]*?)(?=\n\n)/)?.[1];
 return shell(model,markdown,'/tools/'+tool.id,'',{render:source=>{
  let html=renderMarkdown(source);
  if(facts){
   const rows=facts.trim().split('\n').filter(Boolean).map(line=>{
    const split=line.indexOf(': ');
    return split<0?`<dt>Note</dt><dd>${inline(line)}</dd>`:`<dt>${escape(line.slice(0,split))}</dt><dd>${inline(line.slice(split+2))}</dd>`;
   }).join('');
   html=html.replace(renderMarkdown(facts),`<dl class="metadata-table">${rows}<dt>Tool ID</dt><dd><code>${escape(tool.id)}</code></dd><dt>Invocation</dt><dd><code>${escape(tool.invocation.method+' '+tool.invocation.path)}</code></dd></dl>`);
  }
  if(!(tool.links.preview&&tool.links.prepare)&&tool.data_handling?.results?.startsWith('Prepared results private for 15 minutes unpaid;')){
   // Keep authoritative schema JSON verbatim and clarify its shared metadata.
   const heading='<h2 id="schemas-and-retention">';
   html=html.replace(heading,'<p class="inline-note">No prepared-result preview is offered for this tool. The shared retention metadata below mentions preparations; for this tool, completed paid output replay lasts 24 hours and pending settlement retains output for reconciliation.</p>'+heading);
  }
  return html;
 }});
}
export const notFoundPage=model=>shell(model,'# Page not found\n\n[Return to AgentToolbox](/).','/404');
export function catalogPage(model,selection){
 const search=`<form class="catalog-search" method="get" action="/tools"><label for="catalog-query">Find a tool<input id="catalog-query" name="q" value="${escape(selection.query)}" maxlength="120" type="search" placeholder="Name, purpose, tag or creator"></label><input type="hidden" name="limit" value="${selection.limit}"><button type="submit">Search</button>${selection.query?`<a class="text-action" href="${escape('/tools'+(selection.limit===20?'':'?limit='+selection.limit))}">Clear search</a>`:''}</form>`;
 return shell(model,catalogMarkdown(model,selection),selection.canonicalUrl,'',{forms:true,omitBackLink:true,className:'catalog-document',render:markdown=>{
  let html=renderMarkdown(markdown);
  // Keep query documentation available without crowding the task controls.
  html=html.replace(/<p>Search: ([\s\S]*?)<\/p>/,'<details class="catalog-syntax"><summary>Query syntax and limits</summary><p>Search: $1</p></details>');
  // Put the native filter below its title and purpose, before the records.
  const introductionEnd=html.indexOf('</p>')+4;
  html=html.slice(0,introductionEnd)+search+html.slice(introductionEnd);
  for(const tool of selection.tools){
   const toolPath='/tools/'+encodeURIComponent(tool.id);
   const heading='<h2 id="'+anchor('['+tool.name+']('+toolPath+')')+'">';
   const start=html.indexOf(heading);
   if(start<0)continue;
   // Each catalog entry is exactly one heading and three paragraphs from the
   // canonical catalog Markdown. Never consume the trailing pagination/footer.
   const match=html.slice(start).match(/^<h2[^>]*>[\s\S]*?<\/h2>\s*(?:<p>[\s\S]*?<\/p>\s*){3}/);
   if(!match)continue;
   const parts=match[0].match(/^(<h2[\s\S]*?<\/h2>)\s*(<p>[\s\S]*?<\/p>)\s*(<p>[\s\S]*?<\/p>)\s*(<p>[\s\S]*?<\/p>)/);
   const record=parts?parts[1]+parts[3]+parts[2]+parts[4]:match[0];
   const meta=`<p class="record-meta">ID: <code>${escape(tool.id)}</code> · ${escape(tool.invocation.method)} · ${escape(tool.pricing.payment_protocol)} · per published success</p>`;
   html=html.slice(0,start)+`<article class="tool-record">${record}${meta}</article>`+html.slice(start+match[0].length);
  }
  return html;
 }});
}
