// Bounded static HTML extraction helpers. Unknown entity/CSS syntax is not
// evidence of visible text; callers fail closed rather than render a browser.
const entities=Object.freeze({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:'\u00a0',hellip:'…',mdash:'—',ndash:'–',lsquo:'‘',rsquo:'’',ldquo:'“',rdquo:'”',copy:'©',reg:'®',trade:'™',times:'×',divide:'÷',minus:'−',le:'≤',ge:'≥',bull:'•',middot:'·',laquo:'«',raquo:'»'});
const uncertain=()=>{throw new Error('extraction_uncertain');};
const cssTrim=value=>value.replace(/^[ \t\n\r\f]+|[ \t\n\r\f]+$/g,'');
const cssLower=value=>value.replace(/[A-Z]/g,char=>String.fromCharCode(char.charCodeAt(0)+32));
export function decodeHtmlEntities(value){
 return value.replace(/&(?:#[^;\s<>&]*;?|[A-Za-z][A-Za-z0-9]*;?)/g,entity=>{
  if(!entity.endsWith(';'))uncertain();
  const name=entity.slice(1,-1);
  if(!name.startsWith('#')){if(!Object.hasOwn(entities,name))uncertain();return entities[name];}
  if(!/^#(?:[0-9]+|[xX][0-9a-fA-F]+)$/.test(name))uncertain();
  const cp=name[1]?.toLowerCase()==='x'?parseInt(name.slice(2),16):Number(name.slice(1));
  if(!Number.isInteger(cp)||cp<=0||cp>0x10ffff||(cp>=0xd800&&cp<=0xdfff)||(cp>=0x80&&cp<=0x9f))uncertain();
  return String.fromCodePoint(cp);
 });
}

export function inlineHidden(element){
 if(element.hasAttribute('hidden')||(element.getAttribute('aria-hidden')??'').toLowerCase()==='true')return true;
 const source=decodeHtmlEntities(element.getAttribute('style')??'');
 // Delimiters inside strings/functions/custom-property values are not CSS
 // declaration boundaries. Unsupported or incomplete syntax stays uncertain.
 if(source.includes('\\'))uncertain();
 let style='',quote=null;
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(quote){if(/[\n\r\f]/.test(c))uncertain();style+=c;if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"){quote=c;style+=c;continue;}
  if(c==='/'&&source[i+1]==='*'){
   const end=source.indexOf('*/',i+2);if(end<0)uncertain();style+=' ';i=end+1;continue;
  }
  style+=c;
 }
 if(quote)uncertain();
 const declarations=[];let start=0;const stack=[];quote=null;
 for(let i=0;i<style.length;i++){
  const c=style[i];
  if(quote){if(/[\n\r\f]/.test(c))uncertain();if(c===quote)quote=null;continue;}
  if(c==='"'||c==="'"){quote=c;continue;}
  // Unquoted url() has a distinct bad-URL recovery grammar. Do not treat
  // quotes inside it as ordinary string delimiters or infer visibility.
  if((c==='u'||c==='U')&&!/[A-Za-z0-9_-]/.test(style[i-1]??'')){
   const url=/^url[ \t\n\r\f]*\([ \t\n\r\f]*/i.exec(style.slice(i));
   if(url&&!['"',"'"].includes(style[i+url[0].length]))uncertain();
  }
  if(c==='('||c==='['||c==='{')stack.push(c);
  else if(c===')'||c===']'||c==='}'){
   if(stack.pop()!==({')':'(',']':'[','}':'{'})[c])uncertain();
  }else if(c===';'&&!stack.length){declarations.push(style.slice(start,i));start=i+1;}
 }
 if(quote||stack.length)uncertain();declarations.push(style.slice(start));
 const selected=new Map();
 for(const declaration of declarations){
  const colon=declaration.indexOf(':');if(colon<0)continue;
  const property=cssLower(cssTrim(declaration.slice(0,colon)));
  if(!['display','visibility','content-visibility'].includes(property))continue;
  let value=cssLower(cssTrim(declaration.slice(colon+1)));
  const important=/[ \t\n\r\f]*![ \t\n\r\f]*important[ \t\n\r\f]*$/.test(value);value=cssTrim(value.replace(/[ \t\n\r\f]*![ \t\n\r\f]*important[ \t\n\r\f]*$/,''));
  const allowed=property==='display'?/^(none|block|inline|inline-block|contents|flex|inline-flex|grid|inline-grid|table|inline-table|table-row|table-cell|list-item|flow-root)$/:property==='visibility'?/^(visible|hidden|collapse)$/:/^(visible|hidden|auto)$/;
  if(!allowed.test(value))uncertain();
  const prior=selected.get(property);
  if(!prior||important||!prior.important)selected.set(property,{value,important});
 }
 return selected.get('display')?.value==='none'||['hidden','collapse'].includes(selected.get('visibility')?.value)||selected.get('content-visibility')?.value==='hidden';
}
