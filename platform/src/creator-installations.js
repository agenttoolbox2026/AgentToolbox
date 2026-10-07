import {z} from 'zod';
import {PlatformError} from './service.js';
import {hash} from './telemetry.js';
import {canonical} from './x402.js';
import {successContractPin} from './contract-pins.js';
const revision=z.number().int().min(0).max(2147483646),digest=z.string().regex(/^[0-9a-f]{64}$/),text=z.string().min(1).max(256).refine(x=>x===x.trim());
const common={reviewer:text,requestId:z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),toolId:text,expectedRevision:revision};
const schema=z.discriminatedUnion('action',[
 z.strictObject({...common,action:z.literal('install'),metadataRevision:revision,metadataVersion:text,adapterId:text,artifactSha256:digest,successContractSha256:digest,productVersion:z.string().min(1).max(128)}),
 z.strictObject({...common,action:z.literal('suspend')})]);
const conflict=()=>new PlatformError(409,'creator_installation_conflict','Read the installation revision; request IDs bind the original installation request.');
const unavailable=()=>new PlatformError(503,'creator_adapter_unavailable','An active reviewed compiled creator adapter is required.');
export async function readCreatorInstallation({db,toolId}){
 return db.prepare(`SELECT h.tool_id,h.installation_id,h.revision AS installation_revision,h.state,e.creator_id,e.share_bps,e.installed_adapter,i.metadata_revision,i.metadata_version,i.adapter_id,i.artifact_sha256,i.success_contract_sha256,i.product_version FROM platform_creator_installation_heads h JOIN platform_creator_installation_events i ON i.installation_id=h.installation_id JOIN platform_creator_entitlements e ON e.tool_id=h.tool_id WHERE h.tool_id=?`).bind(toolId).first();
}
// Internal workflow: caller establishes owner authorization. No route or URL execution.
export async function recordCreatorInstallation({db,now=()=>new Date(),...input}){
 const parsed=schema.safeParse(input);if(!parsed.success)throw new PlatformError(400,'invalid_creator_installation','Use the strict installation request schema.');
 const d=parsed.data,kh=await hash(d.requestId),rh=await hash(canonical(d));
 const reload=()=>db.prepare('SELECT * FROM platform_creator_installation_events WHERE reviewer_subject=? AND request_key_hash=?').bind(d.reviewer,kh).first();
 const view=r=>({installation_id:r.installation_id,tool_id:r.tool_id,revision:r.resulting_revision,state:r.action==='install'?'active':'suspended',metadata_revision:r.metadata_revision,metadata_version:r.metadata_version,adapter_id:r.adapter_id,artifact_sha256:r.artifact_sha256,success_contract_sha256:r.success_contract_sha256,product_version:r.product_version,previous_installation_id:r.previous_installation_id,created_at:r.created_at});
 let prior=await reload();if(prior){if(prior.request_hash!==rh)throw conflict();return view(prior);}
 const head=await readCreatorInstallation({db,toolId:d.toolId});
 if((head?.installation_revision??0)!==d.expectedRevision||(d.action==='suspend'&&head?.state!=='active'))throw conflict();
 const b=d.action==='install'?d:{metadataRevision:head.metadata_revision,metadataVersion:head.metadata_version,adapterId:head.adapter_id,artifactSha256:head.artifact_sha256,successContractSha256:head.success_contract_sha256,productVersion:head.product_version};
 try{await db.prepare('INSERT INTO platform_creator_installation_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(crypto.randomUUID(),d.toolId,d.reviewer,kh,rh,d.expectedRevision,d.expectedRevision+1,d.action,b.metadataRevision,b.metadataVersion,b.adapterId,b.artifactSha256,b.successContractSha256,b.productVersion,head?.installation_id??null,now().toISOString()).run();}
 catch(e){prior=await reload();if(prior){if(prior.request_hash!==rh)throw conflict();return view(prior);}if(/creator_installation_conflict|UNIQUE constraint|FOREIGN KEY constraint/.test(String(e)))throw conflict();throw e;}
 prior=await reload();if(!prior||prior.request_hash!==rh)throw conflict();return view(prior);
}
export async function resolveCreatorInstallation({db,product,handler}){
 if(!text.safeParse(handler?.creatorAdapterId).success||!digest.safeParse(handler?.creatorArtifactSha256).success||!digest.safeParse(handler?.creatorContractSha256).success)throw unavailable();
 const row=await readCreatorInstallation({db,toolId:product.id});
 let pin;try{pin=await successContractPin(product);}catch{throw unavailable();}
 if(!row||row.state!=='active'||row.installed_adapter!==row.adapter_id||row.adapter_id!==handler.creatorAdapterId||row.artifact_sha256!==handler.creatorArtifactSha256||row.success_contract_sha256!==handler.creatorContractSha256||row.success_contract_sha256!==pin.sha256||row.product_version!==product.version)throw unavailable();
 return {tool_id:row.tool_id,creator_id:row.creator_id,share_bps:row.share_bps,installation_id:row.installation_id,installation_revision:row.installation_revision};
}
export function requiresCreatorBinding(product,handler){
 const provider=product?.provider;
 return String(product?.id??'').startsWith('creator-')||(provider!=null&&(typeof provider!=='object'||Array.isArray(provider)||provider.id!=='agenttoolbox'||provider.type!=='first_party'))||'creatorAdapterId' in Object(handler);
}
