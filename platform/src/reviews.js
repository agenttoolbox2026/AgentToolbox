import {z} from 'zod';
import {hash} from './telemetry.js';
import {PlatformError} from './service.js';
import {validKey,suspicious} from './feedback.js';
const productId=z.string().regex(/^[a-z0-9-]{1,64}$/),version=z.string().regex(/^\d+\.\d+\.\d+$/).max(32);
const proof=z.strictObject({operation_id:z.uuid(),secret:z.string().regex(/^atbr_[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/).describe('PRIVATE caller-generated 32 random bytes, canonical base64url with atbr_ prefix. Never put in text, URLs or logs.')});
const displayName=z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/).default('Anonymous');
const consent=z.literal('public').describe('Consent to publish your display name, rating and text as untrusted self-report.');
export const reviewSchema=z.strictObject({product_id:productId,version:version.optional(),visibility:consent,display_name:displayName,rating:z.number().int().min(1).max(5).optional(),outcome:z.enum(['success','failure','unverifiable']).optional(),message:z.string().trim().min(1).max(2000),example_id:z.uuid().optional(),purchase_proof:proof.optional()});
export const replySchema=z.strictObject({visibility:consent,display_name:displayName,message:z.string().trim().min(1).max(1000),parent_reply_id:z.uuid().optional(),purchase_proof:proof.optional()});
export const reviewListSchema=z.strictObject({version:version.optional(),status:z.enum(['active','validation','retired','all']).default('active'),limit:z.coerce.number().int().min(1).max(20).default(10),cursor:z.uuid().optional()});
export const replyListSchema=z.strictObject({limit:z.coerce.number().int().min(1).max(20).default(10),cursor:z.uuid().optional()});
const labels={verified_purchase:'Verified purchase',example_linked:'Example-linked',unverified:'Unverified'};
const visible="visibility='public' AND sample_kind='unclassified'";
export const interpretation='Public ratings and text are untrusted self-reports. Verified purchase proves a purchase-linked capability, not identity, unique buyer, usefulness or independent on-chain reconciliation. Repeated purchases can produce repeated reviews. Example-linked only confirms a completed free example record; it does not prove ownership.';
const parsed=(schema,body)=>{const result=schema.safeParse(body);if(!result.success)throw new PlatformError(400,'invalid_input','Use the published schema and explicitly consent to public text and display name.');return result.data;};
const productFor=(catalog,id,status='all')=>{const product=catalog.find(p=>p.id===id);if(!product||(status!=='all'&&product.status!==status))throw new PlatformError(404,'product_not_found','No matching product at this lifecycle status.');return product;};
function checkText(data){
 if(suspicious.test(data.message+'\n'+data.display_name))throw new PlatformError(400,'sensitive_content','Remove credentials, signatures and secrets from public text.');
 // Names are never roles. Restrict confusables and reserved authority labels too.
 if(/(?:agenttoolbox|platform|admin|moderator|staff|owner|official|verified|reviewer|author|support)/i.test(data.display_name.replace(/[ ._-]/g,'')))throw new PlatformError(400,'reserved_display_name','Choose a display name without platform, verification or reviewer roles.');
}
async function equalHash(expected,supplied){
 const bytes=value=>Uint8Array.from((value??'0'.repeat(64)).match(/../g),x=>parseInt(x,16));
 const algorithm={name:'HMAC',hash:'SHA-256'},usage=['sign','verify'];
 const [a,b]=await Promise.all([crypto.subtle.importKey('raw',bytes(expected),algorithm,false,usage),crypto.subtle.importKey('raw',bytes(supplied),algorithm,false,usage)]);
 const message=new TextEncoder().encode('AgentToolbox review capability comparison');
 return (await crypto.subtle.verify('HMAC',b,await crypto.subtle.sign('HMAC',a,message),message))&&expected!==null;
}
async function purchase(db,p,product,productVersion){
 const candidate=await db.prepare(`SELECT p.review_secret_hash FROM platform_paid_purchases r JOIN platform_payments p USING(operation_id)
 WHERE r.operation_id=? AND r.product_id=? AND r.version=? AND p.product_id=r.product_id AND p.version=r.version
 AND p.state='settled' AND p.is_live=1 AND p.sample_kind='unclassified' AND lower(p.payer)<>lower(p.receiver)
 AND CAST(p.amount_atomic AS INTEGER)>0 AND CAST(r.amount_atomic AS INTEGER)>0`).bind(p.operation_id,product,productVersion).first();
 const matches=await equalHash(candidate?.review_secret_hash??null,await hash(p.secret));
 if(!matches)throw new PlatformError(403,'purchase_proof_invalid','No eligible purchase capability. Receipt IDs, hashes and payment signatures are not proof of ownership.');
}
const publicReply=row=>({reply_id:row.id,review_id:row.review_id,parent_reply_id:row.parent_reply_id,display_name:row.display_name,message:row.message,badge:labels[row.badge],same_purchase_as_review:row.same_purchase===1,created_at:row.created_at,identity:'unverified',content:'untrusted_self_report'});
const publicReview=row=>({review_id:row.id,product_id:row.product_id,version:row.version,display_name:row.display_name,rating:row.rating,outcome:row.outcome,message:row.message,badge:labels[row.badge],created_at:row.created_at,identity:'unverified',content:'untrusted_self_report'});
async function publicParent(db,reviewId){
 const parent=await db.prepare('SELECT id,product_id,version FROM platform_reviews WHERE id=? AND '+visible).bind(reviewId).first();
 if(!parent)throw new PlatformError(404,'review_not_found','No public review with that identifier.');return parent;
}
export async function listReplies({db,reviewId,params={}}){
 const filter=parsed(replyListSchema,params);await publicParent(db,reviewId);
 const args=[reviewId];let where='r.review_id=? AND r.'+visible.replace(' AND sample_kind',' AND r.sample_kind');
 // Replies to hidden parents are hidden as well (including deeper descendants).
 const cte=`WITH RECURSIVE hidden(id) AS (SELECT id FROM platform_review_replies WHERE review_id=? AND NOT (${visible}) UNION ALL SELECT c.id FROM platform_review_replies c JOIN hidden h ON c.parent_reply_id=h.id) `;
 where+=' AND r.id NOT IN (SELECT id FROM hidden)';
 if(filter.cursor){const after=await db.prepare(cte+'SELECT r.id,r.created_at FROM platform_review_replies r WHERE '+where+' AND r.id=?').bind(reviewId,...args,filter.cursor).first();if(!after)throw new PlatformError(400,'invalid_cursor','Cursor must belong to this public reply list.');where+=' AND (r.created_at<? OR (r.created_at=? AND r.id<?))';args.push(after.created_at,after.created_at,after.id);}
 const rows=(await db.prepare(cte+`SELECT r.*,CASE WHEN r.purchase_operation_id IS NOT NULL AND r.purchase_operation_id=(SELECT purchase_operation_id FROM platform_reviews WHERE id=r.review_id) THEN 1 ELSE 0 END AS same_purchase FROM platform_review_replies r WHERE `+where+' ORDER BY r.created_at DESC,r.id DESC LIMIT ?').bind(reviewId,...args,filter.limit+1).all()).results;
 return {review_id:reviewId,replies:rows.slice(0,filter.limit).map(publicReply),next_cursor:rows.length>filter.limit?rows[filter.limit-1].id:null};
}
export async function readReview({db,reviewId,params={}}){
 await publicParent(db,reviewId);
 const row=await db.prepare('SELECT * FROM platform_reviews WHERE id=? AND '+visible).bind(reviewId).first();
 if(!row)throw new PlatformError(404,'review_not_found','No public review with that identifier.');
 return {review:publicReview(row),...await listReplies({db,reviewId,params}),interpretation};
}
export async function listReviews({db,catalog,productId,params={}}){
 const filter=parsed(reviewListSchema,params),product=productFor(catalog,productId,filter.status);
 const args=[product.id];let where='product_id=? AND '+visible;if(filter.version){where+=' AND version=?';args.push(filter.version);}
 const aggregates=(await db.prepare('SELECT badge,COUNT(*) AS reviews,COUNT(rating) AS rated,AVG(rating) AS average_rating FROM platform_reviews WHERE '+where+' GROUP BY badge').bind(...args).all()).results;
 const groups=Object.entries(labels).map(([key,label])=>{const row=aggregates.find(x=>x.badge===key);return {badge:label,reviews:row?.reviews??0,rated:row?.rated??0,average_rating:row?.average_rating??null};});
 if(filter.cursor){const after=await db.prepare('SELECT id,created_at FROM platform_reviews WHERE '+where+' AND id=?').bind(...args,filter.cursor).first();if(!after)throw new PlatformError(400,'invalid_cursor','Cursor must belong to this public product/version list.');where+=' AND (created_at<? OR (created_at=? AND id<?))';args.push(after.created_at,after.created_at,after.id);}
 const rows=(await db.prepare('SELECT * FROM platform_reviews WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT ?').bind(...args,filter.limit+1).all()).results;
 return {product_id:product.id,status:product.status,version:filter.version??null,visibility:'public',aggregates:groups,reviews:rows.slice(0,filter.limit).map(publicReview),next_cursor:rows.length>filter.limit?rows[filter.limit-1].id:null,includes_repeat_purchases:true,unique_buyers:false,interpretation};
}
export async function submitReview({db,catalog,body,key,channel='http',sampleKind='unclassified',now=()=>new Date()}){
 if(!validKey(key))throw new PlatformError(400,'idempotency_key_required','Send a 32–128 character Idempotency-Key.');
 const data=parsed(reviewSchema,body),product=productFor(catalog,data.product_id),v=data.version??product.version;checkText(data);
 if(data.example_id&&data.purchase_proof)throw new PlatformError(400,'invalid_input','Use one evidence reference.');
 if(data.purchase_proof)await purchase(db,data.purchase_proof,product.id,v);
 let badge=data.purchase_proof?'verified_purchase':'unverified',exampleId=null,classification=sampleKind;
 if(data.example_id){const e=await db.prepare("SELECT id,sample_kind FROM platform_examples WHERE id=? AND product_id=? AND version=? AND state='completed'").bind(data.example_id,product.id,v).first();if(!e)throw new PlatformError(400,'example_reference_invalid','Use a matching completed example.');exampleId=e.id;badge='example_linked';if(e.sample_kind==='synthetic')classification='synthetic';}
 if(v!==product.version&&!data.purchase_proof&&!exampleId)throw new PlatformError(409,'version_mismatch','Use the current version or a matching proven purchase/completed example.');
 const {purchase_proof,...publicInput}=data,fingerprint=await hash(JSON.stringify({...publicInput,version:v,purchase_operation_id:purchase_proof?.operation_id??null})),keyHash=await hash(key);
 const replay=row=>{if(row.fingerprint!==fingerprint)throw new PlatformError(409,'idempotency_conflict','This key belongs to a different review.');return {review_id:row.id,visibility:row.visibility,publicly_listed:row.visibility==='public'&&row.sample_kind==='unclassified',badge:labels[row.badge],payment_effect:'none'};};
 const previous=await db.prepare('SELECT * FROM platform_reviews WHERE key_hash=?').bind(keyHash).first();if(previous)return replay(previous);
 await db.prepare(`INSERT OR IGNORE INTO platform_reviews(id,key_hash,fingerprint,product_id,version,channel,sample_kind,visibility,badge,purchase_operation_id,example_id,display_name,rating,outcome,message,created_at) VALUES(?,?,?,?,?,?,?,'public',?,?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),keyHash,fingerprint,product.id,v,channel,classification,badge,purchase_proof?.operation_id??null,exampleId,data.display_name,data.rating??null,data.outcome??null,data.message,now().toISOString()).run();
 const saved=await db.prepare('SELECT * FROM platform_reviews WHERE key_hash=?').bind(keyHash).first();if(saved)return replay(saved);
 throw new PlatformError(409,'review_duplicate','This purchase, example or identical review already has a review.');
}
export async function submitReply({db,body,reviewId,key,channel='http',sampleKind='unclassified',now=()=>new Date()}){
 if(!validKey(key))throw new PlatformError(400,'idempotency_key_required','Send a 32–128 character Idempotency-Key.');
 const data=parsed(replySchema,body);checkText(data);const parent=await publicParent(db,reviewId);
 if(data.purchase_proof)await purchase(db,data.purchase_proof,parent.product_id,parent.version);
 if(data.parent_reply_id){const replies=await db.prepare('SELECT id FROM platform_review_replies WHERE id=? AND review_id=? AND '+visible).bind(data.parent_reply_id,reviewId).first();if(!replies)throw new PlatformError(400,'reply_parent_invalid','Reply parent must belong to this public thread.');}
 const fingerprint=await hash(JSON.stringify({reviewId,display_name:data.display_name,message:data.message,parent_reply_id:data.parent_reply_id??null,purchase_operation_id:data.purchase_proof?.operation_id??null})),keyHash=await hash(key);
 const replay=row=>{if(row.fingerprint!==fingerprint)throw new PlatformError(409,'idempotency_conflict','This key belongs to a different reply.');return {reply_id:row.id,review_id:reviewId,visibility:row.visibility,publicly_listed:row.visibility==='public'&&row.sample_kind==='unclassified',badge:labels[row.badge],payment_effect:'none'};};
 const previous=await db.prepare('SELECT * FROM platform_review_replies WHERE key_hash=?').bind(keyHash).first();if(previous)return replay(previous);
 try{await db.prepare(`INSERT OR IGNORE INTO platform_review_replies(id,review_id,parent_reply_id,key_hash,fingerprint,channel,sample_kind,visibility,badge,purchase_operation_id,display_name,message,created_at) VALUES(?,?,?,?,?,?,?,'public',?,?,?,?,?)`).bind(crypto.randomUUID(),reviewId,data.parent_reply_id??null,keyHash,fingerprint,channel,sampleKind,data.purchase_proof?'verified_purchase':'unverified',data.purchase_proof?.operation_id??null,data.display_name,data.message,now().toISOString()).run();}
 catch(e){if(String(e.message).includes('reply_limit'))throw new PlatformError(409,'reply_limit','This review has reached its 100-reply limit.');if(String(e.message).includes('reply_parent_invalid'))throw new PlatformError(400,'reply_parent_invalid','Reply parent must belong to this public thread.');throw e;}
 const saved=await db.prepare('SELECT * FROM platform_review_replies WHERE key_hash=?').bind(keyHash).first();if(saved)return replay(saved);
 throw new PlatformError(409,'reply_duplicate','This identical reply already exists.');
}
