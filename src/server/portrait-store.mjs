import {createClient} from '@supabase/supabase-js';
const bucket='forma-portraits';
function assert(result){if(result.error)throw new Error('Private portrait storage is unavailable.');return result.data;}
export function createPortraitStore({url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY,client}={}){
 if(!client&&(!url||!key))return null;
 const db=client??createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return {
  async ready(){const data=assert(await db.storage.getBucket(bucket));if(data.public)throw new Error('Portrait storage must be private.');assert(await db.from('forma_portraits').select('id').limit(0));},
  async reserveAttempt(owner,limit){return assert(await db.rpc('forma_reserve_generation',{p_owner:owner,p_limit:limit}));},
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
  async markPaid(row,session){const data=assert(await db.from('forma_portraits').update({payment_state:'paid',paid_at:new Date().toISOString(),checkout_session_id:session.id}).eq('id',row.id).eq('checkout_key',row.checkout_key).eq('payment_state','unpaid').select('id'));return data.length>0;},
  async expired(){return assert(await db.from('forma_portraits').select('*').in('payment_state',['unpaid','deleting']).lt('expires_at',new Date().toISOString()).limit(100));},
  async claimDelete(row){const data=assert(await db.from('forma_portraits').update({payment_state:'deleting'}).eq('id',row.id).eq('payment_state','unpaid').select('id'));return row.payment_state==='deleting'||data.length>0;},
  async remove(row){assert(await db.storage.from(bucket).remove([row.original_path,row.preview_path]));assert(await db.from('forma_portraits').delete().eq('id',row.id).eq('payment_state','deleting'));}
 };
}
