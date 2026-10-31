import {createClient} from '@supabase/supabase-js';
const bucket='forma-portraits';
function assert(result){if(result.error)throw new Error('Private portrait storage is unavailable.');return result.data;}
export function createPortraitStore({url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,client}={}){
 if(!client&&(!url||!key))return null;
 const db=client??createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return {
  async ready(){const data=assert(await db.storage.getBucket(bucket));if(data.public)throw new Error('Portrait storage must be private.');assert(await db.from('forma_portraits').select('id').limit(0));},
  async allowance(owner){return assert(await db.rpc('forma_get_generation_allowance',{p_owner:owner}));},
  async reserveAttempt(owner){return assert(await db.rpc('forma_consume_generation',{p_owner:owner}));},
  async save(record,original,preview){
   const paths=[];
   try{
    for(const [path,buffer] of [[record.original_path,original],[record.preview_path,preview]]){assert(await db.storage.from(bucket).upload(path,buffer,{contentType:'image/jpeg',upsert:false}));paths.push(path);}
    assert(await db.from('forma_portraits').insert(record));
   }catch(error){if(paths.length)await db.storage.from(bucket).remove(paths);throw error;}
  },
  async get(id){return assert(await db.from('forma_portraits').select('*').eq('id',id).maybeSingle());},
  async read(path){const blob=assert(await db.storage.from(bucket).download(path));return Buffer.from(await blob.arrayBuffer());},
  async reserveCheckout(row,price,origin){const data=assert(await db.rpc('forma_reserve_checkout',{p_id:row.id,p_owner:row.owner_id,p_key:crypto.randomUUID(),p_price:price.id,p_amount:price.unit_amount,p_currency:price.currency,p_origin:origin,p_expiry:Math.floor(Date.now()/1000)+3600}));return data?.[0]??null;},
  async attachSession(row,id){assert(await db.from('forma_portraits').update({checkout_session_id:id}).eq('id',row.id).eq('checkout_key',row.checkout_key));},
  async clearCheckout(row){assert(await db.from('forma_portraits').update({checkout_key:null,checkout_session_id:null}).eq('id',row.id).eq('checkout_key',row.checkout_key).eq('payment_state','unpaid'));},
  async markPaid(row,session){return assert(await db.rpc('forma_complete_purchase',{p_id:row.id,p_owner:row.owner_id,p_key:row.checkout_key,p_session:session.id,p_amount:session.amount_total,p_currency:session.currency}));},
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
