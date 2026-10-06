import {writeFileSync} from 'node:fs';
const response=await fetch('https://facilitator.payai.network/supported',{signal:AbortSignal.timeout(10000)});
if(!response.ok)throw new Error('Capability fetch failed: '+response.status);
const body=await response.json();
const result={checked_at:new Date().toISOString(),source:'https://facilitator.payai.network/supported',kinds:body.kinds?.filter(x=>x.network==='eip155:8453'),pricing:{...body.pricing,rates:body.pricing?.rates?.filter(x=>x.network==='eip155:8453')},read_only:true,settlements_attempted:0};
if(!result.kinds?.some(x=>x.x402Version===2&&x.scheme==='exact'))throw new Error('Base exact v2 not advertised');
writeFileSync(new URL('../payment-capabilities.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
