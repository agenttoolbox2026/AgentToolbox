// Supported settlement policy and public terms share one source.
export const BASE_NETWORK='eip155:8453';
export const BASE_USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const FACILITATOR='https://facilitator.payai.network';
export const MAX_PAYMENT_TIMEOUT_SECONDS=300;
export function paymentRequirements(product,config){
 const asset=config?.asset===undefined?BASE_USDC:config.asset;
 if(!config?.enabled||!config.receiverConfirmed||config.network!==BASE_NETWORK||
    typeof asset!=='string'||asset.toLowerCase()!==BASE_USDC.toLowerCase()||
    !/^0x[0-9a-fA-F]{40}$/.test(config.payTo??'')||
    !['active','validation'].includes(product.status)||!product.pricing.payments_enabled||
    !Number.isSafeInteger(product.pricing.amount_atomic)||product.pricing.amount_atomic<=0)return null;
 return {scheme:'exact',network:config.network,asset,amount:String(product.pricing.amount_atomic),payTo:config.payTo,
  maxTimeoutSeconds:MAX_PAYMENT_TIMEOUT_SECONDS,extra:{name:'USD Coin',version:'2',assetTransferMethod:'eip3009'}};
}
export function runtimeCatalog(catalog,handlers,config){
 return catalog.map(product=>{
  if(!product.pricing.payments_enabled)return product;
  const terms=handlers[product.id]?paymentRequirements(product,config):null;
  return {...product,pricing:{...product.pricing,payments_configured:!!terms,
   ...(terms?{network:terms.network,asset:terms.asset,pay_to:terms.payTo}:{pay_to:null})}};
 });
}
export function formatUsdcPrice(atomic){
 const amount=BigInt(atomic),fraction=(amount%1000000n).toString().padStart(6,'0').replace(/0+$/,'').padEnd(2,'0');
 return (amount/1000000n).toString()+'.'+fraction;
}
