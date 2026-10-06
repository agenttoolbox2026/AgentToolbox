export async function publicPurchases(db){
 const row=await db.prepare("SELECT value FROM platform_public_totals WHERE key=?").bind('paid_purchases').first();
 if(!row||!Number.isSafeInteger(row.value)||row.value<0)throw new Error('counter_unavailable');
 return {lifetime_paid_purchases:row.value,includes_repeat_purchases:true,unique_agents:false,updated_at:new Date().toISOString()};
}
export async function expirePaidResults(db,now=new Date()){
 // Retain financial tombstones/receipts; remove only bounded public-document output.
 return db.prepare('UPDATE platform_payments SET result_json=NULL WHERE result_expires_at<? AND result_json IS NOT NULL').bind(now.toISOString()).run();
}
