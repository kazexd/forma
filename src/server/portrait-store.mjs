import {stripeConfiguration} from './stripe-config.mjs';
import {createClient} from '@supabase/supabase-js';
const bucket='forma-portraits';
function assert(result){if(result.error){const error=new Error('Private portrait storage is unavailable.');if(typeof result.error.code==='string'&&/^[A-Z0-9_]{1,32}$/.test(result.error.code))error.code=result.error.code;throw error;}return result.data;}
export function createPortraitStore({url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,client,billing=stripeConfiguration()}={}){
 if(!client&&(!url||!key))return null;
 const db=client??createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return {
  async welcomePending(owner){const row=assert(await db.from('forma_account_welcome').select('acknowledged_at').eq('owner_id',owner).maybeSingle());return !!row&&row.acknowledged_at===null;},
  async acknowledgeWelcome(owner){assert(await db.from('forma_account_welcome').update({acknowledged_at:new Date().toISOString()}).eq('owner_id',owner).is('acknowledged_at',null));},
  async billingMode(){const row=assert(await db.from('forma_billing_control').select('mode').eq('id',true).single());return row.mode;},
  async ready(){const data=assert(await db.storage.getBucket(bucket));if(data.public)throw new Error('Portrait storage must be private.');assert(await db.from('forma_portraits').select('id').limit(0));},
  async allowance(owner){return assert(await db.rpc('forma_get_generation_allowance',{p_owner:owner}));},
  async credits(owner){return assert(await db.rpc('forma_get_credits',{p_owner:owner}));},
  async creditOrder(owner,id){return assert(await db.from('forma_credit_orders').select('*').eq('id',id).eq('owner_id',owner).maybeSingle());},
  async reserveCreditOrder(owner,price,origin,plan='plus'){const rows=assert(await db.rpc('forma_reserve_credit_package',{p_owner:owner,p_id:crypto.randomUUID(),p_price:price.id,p_plan:plan,p_origin:origin,p_expiry:Math.floor(Date.now()/1000)+3600,p_live:billing.live}));return rows?.[0]??null;},
  async attachCreditSession(order,id){assert(await db.from('forma_credit_orders').update({checkout_session_id:id}).eq('id',order.id).eq('owner_id',order.owner_id).eq('state','pending'));},
  async expireCreditOrder(order){assert(await db.from('forma_credit_orders').update({state:'expired'}).eq('id',order.id).eq('owner_id',order.owner_id).eq('state','pending').eq('checkout_session_id',order.checkout_session_id));},
  async completeCreditOrder(order,session,receipt){return assert(await db.rpc('forma_complete_credit_order_discounted',{p_owner:order.owner_id,p_id:order.id,p_session:session.id,p_live:session.livemode,p_receipt:receipt}));},
  async unlockPortrait(row){return assert(await db.rpc('forma_unlock_portrait_mode',{p_owner:row.owner_id,p_id:row.id,p_key:row.checkout_key,p_session:row.checkout_session_id,p_live:billing.live}));},
  async generationRateAllowed(owner){return assert(await db.rpc('forma_generation_rate_allowed',{p_owner:owner}));},
  async generationRequest(owner,id){return assert(await db.from('forma_generation_requests').select('id,status,portrait_id,style,fingerprint,lease_until,restored_at').eq('id',id).eq('owner_id',owner).maybeSingle());},
  async beginGeneration(owner,id,style,fingerprint,tokenHash){return assert(await db.rpc('forma_begin_generation_mode',{p_owner:owner,p_id:id,p_style:style,p_fingerprint:fingerprint,p_token_hash:tokenHash,p_live:billing.live}));},
  async finishGeneration(owner,id,uncertain){return assert(await db.rpc('forma_finish_generation_restoring',{p_owner:owner,p_id:id,p_uncertain:uncertain}));},
  async save(record,original,preview,requestId){
   const paths=[];let publishing=false,publishRejected=false;
   try{
    for(const [path,buffer] of [[record.original_path,original],[record.preview_path,preview]]){assert(await db.storage.from(bucket).upload(path,buffer,{contentType:'image/jpeg',upsert:false}));paths.push(path);}
    if(!requestId)throw new Error('A reserved generation request is required.');
    publishing=true;
    const result=await db.rpc('forma_publish_generation',{p_owner:record.owner_id,p_id:requestId,p_original:record.original_path,p_preview:record.preview_path});
    // A concrete PostgreSQL error proves the publication transaction aborted.
    publishRejected=!!result.error&&/^[0-9A-Z]{5}$/.test(result.error.code??'');
    assert(result);
   }catch(error){
    // A lost RPC response may follow a committed transaction. Never delete its images.
    let existing;try{existing=await db.from('forma_portraits').select('id').eq('id',record.id).maybeSingle();}catch{existing={error:true};}
    if(!existing.error&&existing.data)return;
    const uncertain=publishing&&!publishRejected;
    // Preserve objects when publication may still commit after a lost response.
    if(!uncertain&&paths.length){try{await db.storage.from(bucket).remove(paths);}catch{/* Orphans remain private and count toward storage capacity. */}}
    const failure=new Error('Could not save the portrait.');failure.generationUncertain=uncertain;throw failure;
   }
  },
  async get(id){return assert(await db.from('forma_portraits').select('*').eq('id',id).maybeSingle());},
  async read(path){const blob=assert(await db.storage.from(bucket).download(path));return Buffer.from(await blob.arrayBuffer());},
  async reserveCheckout(row,price,origin){const data=assert(await db.rpc('forma_reserve_checkout_mode',{p_id:row.id,p_owner:row.owner_id,p_key:crypto.randomUUID(),p_price:price.id,p_amount:price.unit_amount,p_currency:price.currency,p_origin:origin,p_expiry:Math.floor(Date.now()/1000)+3600,p_live:billing.live}));return data?.[0]??null;},
  async attachSession(row,id){assert(await db.from('forma_portraits').update({checkout_session_id:id}).eq('id',row.id).eq('checkout_key',row.checkout_key));},
  async clearCheckout(row){assert(await db.from('forma_portraits').update({checkout_key:null,checkout_session_id:null}).eq('id',row.id).eq('checkout_key',row.checkout_key).eq('payment_state','unpaid'));},
  async markPaid(row,session,receipt){return assert(await db.rpc('forma_complete_purchase_discounted',{p_id:row.id,p_owner:row.owner_id,p_key:row.checkout_key,p_session:session.id,p_live:session.livemode,p_receipt:receipt}));},
  async list(owner,status,cursor){
   let query=db.from('forma_portraits').select('id,style,created_at,payment_state').eq('owner_id',owner).in('payment_state',status==='all'?['paid','unpaid']:[status==='purchased'?'paid':'unpaid']).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(13);
   if(cursor)query=query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
   return assert(await query);
  },
  async pendingDeletion(){return assert(await db.from('forma_portraits').select('*').eq('payment_state','deleting').limit(100));},
  async claimDelete(row){return assert(await db.rpc('forma_claim_portrait_delete',{p_id:row.id,p_owner:row.owner_id,p_state:row.payment_state,p_key:row.checkout_key,p_session:row.checkout_session_id}));},
  async remove(row){assert(await db.storage.from(bucket).remove([row.original_path,row.preview_path]));assert(await db.from('forma_portraits').delete().eq('id',row.id).eq('payment_state','deleting'));}
 };
}
