import {requiresCreatorBinding,resolveCreatorInstallation} from './creator-installations.js';
// Retain stable product tombstones so original paid requests still reach replay.
// No generic endpoint loader, source evaluation or owner installation occurs here.
export async function creatorRuntimeCatalog({db,catalog,handlers}){
 return Promise.all(catalog.map(async product=>{
  const handler=handlers[product.id];if(!requiresCreatorBinding(product,handler))return product;
  try{await resolveCreatorInstallation({db,product,handler});return product;}
  catch(error){if(error?.code!=='creator_adapter_unavailable')throw error;return {...product,status:'retired',pricing:{...product.pricing,payments_configured:false},retirement:{reason:'Creator execution is unavailable until the compiled adapter matches an active reviewed installation. Prior paid requests retain their original replay rights.'}};}
 }));
}
