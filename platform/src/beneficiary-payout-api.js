import {z} from 'zod';
import {PlatformError} from './service.js';
import {creatorCapabilitySchema} from './submissions.js';
import {referralCapabilitySchema,referralCodeSchema,referralRegistrationSchema,registerReferral,getReferral,referralTerms} from './referrals.js';
import {creatorToolIdSchema} from './tool-updates.js';
import {claimWallet,getWallet,challengeWallet,verifyWallet,walletClaimSchema,walletChallengeSchema,walletVerifySchema,walletHistorySchema} from './referral-wallets.js';
import {getReferralEarnings} from './referral-payouts.js';
import {payoutRequestSchema,payoutRequestHistorySchema,requestPayout,listPayoutRequests,getPayoutRequest} from './payout-requests.js';
const referralWalletPath='/v1/referrals/me/payout-wallet',referralRequestPath='/v1/referrals/me/payout-requests';
export function attachBeneficiaryPayoutApi(api,{db,origin,writeAllowed,client}){
 const write=fn=>async(...args)=>{if(!await writeAllowed())throw new PlatformError(429,'rate_limited','Wait before another payout request.');return fn(...args);};
 api.getReferralTerms=()=>referralTerms();
 api.registerReferral=write((body,capability)=>registerReferral({db,body,capability,client}));
 api.getReferralAccount=capability=>getReferral({db,capability});
 api.claimReferralWallet=write((body,capability)=>claimWallet({db,body,capability,origin}));
 api.challengeReferralWallet=write((body,capability)=>challengeWallet({db,body,capability,origin}));
 api.verifyReferralWallet=write((body,capability)=>verifyWallet({db,body,capability,origin}));
 api.getReferralWallet=(capability,params)=>getWallet({db,capability,params});
 api.getReferralEarnings=capability=>getReferralEarnings({db,capability});
 api.requestCreatorPayout=write((tool,body,capability)=>requestPayout({db,kind:'creator',tool,body,capability}));
 api.listCreatorPayoutRequests=(tool,capability,params)=>listPayoutRequests({db,kind:'creator',tool,capability,params});
 api.getCreatorPayoutRequest=(tool,id,capability)=>getPayoutRequest({db,kind:'creator',tool,id,capability});
 api.requestReferralPayout=write((body,capability)=>requestPayout({db,kind:'referral',body,capability}));
 api.listReferralPayoutRequests=(capability,params)=>listPayoutRequests({db,kind:'referral',capability,params});
 api.getReferralPayoutRequest=(id,capability)=>getPayoutRequest({db,kind:'referral',id,capability});
}
export async function beneficiaryPayoutRoute({request,url,api,jsonBody}){
 const path=url.pathname,method=request.method,referralCap=request.headers.get('X-Referral-Capability'),creatorCap=request.headers.get('X-Creator-Capability'),params=()=>Object.fromEntries(url.searchParams);
 const creator=path.match(/^\/v1\/creator-tools\/([a-z0-9-]{1,64})\/payout-requests(?:\/([0-9a-f-]{36}))?$/);
 const referral=path.match(/^\/v1\/referrals\/me\/payout-requests(?:\/([0-9a-f-]{36}))?$/);
 if(['GET','HEAD'].includes(method)){
  if(path===referralWalletPath)return Response.json(await api.getReferralWallet(referralCap,params()));
  if(path==='/v1/referrals/me/earnings')return Response.json(await api.getReferralEarnings(referralCap));
  if(creator)return Response.json(await (creator[2]?api.getCreatorPayoutRequest(creator[1],creator[2],creatorCap):api.listCreatorPayoutRequests(creator[1],creatorCap,params())));
  if(referral)return Response.json(await (referral[1]?api.getReferralPayoutRequest(referral[1],referralCap):api.listReferralPayoutRequests(referralCap,params())));
 }
 if(method==='POST'){
  const wallet=path===referralWalletPath?api.claimReferralWallet:path===referralWalletPath+'/challenge'?api.challengeReferralWallet:path===referralWalletPath+'/verify'?api.verifyReferralWallet:null;
  if(wallet)return Response.json(await wallet(await jsonBody(request),referralCap));
  if(creator&&!creator[2])return Response.json(await api.requestCreatorPayout(creator[1],await jsonBody(request),creatorCap));
  if(path===referralRequestPath)return Response.json(await api.requestReferralPayout(await jsonBody(request),referralCap));
 }
 return null;
}
export function registerBeneficiaryPayoutTools(register,api){
 const referral={referral_capability:referralCapabilitySchema},creator={creator_capability:creatorCapabilitySchema,tool_id:creatorToolIdSchema};
 register('get_referral_terms','Read referral terms, eligible first-party products and private registration instructions.',z.strictObject({}),()=>api.getReferralTerms(),true);
 register('register_referral','Register a referral account with your client-generated private atbf_ capability and acceptance of published terms. Registration initiates no payment.',z.strictObject({...referral,...referralRegistrationSchema.shape}),({referral_capability,...body})=>api.registerReferral(body,referral_capability),false);
 register('get_referral_account','Read your private registered referral account and frozen terms.',z.strictObject(referral),p=>api.getReferralAccount(p.referral_capability),true);
 register('get_referral_payout_wallet','Read your private Base payout destination, bounded history, EOA proof and separate owner approval.',z.strictObject({...referral,...walletHistorySchema.shape}),({referral_capability,...params})=>api.getReferralWallet(referral_capability,params),true);
 register('claim_referral_payout_wallet','Record a private Base destination with revision CAS. Address intake requires no signature. Active payouts hold wallet changes; this does not authorize a transfer.',z.strictObject({...referral,...walletClaimSchema.shape}),({referral_capability,...body})=>api.claimReferralWallet(body,referral_capability),false);
 register('create_referral_wallet_challenge','Create a five-minute single-use referral-bound EOA ownership challenge. No payment authorization; ERC-1271 unsupported.',z.strictObject({...referral,...walletChallengeSchema.shape}),({referral_capability,...body})=>api.challengeReferralWallet(body,referral_capability),false);
 register('verify_referral_wallet','Verify an exact EOA ownership challenge. Signatures are transient. Owner approval and transfer review remain separate.',z.strictObject({...referral,...walletVerifySchema.shape}),({referral_capability,...body})=>api.verifyReferralWallet(body,referral_capability),false);
 register('get_referral_earnings','Read exact first-party referral 100 bps gross earnings, fractional carry, confirmed payouts, held reservations and available amount. No transfer is initiated.',z.strictObject(referral),p=>api.getReferralEarnings(p.referral_capability),true);
 register('request_creator_payout','Request a fixed Base USDC amount for your tool and current wallet revision. Acceptance holds no funds and starts no transfer; owner review is required.',z.strictObject({...creator,...payoutRequestSchema.shape}),({creator_capability,tool_id,...body})=>api.requestCreatorPayout(tool_id,body,creator_capability),false);
 register('list_creator_payout_requests','Read private bounded payout request history for your tool.',z.strictObject({...creator,...payoutRequestHistorySchema.shape}),({creator_capability,tool_id,...params})=>api.listCreatorPayoutRequests(tool_id,creator_capability,params),true);
 register('get_creator_payout_request','Read one private creator payout request and its linked payout status.',z.strictObject({...creator,request_id:z.uuid()}),p=>api.getCreatorPayoutRequest(p.tool_id,p.request_id,p.creator_capability),true);
 register('request_referral_payout','Request a fixed Base USDC amount against your current referral wallet revision. Acceptance holds no funds and starts no transfer; owner review is required.',z.strictObject({...referral,...payoutRequestSchema.shape}),({referral_capability,...body})=>api.requestReferralPayout(body,referral_capability),false);
 register('list_referral_payout_requests','Read private bounded referral payout request history.',z.strictObject({...referral,...payoutRequestHistorySchema.shape}),({referral_capability,...params})=>api.listReferralPayoutRequests(referral_capability,params),true);
 register('get_referral_payout_request','Read one private referral payout request and its linked payout status.',z.strictObject({...referral,request_id:z.uuid()}),p=>api.getReferralPayoutRequest(p.request_id,p.referral_capability),true);
}
const atomic=z.string().regex(/^(0|[1-9][0-9]*)$/),date=z.string().datetime();
const walletView=z.strictObject({claim_id:z.uuid(),revision:z.number().int().positive(),network:z.literal('eip155:8453'),address:z.string(),created_at:date,ownership_status:z.enum(['unverified','eoa_signature_verified']),ownership_proof:z.strictObject({verified_at:date,method:z.literal('eoa_erc191'),erc1271_supported:z.literal(false)}).nullable(),owner_approval:z.union([z.strictObject({status:z.literal('pending')}),z.strictObject({status:z.literal('approved'),approved_at:date})]),payment_effect:z.literal('none')});
const history=z.strictObject({api_version:z.literal('1'),wallet:walletView.nullable(),history:z.array(walletView).max(20),next_cursor:z.string().nullable()});
const challenge=z.strictObject({challenge_id:z.uuid(),claim_revision:z.number().int().positive(),address:z.string(),message:z.string(),expires_at:date,method:z.literal('eoa_erc191'),erc1271_supported:z.literal(false),payment_effect:z.literal('none')});
const referralEarnings=z.strictObject({api_version:z.literal('1'),referral_code:referralCodeSchema,network:z.literal('eip155:8453'),asset:z.string(),terms_version:z.string(),share_bps:z.literal(100),revenue_basis:z.literal('gross'),gross_atomic:atomic,accrued_atomic:atomic,fractional_atom_numerator:atomic,fractional_atom_denominator:z.literal('10000'),confirmed_paid_atomic:atomic,reserved_atomic:atomic,available_atomic:atomic,receipt_count:z.number().int().nonnegative(),payout_count:z.number().int().nonnegative(),receipt_basis:z.literal('facilitator_confirmed_not_independently_reconciled'),payout_basis:z.literal('finalized_canonical_base_usdc_transfer'),fees:z.literal('platform funds gas separately; no referral deductions'),transfers_enabled:z.literal(false),payment_effect:z.literal('none')});
const payoutState=z.enum(['reserved','awaiting_owner','submitted','unknown','paid','cancelled']);
const quantity=z.string().regex(/^0x(?:0|[1-9a-f][0-9a-f]*)$/).max(66);
const receipt=z.strictObject({transaction_hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/),block_hash:z.string().regex(/^0x[0-9a-fA-F]{64}$/),block_number:quantity,log_index:quantity,checked_at:date,basis:z.literal('finalized_canonical_base_usdc_transfer')});
const linkedPayout=z.strictObject({payout_id:z.uuid(),batch_id:z.uuid(),state:payoutState,revision:z.number().int().nonnegative(),amount_atomic:atomic,created_at:date,receipt:receipt.nullable()});
const requestView=z.strictObject({api_version:z.literal('1'),request_id:z.uuid(),beneficiary_kind:z.enum(['creator','referral']),subject_id:z.string(),amount_atomic:atomic,network:z.literal('eip155:8453'),asset:z.string(),claim_id:z.uuid(),claim_revision:z.number().int().positive(),created_at:date,state:z.union([z.literal('requested'),payoutState]),payout:linkedPayout.nullable(),payment_effect:z.literal('none')});
const requestHistory=z.strictObject({api_version:z.literal('1'),requests:z.array(requestView).max(20),next_cursor:z.string().nullable(),payment_effect:z.literal('none')});
export function addBeneficiaryPayoutOpenApi(document,creatorHeader,referralHeader){
 const schema=z.toJSONSchema,reply=(description,shape)=>({description,content:{'application/json':{schema:schema(shape)}}});
 const errors=Object.fromEntries([400,403,404,409,413,415,429,503].map(status=>[status,{description:'Private bounded request rejected; no transfer performed.'}]));
 const query=input=>Object.entries(schema(input).properties).map(([name,schema])=>({name,in:'query',schema}));
 const post=(operationId,input,output,parameters)=>({operationId,description:'Private beneficiary capability required. Acceptance initiates no transfer; ownership proof, owner approval and external signature remain separate.',parameters,requestBody:{required:true,content:{'application/json':{schema:schema(input)}}},responses:{200:reply('Private beneficiary result.',output),...errors}});
 document.paths[referralWalletPath]={get:{operationId:'getReferralPayoutWallet',parameters:[referralHeader,...query(walletHistorySchema)],responses:{200:reply('Private destination and paginated history.',history),...errors}},post:post('claimReferralPayoutWallet',walletClaimSchema,walletView,[referralHeader])};
 document.paths[referralWalletPath+'/challenge']={post:post('createReferralWalletChallenge',walletChallengeSchema,challenge,[referralHeader])};
 document.paths[referralWalletPath+'/verify']={post:post('verifyReferralWallet',walletVerifySchema,walletView,[referralHeader])};
 document.paths['/v1/referrals/me/earnings']={get:{operationId:'getReferralEarnings',description:'Exact first-party 100 bps gross referral earnings. Complete bounded accounting fails closed on overflow. Platform funds gas separately.',parameters:[referralHeader],responses:{200:reply('Accrual, fractional carry, confirmed payouts, reservations and availability.',referralEarnings),...errors}}};
 for(const [kind,path,header,pathParams] of [['Creator','/v1/creator-tools/{tool_id}/payout-requests',creatorHeader,[{name:'tool_id',in:'path',required:true,schema:schema(creatorToolIdSchema)}]],['Referral',referralRequestPath,referralHeader,[]]]){
  const parameters=[header,...pathParams];
  document.paths[path]={get:{operationId:'list'+kind+'PayoutRequests',parameters:[...parameters,...query(payoutRequestHistorySchema)],responses:{200:reply('Private bounded payout request history.',requestHistory),...errors}},post:post('request'+kind+'Payout',payoutRequestSchema,requestView,parameters)};
  document.paths[path+'/{request_id}']={get:{operationId:'get'+kind+'PayoutRequest',parameters:[...parameters,{name:'request_id',in:'path',required:true,schema:schema(z.uuid())}],responses:{200:reply('Private request with its permanent payout link, when reserved.',requestView),...errors}}};
 }
}
