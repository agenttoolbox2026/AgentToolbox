const events = new Set(['catalog_view','product_view','invoke_attempt','retired_rejected','execution_success','execution_failure','outcome_success','outcome_failure','outcome_unverifiable','payment_required','payment_verified','payment_settled','payment_failed']);
export const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value instanceof Uint8Array?value:new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
export function telemetry(db, { channel='http', sampleKind='unclassified', now=()=>new Date(), enabled=true } = {}) {
  return { async record(event, product={id:'_catalog',version:'1'}, duration=0) {
    if (!events.has(event)) throw new Error('Unknown telemetry event');
    if (!enabled) return;
    if (!db) throw new Error('Telemetry storage unavailable');
    await db.prepare(`INSERT INTO platform_daily(day,product_id,version,channel,event,sample_kind,count,duration_ms)
      VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(day,product_id,version,channel,event,sample_kind)
      DO UPDATE SET count=count+1,duration_ms=duration_ms+excluded.duration_ms`)
      .bind(now().toISOString().slice(0,10),product.id,product.version,channel,event,sampleKind,Math.max(0,Math.round(duration))).run();
  }};
}
