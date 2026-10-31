import {portraitPrice} from '../portrait-price.mjs';
import Stripe from 'stripe';
import {createPortraitStore} from './portrait-store.mjs';
import {createVerifier,checkOrigin,validId,AccessError,response} from './access.mjs';

export function createCommerce({store=createPortraitStore(),verify=createVerifier(),stripeKey=process.env.STRIPE_SECRET_KEY,priceId=process.env.STRIPE_PRICE_ID,webhookSecret=process.env.STRIPE_WEBHOOK_SECRET,stripeClient}={}){
 // This implementation deliberately cannot accept live charges.
 const stripe=stripeClient??(stripeKey?.startsWith('sk_test_')?new Stripe(stripeKey,{maxNetworkRetries:0,timeout:15000}):null);
 const errorResponse=error=>response({error:error instanceof AccessError?error.message:'The portrait service is temporarily unavailable. Please try again.'},error instanceof AccessError?error.status:503);
 async function owned(request,id){validId(id);const user=await verify(request);if(!store)throw new AccessError('Private portrait storage is not configured.',503);await store.ready();const row=await store.get(id);if(!row||row.owner_id!==user.id||row.payment_state==='deleting')throw new AccessError('Portrait not found.',404);return row;}
 function checkExpiry(row){if(row.payment_state!=='paid'&&new Date(row.expires_at)<=new Date())throw new AccessError('This unpaid preview has expired.',410);}
 async function detail(request,id){try{let row=await owned(request,id);if(row.payment_state!=='paid'&&row.checkout_session_id&&stripe){const session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);if(session.id!==row.checkout_session_id||session.metadata?.portrait_id!==row.id)throw new Error('Checkout does not match the requested portrait.');if(await fulfill(session))row=await store.get(row.id);}checkExpiry(row);const preview=await store.read(row.preview_path);return response({photo:{id:row.id,previewUrl:`data:image/jpeg;base64,${preview.toString('base64')}`,downloadFilename:`forma-${row.style}-preview.jpg`,style:row.style,paid:row.payment_state==='paid',watermarked:true,expiresAt:row.expires_at}});}catch(error){return errorResponse(error);}}
 async function download(request,id){try{const row=await owned(request,id);if(row.payment_state!=='paid')throw new AccessError('Purchase this portrait before downloading the original.',402);const image=await store.read(row.original_path);return new Response(new Uint8Array(image),{headers:{'Content-Type':'image/jpeg','Content-Disposition':`attachment; filename="forma-${row.style}-portrait.jpg"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return errorResponse(error);}}
 async function fulfill(session){
  if(session.livemode!==false||session.mode!=='payment'||session.payment_status!=='paid')return false;
  const id=session.metadata?.portrait_id;if(!id)return false;
  const row=await store.get(id);if(!row||row.payment_state==='deleting')return false;
  if(session.client_reference_id!==row.id||session.metadata.owner_id!==row.owner_id||session.metadata.checkout_key!==row.checkout_key||(row.checkout_session_id&&row.checkout_session_id!==session.id)||session.amount_total!==row.price_amount||session.currency!==row.price_currency)throw new Error('Payment does not match the recorded purchase.');
  if(row.payment_state==='paid')return true;
  if(!await store.markPaid(row,session)){
   const current=await store.get(row.id);
   if(current?.payment_state!=='paid'||current.checkout_session_id!==session.id)throw new Error('Payment could not be recorded.');
  }
  return true;
 }
 function sessionOptions(row){return{mode:'payment',line_items:[{price:row.price_id,quantity:1}],client_reference_id:row.id,metadata:{portrait_id:row.id,owner_id:row.owner_id,checkout_key:row.checkout_key},success_url:`${row.checkout_origin}/?portrait=${row.id}&checkout=success`,cancel_url:`${row.checkout_origin}/?portrait=${row.id}&checkout=cancelled`,expires_at:row.checkout_expires_at};}
 async function checkout(request,id){try{
  const origin=checkOrigin(request);let row=await owned(request,id);checkExpiry(row);
  if(row.payment_state==='paid')throw new AccessError('This portrait is already purchased. Download the original instead.',409);
  if(!stripe||!priceId||!webhookSecret)throw new AccessError('Checkout is not configured yet. A Stripe test price and webhook setup are required.',503);
  if(row.checkout_key&&(row.price_amount!==portraitPrice.amount||row.price_currency!==portraitPrice.currency))throw new AccessError('This checkout has a different price. Contact support before paying.',409);
  if(row.checkout_session_id){const session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);if(session.status==='open'&&session.url)return response({url:session.url});if(session.status!=='expired')throw new AccessError('Payment confirmation is pending. Refresh the portrait status shortly.',409);await store.clearCheckout(row);row=await store.get(id);}
  if(!row.checkout_key){const price=await stripe.prices.retrieve(priceId);if(price.livemode!==false||!price.active||price.type!=='one_time'||price.unit_amount!==portraitPrice.amount||price.currency!==portraitPrice.currency)throw new AccessError('Configure an active, one-time Stripe test price of US$1.00 (USD).',503);row=await store.reserveCheckout(row,price,origin);if(!row)throw new AccessError('This portrait is no longer available for checkout. Refresh its status.',409);}
  const session=await stripe.checkout.sessions.create(sessionOptions(row),{idempotencyKey:`portrait-v2-${row.checkout_key}`});
  if(session.livemode!==false||!session.url)throw new Error('Invalid test checkout session.');
  await store.attachSession(row,session.id);return response({url:session.url});
 }catch(error){return errorResponse(error);}}
 async function webhook(request){
  if(!stripe||!webhookSecret||!store)return response({error:'Stripe test webhooks are not configured.'},503);
  if(Number(request.headers.get('content-length'))>1024*1024)return response({error:'Webhook too large.'},413);
  let event;
  try{
   if(!request.body)return response({error:'Missing webhook body.'},400);
   const reader=request.body.getReader(),chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();return response({error:'Webhook too large.'},413);}chunks.push(Buffer.from(value));}
   event=stripe.webhooks.constructEvent(Buffer.concat(chunks),request.headers.get('stripe-signature')??'',webhookSecret);
  }catch{return response({error:'Invalid Stripe webhook signature.'},400);}
  if(event.livemode!==false)return response({error:'Live payments are not enabled.'},400);
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return response({received:true});
  try{const session=await stripe.checkout.sessions.retrieve(event.data.object.id);await fulfill(session);return response({received:true});}catch{return response({error:'Payment could not be recorded. Stripe should retry delivery.'},500);}
 }
 async function cleanup(){
  if(!store)throw new Error('Storage is not configured.');await store.ready();let removed=0,skipped=0;
  for(const row of await store.expired()){
   if(row.checkout_key){
    // Never delete a possibly paid image just because a webhook is delayed.
    if(!stripe||!row.checkout_session_id){skipped++;continue;}
    let session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);
    if(session.status==='open')session=await stripe.checkout.sessions.expire(session.id);
    if(session.payment_status==='paid'){await fulfill(session);continue;}
    if(session.status!=='expired'){skipped++;continue;}
   }
   if(await store.claimDelete(row)){await store.remove(row);removed++;}
  }
  return{removed,skipped};
 }
 return{detail,download,checkout,webhook,cleanup};
}
export const commerce=createCommerce();
