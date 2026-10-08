import {minimumAmount} from '../../platform/src/payment-config.js';
import {SEARCH_QUERY_CHARS,normalizeSearchText,normalizeSearchQuery,searchTerms,matchesProductSearch} from '../../platform/src/search.js';
export const CATALOG_LIMITS=Object.freeze({query_chars:SEARCH_QUERY_CHARS,default_limit:20,max_limit:50});

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
// The canonical public registry is the only input. Approved private proposals
// are not publication records and must never be joined into this selector.
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
export const isPublishedTool=tool=>!!(tool&&tool.status==='active'&&
 /^[a-z0-9-]{1,64}$/.test(text(tool.id))&&nonempty(tool.name)&&nonempty(tool.summary)&&
 /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(text(tool.version))&&
 tool.pricing?.payments_enabled===true&&tool.pricing.payments_configured!==false&&
 tool.pricing.currency==='USDC'&&tool.pricing.decimals===6&&tool.pricing.network==='eip155:8453'&&
 tool.pricing.model==='buyer_chosen_per_success'&&tool.pricing.payment_protocol==='x402-v2-exact'&&minimumAmount(tool)!==null&&
 tool.invocation?.method==='POST'&&tool.invocation.path===`/v1/products/${tool.id}/invoke`&&
 object(tool.input_schema)&&object(tool.output_schema)&&object(tool.outcome?.criteria)&&
 nonempty(tool.outcome.success_criterion)&&Array.isArray(tool.outcome.criteria.rules)&&tool.outcome.criteria.rules.length>0&&
 nonempty(tool.provider?.id)&&nonempty(tool.provider?.name)&&nonempty(tool.provider?.type));

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
 const query=normalizeSearchQuery(raw);
 if(Array.from(query).length>CATALOG_LIMITS.query_chars)
  throw new CatalogQueryError(`q must be at most ${CATALOG_LIMITS.query_chars} characters.`);
 const requestedPage=integer(params,'page',1);
 const limit=Math.min(integer(params,'limit',CATALOG_LIMITS.default_limit),CATALOG_LIMITS.max_limit);
 const published=model.tools.filter(isPublishedTool);
 const terms=searchTerms(query);
 const matches=published.filter(tool=>matchesProductSearch(tool,terms))
  .sort((a,b)=>compare(normalizeSearchText(a.name),normalizeSearchText(b.name))||compare(text(a.id),text(b.id)));
 const total=matches.length,pageCount=Math.max(1,Math.ceil(total/limit));
 const page=Math.min(requestedPage,pageCount),offset=(page-1)*limit;
 const tools=matches.slice(offset,offset+limit);
 return {tools,query,page,limit,total,catalogTotal:published.length,pageCount,
  start:total?offset+1:0,end:offset+tools.length,
  previousUrl:page>1?catalogUrl(query,page-1,limit):null,
  nextUrl:page<pageCount?catalogUrl(query,page+1,limit):null,
  canonicalUrl:catalogUrl(query,page,limit)};
}
