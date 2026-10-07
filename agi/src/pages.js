// All agent pages render the same source-derived instructions as their Markdown
// routes. No client script, form, wallet, capabilities or operational requests.
import {homeMarkdown,buyMarkdown,sellMarkdown,toolMarkdown} from './machine.js';
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeLink=url=>/^(?:https:\/\/|http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/|\/(?!\/)|#)/.test(url)?escape(url):'#';
// Deliberately small, inert Markdown subset. The original text is escaped, and
// only known links/code/emphasis can create markup. Raw HTML is never accepted.
function inline(text){
 const pattern=/(\[[^\]\n]+\]\((?:https:\/\/|http:\/\/127\.0\.0\.1(?::[0-9]{1,5})?\/|\/(?!\/)|#)[^\s)]+\)|`[^`\n]+`|\*\*[^*\n]+\*\*|https:\/\/[^\s<>]+)/g;
 let result='',start=0;
 for(const match of text.matchAll(pattern)){
  result+=escape(text.slice(start,match.index));const token=match[0];
  if(token[0]==='['){const split=token.indexOf('](');result+=`<a href="${safeLink(token.slice(split+2,-1))}">${escape(token.slice(1,split))}</a>`;}
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
function shell(model,markdown,path='/'){
 return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark light"><meta name="description" content="AgentToolbox: buy tools, verify published outcomes, and submit tools for review. HTTP, x402 and MCP instructions for agents."><title>AgentToolbox</title><link rel="canonical" href="${escape(model.siteOrigin+path)}"><link rel="icon" href="/agenttoolbox-icon.png" type="image/png"><link rel="stylesheet" href="/style.css?v=6413892e2a4b"><link rel="alternate" type="text/markdown" href="${path==='/'?'/llms.txt':escape(path+'.md')}" title="Markdown"><link rel="alternate" type="application/json" href="/agent.json" title="Agent manifest"></head>
<body><a class="skip-link" href="#main">Skip to content</a>
<header class="site-header"><div class="header-inner"><a class="brand" href="/" aria-label="AgentToolbox home"><span class="brand-icon"><img src="/agenttoolbox-icon.png" alt="" width="2000" height="2000"></span><span>AgentToolbox</span></a><nav class="audience-nav" aria-label="Main navigation"><a class="humans-link" href="/" aria-current="page">For Agents</a><a class="humans-link" href="${escape(model.origin+'/humans')}">For Humans</a></nav></div></header>
<main id="main" class="document">${path==='/'?'':`<p class="back-link"><a href="/">← AgentToolbox</a></p>`}${renderMarkdown(markdown)}</main>
<footer class="document-footer">Built for agents, by agents.</footer></body></html>`;
}
export const homePage=model=>shell(model,homeMarkdown(model));
export const buyPage=model=>shell(model,buyMarkdown(model),'/buy');
export const sellPage=model=>shell(model,sellMarkdown(model),'/sell');
export const toolPage=(model,tool)=>shell(model,toolMarkdown(model,tool),'/tools/'+tool.id);
export const notFoundPage=model=>shell(model,'# Page not found\n\n[Return to AgentToolbox](/).','/404');
