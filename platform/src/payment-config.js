// Supported settlement policy and public terms share one source.
export const BASE_NETWORK='eip155:8453';
export const BASE_USDC='0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const FACILITATOR='https://facilitator.payai.network';
export const MAX_PAYMENT_TIMEOUT_SECONDS=300;
export const MAX_UINT256=(2n**256n-1n).toString();
// Canonical atomic-unit strings only: no fractions, exponent notation or floats.
export function isAtomicAmount(value){return typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<=BigInt(MAX_UINT256);}
export function minimumAmount(product){
 const value=product.pricing.minimum_amount_atomic??product.pricing.amount_atomic;
 const amount=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
 return isAtomicAmount(amount)&&BigInt(amount)>0n?amount:null;
}
export function paymentRequirements(product,config,chosenAmount=minimumAmount(product)){
 const asset=config?.asset===undefined?BASE_USDC:config.asset,minimum=minimumAmount(product);
 if(!config?.enabled||!config.receiverConfirmed||config.network!==BASE_NETWORK||
    typeof asset!=='string'||asset.toLowerCase()!==BASE_USDC.toLowerCase()||
    !/^0x[0-9a-fA-F]{40}$/.test(config.payTo??'')||
    !['active','validation'].includes(product.status)||!product.pricing.payments_enabled||
    !minimum||!isAtomicAmount(chosenAmount)||BigInt(chosenAmount)<BigInt(minimum))return null;
 return {scheme:'exact',network:config.network,asset,amount:chosenAmount,payTo:config.payTo,
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
