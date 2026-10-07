export const CATALOG_LIMITS=Object.freeze({query_chars:120,default_limit:20,max_limit:50});

export class CatalogQueryError extends Error{
 constructor(message){super(message);this.name='CatalogQueryError';this.status=400;this.code='invalid_catalog_query';}
}

function integer(params,key,fallback){
 const value=params.get(key);
 if(value===null||value==='')return fallback;
 if(!/^[1-9][0-9]*$/.test(value)||!Number.isSafeInteger(Number(value)))
  throw new CatalogQueryError(`${key} must be a positive integer.`);
 return Number(value);
}

const compare=(a,b)=>a<b?-1:a>b?1:0;
const text=value=>typeof value==='string'?value:'';
const normalize=value=>text(value).normalize('NFKC').toLowerCase();
// The canonical public registry is the only input. Approved private proposals
// are not publication records and must never be joined into this selector.
const available=tool=>tool.status==='active'&&tool.pricing?.payments_enabled===true&&
 tool.pricing.payments_configured!==false&&tool.invocation?.method==='POST'&&
 text(tool.invocation.path).startsWith('/v1/products/')&&tool.input_schema&&tool.output_schema&&
 tool.outcome?.criteria&&text(tool.provider?.id)&&text(tool.provider?.name)&&text(tool.provider?.type);

function catalogUrl(query,page,limit){
 const params=new URLSearchParams();
 if(query)params.set('q',query);
 if(page!==1)params.set('page',String(page));
 if(limit!==CATALOG_LIMITS.default_limit)params.set('limit',String(limit));
 return '/tools'+(params.size?'?'+params.toString():'');
}

export function selectCatalog(model,params=new URLSearchParams()){
 for(const key of ['q','page','limit'])if(params.getAll(key).length>1)
  throw new CatalogQueryError(`Use one ${key} parameter.`);
 const raw=params.get('q')??'';
 if(Array.from(raw).length>CATALOG_LIMITS.query_chars)
  throw new CatalogQueryError(`q must be at most ${CATALOG_LIMITS.query_chars} characters.`);
 const query=raw.normalize('NFKC').trim().replace(/\s+/gu,' ');
 if(Array.from(query).length>CATALOG_LIMITS.query_chars)
  throw new CatalogQueryError(`q must be at most ${CATALOG_LIMITS.query_chars} characters.`);
 const requestedPage=integer(params,'page',1);
 const limit=Math.min(integer(params,'limit',CATALOG_LIMITS.default_limit),CATALOG_LIMITS.max_limit);
 const published=model.tools.filter(available);
 const terms=normalize(query).split(' ').filter(Boolean);
 const matches=published.filter(tool=>{
  const haystack=normalize([tool.id,tool.name,tool.summary,tool.problem,tool.fit,tool.scope,
   tool.provider.id,tool.provider.name,tool.provider.type,...(tool.tags??[])].join(' '));
  return terms.every(term=>haystack.includes(term));
 }).sort((a,b)=>compare(normalize(a.name),normalize(b.name))||compare(text(a.id),text(b.id)));
 const total=matches.length,pageCount=Math.max(1,Math.ceil(total/limit));
 const page=Math.min(requestedPage,pageCount),offset=(page-1)*limit;
 const tools=matches.slice(offset,offset+limit);
 return {tools,query,page,limit,total,catalogTotal:published.length,pageCount,
  start:total?offset+1:0,end:offset+tools.length,
  previousUrl:page>1?catalogUrl(query,page-1,limit):null,
  nextUrl:page<pageCount?catalogUrl(query,page+1,limit):null,
  canonicalUrl:catalogUrl(query,page,limit)};
}
