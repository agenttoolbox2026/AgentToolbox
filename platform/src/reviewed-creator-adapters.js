import {z} from 'zod';
import {PlatformError} from './service.js';
import {successContractPin,canonicalJson} from './contract-pins.js';
import {recordCreatorInstallation} from './creator-installations.js';
import {creatorToolIdSchema} from './tool-updates.js';
const id=z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,255}$/),version=z.string().regex(/^\d+\.\d+\.\d+$/),digest=z.string().regex(/^[0-9a-f]{64}$/);
const manifestSchema=z.strictObject({manifestId:id,toolId:creatorToolIdSchema.refine(value=>z.uuid().safeParse(value.slice(8)).success),metadataRevision:z.number().int().min(0).max(2147483646),metadataVersion:version,sourceCommit:z.string().regex(/^[0-9a-f]{40}$/),artifactSha256:digest,successContractSha256:digest,productVersion:version,adapterId:id,product:z.unknown(),handler:z.unknown()});
const owner={reviewer:z.string().min(1).max(256).refine(x=>x===x.trim()),requestId:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),expectedRevision:z.number().int().min(0).max(2147483646)};
const installSchema=z.strictObject({...owner,manifestId:id});
const suspendSchema=z.strictObject({...owner,toolId:manifestSchema.shape.toolId});
const invalid=()=>new PlatformError(400,'invalid_reviewed_creator_manifest','Use a reviewed compiled creator manifest and the strict operator request schema.');
const handlerKeys=new Set(['input','output','run','success','preview','failureReason','creatorAdapterId','creatorArtifactSha256','creatorContractSha256']);
const missing=()=>new PlatformError(404,'reviewed_creator_manifest_not_found','No reviewed compiled creator manifest is available for that identifier.');
function parse(schema,value){const result=schema.safeParse(value);if(!result.success)throw invalid();return result.data;}
function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function productSnapshot(product){
 // Source-owned metadata only. Copy enumerable JSON values, including published Zod JSON schemas.
 if(!product||typeof product!=='object'||Array.isArray(product))throw invalid();
 let snapshot;try{snapshot=JSON.parse(JSON.stringify(product));canonicalJson(snapshot);}catch{throw invalid();}
 return freeze(snapshot);
}
// Trusted source constructor only: never pass HTTP/MCP bodies, environment values or fetched code.
// The source commit and artifact digest are review provenance, not an automatic source attestation.
export async function createReviewedCreatorRegistry(entries=[]){
 if(!Array.isArray(entries))throw invalid();
 const manifests=new Map(),tools=new Map();
 for(const entry of entries){
  const d=parse(manifestSchema,entry),product=productSnapshot(d.product),handler=d.handler;
  if(manifests.has(d.manifestId)||tools.has(d.toolId)||product.id!==d.toolId||product.version!==d.productVersion||product.provider?.type!=='creator'||typeof handler!=='object'||handler===null||Object.keys(handler).some(key=>!handlerKeys.has(key))||typeof handler.run!=='function'||typeof handler.success!=='function'||typeof handler.input?.safeParse!=='function'||typeof handler.output?.safeParse!=='function'||handler.creatorAdapterId!==d.adapterId||handler.creatorArtifactSha256!==d.artifactSha256||handler.creatorContractSha256!==d.successContractSha256)throw invalid();
  for(const key of ['preview','failureReason'])if(handler[key]!==undefined&&typeof handler[key]!=='function')throw invalid();
  let pin;try{
   const originalPin=await successContractPin(d.product);pin=await successContractPin(product);
   if(originalPin.sha256!==pin.sha256||canonicalJson(productSnapshot(z.toJSONSchema(handler.input)))!==canonicalJson(product.input_schema)||canonicalJson(productSnapshot(z.toJSONSchema(handler.output)))!==canonicalJson(product.output_schema))throw invalid();
  }catch{throw invalid();}if(pin.sha256!==d.successContractSha256)throw invalid();
  const {product:unusedProduct,handler:unusedHandler,...fields}=d;
  const manifest=Object.freeze({...fields,...(typeof product.name==='string'?{name:product.name.slice(0,120)}:{}),...(typeof product.summary==='string'?{summary:product.summary.slice(0,1000)}:{})});
  // Snapshot declarations/functions without freezing closure-owned runtime state or Zod internals.
  const compiledHandler=Object.freeze({...handler});
  manifests.set(d.manifestId,Object.freeze({manifest,product,handler:compiledHandler}));tools.set(d.toolId,d.manifestId);
 }
 const products=Object.freeze([...manifests.values()].map(e=>e.product));
 const handlers=Object.freeze(Object.fromEntries([...manifests.values()].map(e=>[e.product.id,e.handler])));
 const runtime=Object.freeze({products,handlers});
 return Object.freeze({
  listManifests:()=>Object.freeze([...manifests.values()].map(e=>e.manifest)),
  readManifest(manifestId){const entry=manifests.get(manifestId);if(!entry)throw missing();return entry.manifest;},
  getRuntime:()=>runtime,
  async install({db,now=()=>new Date(),...input}){
   const d=parse(installSchema,input),entry=manifests.get(d.manifestId);if(!entry)throw missing();const m=entry.manifest;
   return recordCreatorInstallation({db,now,reviewer:d.reviewer,requestId:d.requestId,toolId:m.toolId,expectedRevision:d.expectedRevision,action:'install',metadataRevision:m.metadataRevision,metadataVersion:m.metadataVersion,adapterId:m.adapterId,artifactSha256:m.artifactSha256,successContractSha256:m.successContractSha256,productVersion:m.productVersion});
  },
  async suspend({db,now=()=>new Date(),...input}){
   const d=parse(suspendSchema,input);if(!tools.has(d.toolId))throw missing();
   return recordCreatorInstallation({db,now,...d,action:'suspend'});
  },
 });
}
// Intentionally empty until an actual seller artifact is reviewed and compiled into source.
export const reviewedCreatorRegistry=createReviewedCreatorRegistry();
