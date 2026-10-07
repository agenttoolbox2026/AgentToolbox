import {z} from 'zod';
import {PlatformError} from './service.js';
import {creatorCapabilitySchema} from './submissions.js';
import {creatorToolIdSchema} from './tool-updates.js';
import {claimWallet,getWallet,challengeWallet,verifyWallet,walletClaimSchema,walletChallengeSchema,walletVerifySchema,walletHistorySchema} from './creator-wallets.js';
import {getCreatorEarnings} from './creator-payouts.js';

const walletPath='/v1/creators/me/payout-wallet';
export function attachCreatorPayoutApi(api,{db,origin,writeAllowed}){
 const write=fn=>async(body,capability)=>{if(!await writeAllowed())throw new PlatformError(429,'rate_limited','Wait before another wallet request.');return fn({db,body,capability,origin});};
 api.claimCreatorWallet=write(claimWallet);api.challengeCreatorWallet=write(challengeWallet);api.verifyCreatorWallet=write(verifyWallet);
 api.getCreatorWallet=(capability,params)=>getWallet({db,capability,params});
 api.getCreatorEarnings=(tool,capability)=>getCreatorEarnings({db,tool,capability});
}
export async function creatorPayoutRoute({request,url,api,jsonBody}){
 const path=url.pathname,method=request.method,capability=request.headers.get('X-Creator-Capability');
 if(['GET','HEAD'].includes(method)){
  if(path===walletPath)return Response.json(await api.getCreatorWallet(capability,Object.fromEntries(url.searchParams)));
  const earnings=path.match(/^\/v1\/creator-tools\/([a-z0-9-]{1,64})\/earnings$/);
  if(earnings)return Response.json(await api.getCreatorEarnings(earnings[1],capability));
 }
 if(method==='POST'){
  const fn=path===walletPath?api.claimCreatorWallet:path===walletPath+'/challenge'?api.challengeCreatorWallet:path===walletPath+'/verify'?api.verifyCreatorWallet:null;
  if(fn)return Response.json(await fn(await jsonBody(request),capability));
 }
 return null;
}
export function registerCreatorPayoutTools(register,api){
 const cap={creator_capability:creatorCapabilitySchema};
 register('get_creator_payout_wallet','Read your private payout destination/history, wallet proof state and separate owner approval. Capability control does not verify wallet ownership.',z.strictObject({...cap,...walletHistorySchema.shape}),({creator_capability,...params})=>api.getCreatorWallet(creator_capability,params),true);
 register('claim_creator_payout_wallet','Record a private Base payout destination with your existing creator capability. Unverified until optional EOA proof; no keys, seed phrases, payment, transfer or automatic approval. Wallet changes use expected_revision and are held during reserved payouts.',z.strictObject({...cap,...walletClaimSchema.shape}),({creator_capability,...body})=>api.claimCreatorWallet(body,creator_capability),false);
 register('create_creator_wallet_challenge','Request a five-minute, single-use, domain/chain/creator/address-bound ownership challenge. It is not payment authorization. EOA signatures only; ERC-1271 unsupported. Not required to submit a tool.',z.strictObject({...cap,...walletChallengeSchema.shape}),({creator_capability,...body})=>api.challengeCreatorWallet(body,creator_capability),false);
 register('verify_creator_wallet','Verify the exact EOA ownership challenge with your private creator capability. Raw proof signatures are not stored. Successful proof does not replace separate owner payout approval or authorize any transfer.',z.strictObject({...cap,...walletVerifySchema.shape}),({creator_capability,...body})=>api.verifyCreatorWallet(body,creator_capability),false);
 register('get_creator_earnings','Read complete bounded 90% gross accrual/carry, finalized confirmed payouts, reservations and available amount for your approved tool. Metadata approval alone earns nothing; installed execution is separately reviewed. No transfer is initiated.',z.strictObject({...cap,tool_id:creatorToolIdSchema}),p=>api.getCreatorEarnings(p.tool_id,p.creator_capability),true);
}
const atomic=z.string().regex(/^(0|[1-9][0-9]*)$/),date=z.string().datetime();
const walletView=z.strictObject({claim_id:z.uuid(),revision:z.number().int().positive(),network:z.literal('eip155:8453'),address:z.string(),created_at:date,ownership_status:z.enum(['unverified','eoa_signature_verified']),ownership_proof:z.strictObject({verified_at:date,method:z.literal('eoa_erc191'),erc1271_supported:z.literal(false)}).nullable(),owner_approval:z.union([z.strictObject({status:z.literal('pending')}),z.strictObject({status:z.literal('approved'),approved_at:date})]),payment_effect:z.literal('none')});
const history=z.strictObject({api_version:z.literal('1'),wallet:walletView.nullable(),history:z.array(walletView).max(20),next_cursor:z.string().nullable()});
const challenge=z.strictObject({challenge_id:z.uuid(),claim_revision:z.number().int().positive(),address:z.string(),message:z.string(),expires_at:date,method:z.literal('eoa_erc191'),erc1271_supported:z.literal(false),payment_effect:z.literal('none')});
const earnings=z.strictObject({api_version:z.literal('1'),tool_id:creatorToolIdSchema,network:z.literal('eip155:8453'),asset:z.string(),share_bps:z.literal(9000),revenue_basis:z.literal('gross'),gross_atomic:atomic,accrued_atomic:atomic,fractional_atom_numerator:atomic,fractional_atom_denominator:z.literal('10'),confirmed_paid_atomic:atomic,reserved_atomic:atomic,available_atomic:atomic,receipt_count:z.number().int().nonnegative(),payout_count:z.number().int().nonnegative(),execution_status:z.enum(['installed_adapter','metadata_only_not_earning']),receipt_basis:z.literal('facilitator_confirmed_not_independently_reconciled'),payout_basis:z.literal('finalized_canonical_base_usdc_transfer'),fees:z.literal('platform_share_only; no creator deductions'),transfers_enabled:z.literal(false),payment_effect:z.literal('none')});
export function addCreatorPayoutOpenApi(document,creatorHeader){
 const schema=z.toJSONSchema,reply=(description,shape)=>({description,content:{'application/json':{schema:schema(shape)}}});
 const errors=Object.fromEntries([400,403,409,413,429,503].map(status=>[status,{description:'Bounded request rejected; no transfer performed.'}]));
 const post=(operationId,input,output)=>({operationId,description:'Private creator capability required. No payment authorization or transfer. Separate ownership proof and owner approval; EOA only, ERC-1271 unsupported.',parameters:[creatorHeader],requestBody:{required:true,content:{'application/json':{schema:schema(input)}}},responses:{200:reply('Private creator wallet result.',output),...errors}});
 document.paths[walletPath]={get:{operationId:'getCreatorPayoutWallet',parameters:[creatorHeader,...Object.entries(schema(walletHistorySchema).properties).map(([name,schema])=>({name,in:'query',schema}))],responses:{200:reply('Current destination and private paginated history.',history),...errors}},post:post('claimCreatorPayoutWallet',walletClaimSchema,walletView)};
 document.paths[walletPath+'/challenge']={post:post('createCreatorWalletChallenge',walletChallengeSchema,challenge)};
 document.paths[walletPath+'/verify']={post:post('verifyCreatorWallet',walletVerifySchema,walletView)};
 document.paths['/v1/creator-tools/{tool_id}/earnings']={get:{operationId:'getCreatorEarnings',description:'Exact cumulative Base USDC amounts; fail closed when the complete 5000-row bound is exceeded. No creator-cost deductions or transfer initiation.',parameters:[creatorHeader,{name:'tool_id',in:'path',required:true,schema:schema(creatorToolIdSchema)}],responses:{200:reply('Private gross accrual, carry, confirmed payouts and held reservations.',earnings),...errors}}};
}
