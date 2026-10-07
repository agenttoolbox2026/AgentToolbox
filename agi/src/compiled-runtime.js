import {products} from '../../platform/src/registry.js';
import {reviewedCreatorRegistry} from '../../platform/src/reviewed-creator-adapters.js';
import {canonicalJson} from '../../platform/src/contract-pins.js';
import {createDocsPack} from '../../platform/src/docs-pack.js';
import {createQuoteProof} from '../../platform/src/quote-proof.js';
import {createContractCases} from '../../platform/src/contract-cases.js';
import {createMcpWireCheck} from '../../platform/src/mcp-wirecheck.js';

// When an executable creator adapter is removed from reviewed source, retain its
// last public product here. These source-owned tombstones keep paid replay routes
// addressable. Never populate this list from proposal bodies, URLs, D1 or env.
export const archivedCreatorProducts=Object.freeze([]);
const firstPartyHandlers=()=>({'docs-pack':createDocsPack(),'quote-proof':createQuoteProof(),
 'contract-cases':createContractCases(),'mcp-wirecheck':createMcpWireCheck()});
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function tombstone(product){
 if(!/^creator-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(product?.id??'')||product.provider?.type!=='creator'||
  !/^\d+\.\d+\.\d+$/.test(product.version??'')||!product.pricing||typeof product.pricing!=='object'||Array.isArray(product.pricing))
  throw new TypeError('Archived creator products must retain their source-owned product identity and pricing.');
 const copy=JSON.parse(JSON.stringify(product));canonicalJson(copy);
 return freeze({...copy,status:'retired',pricing:{...copy.pricing,payments_configured:false},
  retirement:{reason:'The compiled creator adapter is no longer available. Prior paid requests retain their original replay rights.'}});
}

// Internal source/test composition only. No request, environment or database
// value may provide executable code, products, registry entries or handlers.
export async function createCompiledRuntime({registry=reviewedCreatorRegistry,
 archivedProducts=archivedCreatorProducts,builtinCatalog=products,builtinHandlers=firstPartyHandlers()}={}){
 const reviewed=(await registry).getRuntime();
 const catalog=[...builtinCatalog,...reviewed.products,...archivedProducts.map(tombstone)];
 if(new Set(catalog.map(p=>p.id)).size!==catalog.length)throw new TypeError('Compiled product IDs must be unique, including archived products.');
 for(const id of Object.keys(reviewed.handlers))if(Object.hasOwn(builtinHandlers,id))throw new TypeError('Reviewed adapters cannot replace first-party handlers.');
 const handlers={...builtinHandlers,...reviewed.handlers};
 for(const product of archivedProducts)if(Object.hasOwn(handlers,product.id))throw new TypeError('Archived products cannot retain executable handlers.');
 return Object.freeze({catalog:Object.freeze(catalog),handlers:Object.freeze(handlers)});
}
let compiled;
export const getCompiledRuntime=()=>compiled??=createCompiledRuntime();
