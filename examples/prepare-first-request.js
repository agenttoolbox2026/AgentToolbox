// Read-only discovery and local input validation. Never signs or sends a POST.
import {createHash,randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {canonicalJson,successContractDocument} from '../platform/src/contract-pins.js';
import {products} from '../platform/src/registry.js';
import {createDocsPack} from '../platform/src/docs-pack.js';
import {createQuoteProof} from '../platform/src/quote-proof.js';
import {createContractCases} from '../platform/src/contract-cases.js';
import {createMcpWireCheck} from '../platform/src/mcp-wirecheck.js';
const origin='https://agi.agenttoolbox2026.workers.dev';
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');
const constructors={'docs-pack':createDocsPack,'quote-proof':createQuoteProof,'contract-cases':createContractCases,'mcp-wirecheck':createMcpWireCheck};
const fail=message=>{throw new Error(message);};
function verifiedPin(pin){
 if(pin?.canonicalization?.id!=='agenttoolbox-json-v1'||typeof pin.canonical_json!=='string'||sha(pin.canonical_json)!==pin.sha256)fail('The current contract hash could not be verified. Nothing was prepared.');
 const parsed=JSON.parse(pin.canonical_json);
 if(canonicalJson(parsed)!==pin.canonical_json)fail('Unexpected canonical contract bytes. Nothing was prepared.');
 return parsed;
}
export async function prepareFirstRequest({tool='docs-pack',input,fetchImpl=fetch,key=randomBytes(32).toString('hex')}={}){
 if(!Object.hasOwn(constructors,tool))fail('Choose docs-pack, quote-proof, contract-cases or mcp-wirecheck.');
 const path='/v1/products/'+tool;
 async function read(suffix,status=200){
  const response=await fetchImpl(origin+path+suffix,{method:'GET',headers:{Accept:'application/json','X-AgentToolbox-Sample':'synthetic'},credentials:'omit',redirect:'error',signal:AbortSignal.timeout(15000)});
  if(response.status!==status)fail('Discovery returned HTTP '+response.status+'. Nothing was prepared.');
  if(!response.headers.get('content-type')?.startsWith('application/json'))fail('Discovery did not return JSON.');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>262144)fail('Discovery exceeded the helper byte bound.');chunks.push(value);}}
  catch(error){await reader.cancel();throw error;}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 }
 const [detail,criteria,challenge]=await Promise.all([read(''),read('/criteria'),read('/invoke',402)]);
 const product=detail.product,success=verifiedPin(criteria),requirements=verifiedPin(challenge.payment_requirements_pin),url=origin+path+'/invoke';
 if(product?.id!==tool||success.product_id!==tool||success.product_version!==product.version||canonicalJson(successContractDocument(product))!==criteria.canonical_json)fail('The current product and success contract differ. Nothing was prepared.');
 if(challenge.discovery_only!==true||challenge.invoke_method!=='POST'||challenge.payment?.x402Version!==2||challenge.payment?.resource?.url!==url||challenge.payment?.accepts?.length!==1||canonicalJson(challenge.payment.accepts[0])!==canonicalJson(requirements)||challenge.contract_pins?.success_contract_sha256!==criteria.sha256||challenge.contract_pins?.payment_requirements_sha256!==challenge.payment_requirements_pin.sha256)fail('The current payment challenge and pins differ. Nothing was prepared.');
 const installed=products.find(p=>p.id===tool);
 if(canonicalJson(successContractDocument(installed))!==criteria.canonical_json)fail('This checkout differs from the current live contract. Update the checkout before local preflight.');
 if(!/^[1-9][0-9]{0,77}$/.test(requirements.amount)||requirements.amount!==product.pricing.minimum_amount_atomic||!/^[A-Za-z0-9_-]{32,128}$/.test(key))fail('Unexpected minimum amount or request key.');
 const noFetch=()=>fail('Input preflight never executes a tool.');
 const normalized=constructors[tool]({fetcher:noFetch,fetchImpl:noFetch}).input.parse(input??product.example_input);
 const body_utf8=JSON.stringify({version:product.version,input:normalized,max_charge_usdc_atomic:requirements.amount,success_contract_sha256:criteria.sha256,payment_requirements_sha256:challenge.payment_requirements_pin.sha256});
 return {status:'unsigned_request_not_sent',method:'POST',url,headers:{'Content-Type':'application/json','Idempotency-Key':key},body_utf8,body_sha256:sha(body_utf8),input_check:{accepted_by_local_runtime:true,outcome_checked:false,external_execution:false},wallet_handoff:{requirements,signature_present:false},
  guidance:'Inspect amount, network, asset and receiver before using your own x402 v2 wallet client. Save its complete original authorization before sending. Retain exact body, key, capability (if any) and authorization after uncertain delivery. This helper does not sign, pay, execute, quote or prepare a remote result.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [tool='docs-pack',destination='agenttoolbox-unsigned-request.json',inputPath]=process.argv.slice(2);
  const input=inputPath?JSON.parse(await readFile(inputPath,'utf8')):undefined;
  const envelope=await prepareFirstRequest({tool,input});
  await writeFile(destination,JSON.stringify(envelope,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Saved unsigned request to '+destination+'. No invocation was sent and no payment was authorized.');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
