import {stripeConfiguration} from './stripe-config.mjs';
import {featureEnabled} from './features.mjs';
import sharp from 'sharp';
import {portraitPrice,packagePrice} from '../portrait-price.mjs';
import Stripe from 'stripe';
import {randomUUID} from 'node:crypto';
import {createPortraitStore} from './portrait-store.mjs';
import {createVerifier,checkOrigin,validId,AccessError,response} from './access.mjs';

export function createCommerce({store=createPortraitStore(),verify=createVerifier(),stripeKey=process.env.STRIPE_SECRET_KEY,priceId=process.env.STRIPE_PRICE_ID,packagePriceId=process.env.STRIPE_PACKAGE_PRICE_ID,webhookSecret=process.env.STRIPE_WEBHOOK_SECRET,stripeClient,stripeMode=process.env.STRIPE_MODE??'test',checkoutEnabled=featureEnabled('CHECKOUT_ENABLED'),logger=console.error}={}){
 const billing=stripeConfiguration({STRIPE_MODE:stripeMode,STRIPE_SECRET_KEY:stripeKey});
 const stripe=billing.valid?(stripeClient??(billing.keyValid?new Stripe(stripeKey,{maxNetworkRetries:0,timeout:15000}):null)):null;
 const live=billing.live;
 async function assertMode(){if(!billing.valid||!store||await store.billingMode()!==billing.mode)throw new AccessError('Payment mode is not ready. Contact support before paying.',503);}
 function checkSessionMode(session){if(session.livemode!==live)throw new AccessError('Checkout belongs to a different payment mode.',409);}
 const errorResponse=error=>response({error:error instanceof AccessError?error.message:'The portrait service is temporarily unavailable. Please try again.'},error instanceof AccessError?error.status:503);
 async function configuredPrice(id,setting){
  if(typeof id!=='string'||!id.startsWith('price_'))throw new AccessError(`${setting} must be a Stripe Price ID starting with price_, not a Product ID or payment link.`,503);
  try{return await stripe.prices.retrieve(id);}catch(error){
   if(error.code==='resource_missing')throw new AccessError(`${setting} was not found in the payment environment used by STRIPE_SECRET_KEY. Check that the Price and key belong to the same Stripe account and mode/sandbox.`,503);
   if(error.type==='StripeAuthenticationError'||error.statusCode===401)throw new AccessError('Stripe authentication failed. Check the server key and STRIPE_MODE.',503);
   if(error.type==='StripePermissionError'||error.statusCode===403)throw new AccessError('The Stripe key cannot read Prices. Check its permissions.',503);
   throw new AccessError('Stripe price verification is temporarily unavailable. No checkout was created. Please try again later.',503);
  }
 }
 async function owned(request,id){validId(id);const user=await verify(request);if(!store)throw new AccessError('Private portrait storage is not configured.',503);await store.ready();const row=await store.get(id);if(!row||row.owner_id!==user.id||row.payment_state==='deleting')throw new AccessError('Portrait not found.',404);return row;}
 async function detail(request,id){try{let row=await owned(request,id);if(row.payment_state!=='paid'&&row.checkout_session_id&&stripe){const session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);if(session.id!==row.checkout_session_id||session.metadata?.portrait_id!==row.id)throw new Error('Checkout does not match the requested portrait.');if(await fulfill(session))row=await store.get(row.id);}const paid=row.payment_state==='paid';const preview=await store.read(paid?row.original_path:row.preview_path);return response({photo:{id:row.id,previewUrl:`data:image/jpeg;base64,${preview.toString('base64')}`,downloadFilename:`forma-${row.style}-${paid?'portrait':'preview'}.jpg`,style:row.style,paid,watermarked:!paid,expiresAt:row.expires_at}});}catch(error){return errorResponse(error);}}
 async function download(request,id){try{const row=await owned(request,id);if(row.payment_state!=='paid')throw new AccessError('Purchase this portrait before downloading the original.',402);const image=await store.read(row.original_path);return new Response(new Uint8Array(image),{headers:{'Content-Type':'image/jpeg','Content-Disposition':`attachment; filename="forma-${row.style}-portrait.jpg"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}catch(error){return errorResponse(error);}}
 async function fulfill(session){
  await assertMode();
  if(session.livemode!==live||session.mode!=='payment'||session.payment_status!=='paid')return false;
  if(session.metadata?.kind==='credit_package')return fulfillPackage(session);
  const id=session.metadata?.portrait_id;if(!id)return false;
  const row=await store.get(id);if(!row||row.payment_state==='deleting')return false;
  if(row.stripe_livemode!==live)throw new Error('Purchase mode mismatch');
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
  const origin=checkOrigin(request);if(!checkoutEnabled)throw new AccessError('Checkout is temporarily unavailable. Please try again later.',503);let row=await owned(request,id);await assertMode();
  if(row.payment_state==='paid')throw new AccessError('This portrait is already purchased. Download the original instead.',409);
  if(!stripe||!priceId||!webhookSecret)throw new AccessError('Checkout is not configured yet. Matching Stripe price and webhook settings are required.',503);
  if(row.checkout_session_id){const session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);checkSessionMode(session);if(session.status==='open'&&session.url){if(row.price_amount!==portraitPrice.amount||row.price_currency!==portraitPrice.currency){await stripe.checkout.sessions.expire(session.id);throw new AccessError('The price has changed. Refresh purchase status and try again.',409);}return response({url:session.url});}if(session.status!=='expired')throw new AccessError('Payment confirmation is pending. Refresh the portrait status shortly.',409);await store.clearCheckout(row);row=await store.get(id);}
  if(!row.checkout_key){const price=await configuredPrice(priceId,'STRIPE_PRICE_ID');if(price.livemode!==live||!price.active||price.type!=='one_time'||price.unit_amount!==portraitPrice.amount||price.currency!==portraitPrice.currency)throw new AccessError(`Configure an active, one-time Stripe ${billing.mode} price of US$3.99 (USD).`,503);row=await store.reserveCheckout(row,price,origin);if(!row)throw new AccessError('This portrait is no longer available for checkout. Refresh its status.',409);}
  if(row.stripe_livemode!==live)throw new AccessError('Checkout belongs to a different payment mode.',409);
  if(row.price_amount!==portraitPrice.amount||row.price_currency!==portraitPrice.currency)throw new AccessError('This checkout has a different price. Refresh or contact support before paying.',409);
  const session=await stripe.checkout.sessions.create(sessionOptions(row),{idempotencyKey:`portrait-v2-${row.checkout_key}`});
  if(session.livemode!==live||!session.url)throw new Error('Invalid checkout session.');
  await store.attachSession(row,session.id);return response({url:session.url});
 }catch(error){return errorResponse(error);}}

 async function fulfillPackage(session){
  const id=session.metadata?.order_id,owner=session.metadata?.owner_id;
  if(!id||!owner)return false;
  const order=await store.creditOrder(owner,id);if(!order)throw new Error('Package order missing');
  if(order.stripe_livemode!==live)throw new Error('Package mode mismatch');
  if(session.client_reference_id!==order.id||(order.checkout_session_id&&order.checkout_session_id!==session.id)||session.amount_total!==packagePrice.amount||session.amount_total!==order.price_amount||session.currency!==packagePrice.currency||session.currency!==order.price_currency)throw new Error('Package payment mismatch');
  if(!await store.completeCreditOrder(order,session))throw new Error('Package payment could not be recorded');
  return true;
 }
 async function packageCheckout(request){let stage='validate';try{
  const origin=checkOrigin(request);if(!checkoutEnabled)throw new AccessError('Checkout is temporarily unavailable. Please try again later.',503);
  const user=await verify(request);if(!store)throw new AccessError('Credit storage is not configured.',503);await assertMode();
  if(!stripe||!packagePriceId||!webhookSecret)throw new AccessError('Package checkout is not configured. A matching Stripe package price is required.',503);
  stage='price_lookup';const price=await configuredPrice(packagePriceId,'STRIPE_PACKAGE_PRICE_ID');
  if(price.livemode!==live||!price.active||price.type!=='one_time'||price.unit_amount!==packagePrice.amount||price.currency!==packagePrice.currency)throw new AccessError(`Configure an active, one-time Stripe ${billing.mode} price of US$5.49 (USD).`,503);
  stage='order_reservation';const order=await store.reserveCreditOrder(user.id,price,origin);if(!order)throw new Error('Could not reserve package order');
  if(order.stripe_livemode!==live)throw new AccessError('Package belongs to a different payment mode.',409);
  if(order.checkout_session_id){
   stage='session_lookup';const session=await stripe.checkout.sessions.retrieve(order.checkout_session_id);checkSessionMode(session);
   if(session.id!==order.checkout_session_id||session.metadata?.order_id!==order.id||session.metadata?.owner_id!==user.id)throw new Error('Package checkout mismatch');
   stage='payment_reconciliation';if(await fulfill(session))return response({paid:true,orderId:order.id});
   if(session.status==='open'&&session.url)return response({url:session.url});
   if(session.status==='expired'&&session.payment_status==='unpaid'){await store.expireCreditOrder(order);throw new AccessError('The previous package checkout expired. Please try again to start a new checkout.',409);}
   throw new AccessError('Package payment is processing. Refresh its status before buying again.',409);
  }
  // Never recreate a session after Stripe may have discarded its idempotency key.
  if(order.checkout_expires_at<Math.floor(Date.now()/1000)+1800)throw new AccessError('This package checkout needs reconciliation. Contact support before buying again.',409);
  stage='session_creation';const session=await stripe.checkout.sessions.create({mode:'payment',line_items:[{price:order.price_id,quantity:1}],client_reference_id:order.id,metadata:{kind:'credit_package',order_id:order.id,owner_id:user.id},success_url:`${order.checkout_origin}/gallery?package=${order.id}&package_checkout=success`,cancel_url:`${order.checkout_origin}/gallery?package=${order.id}&package_checkout=cancelled`,expires_at:order.checkout_expires_at},{idempotencyKey:'credit-package-v1-'+order.id});
  if(session.livemode!==live||!session.url)throw new Error('Invalid checkout');
  stage='session_attachment';await store.attachCreditSession(order,session.id);return response({url:session.url});
 }catch(error){
  if(error instanceof AccessError)return errorResponse(error);
  const reference=randomUUID();
  // Deliberately omit upstream messages, stacks, request bodies and identities.
  const code=typeof error?.code==='string'&&/^[A-Za-z0-9_]{1,64}$/.test(error.code)?error.code:'unknown';
  const status=Number.isInteger(error?.statusCode)?error.statusCode:null;
  try{logger('[forma.package_checkout] '+JSON.stringify({reference,stage,code,status}));}catch{/* Diagnostics must not change payment behavior. */}
  return response({error:`Package checkout is temporarily unavailable. Reference: ${reference}.`,code:'package_checkout_unavailable',reference},503);
 }}
 async function packageStatus(request,id){try{
  validId(id);const user=await verify(request);if(!store)throw new AccessError('Credit storage is not configured.',503);
  await assertMode();let order=await store.creditOrder(user.id,id);if(!order)throw new AccessError('Package order not found.',404);
  if(order.stripe_livemode!==live)throw new AccessError('Package belongs to a different payment mode.',409);
  if(order.state==='pending'&&order.checkout_session_id){
   if(!stripe)throw new AccessError('Payment verification is unavailable.',503);
   const session=await stripe.checkout.sessions.retrieve(order.checkout_session_id);checkSessionMode(session);
   if(session.id!==order.checkout_session_id||session.metadata?.order_id!==order.id||session.metadata?.owner_id!==user.id)throw new Error('Package checkout mismatch');
   if(await fulfill(session))order=await store.creditOrder(user.id,id);
   else if(session.status==='expired'&&session.payment_status==='unpaid'){await store.expireCreditOrder(order);order={...order,state:'expired'};}
  }
  return response({order:{id:order.id,state:order.state}});
 }catch(error){return errorResponse(error);}}
 async function unlock(request,id){try{
  checkOrigin(request);let row=await owned(request,id);await assertMode();
  if(row.payment_state==='paid')return response({unlocked:true});
  if(row.checkout_key){
   if(!stripe||!row.checkout_session_id)throw new AccessError('Checkout is unresolved. Refresh purchase status before using a credit.',409);
   let session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);checkSessionMode(session);
   if(session.id!==row.checkout_session_id||session.metadata?.portrait_id!==row.id)throw new Error('Checkout mismatch');
   if(session.status==='open')session=await stripe.checkout.sessions.expire(session.id);
   if(session.payment_status==='paid'){await fulfill(session);return response({unlocked:true});}
   if(session.status!=='expired'||session.payment_status!=='unpaid')throw new AccessError('Payment is processing. Refresh purchase status before using a credit.',409);
  }
  const result=await store.unlockPortrait(row);
  if(result==='exhausted')throw new AccessError('No unlock credits remain. Buy a credit package or purchase this original directly.',402);
  if(result==='not_found')throw new AccessError('Portrait not found.',404);
  if(!['unlocked','already_unlocked'].includes(result))throw new AccessError('Portrait status changed. Refresh before trying again.',409);
  return response({unlocked:true});
 }catch(error){return errorResponse(error);}}

 async function webhook(request){
  if(!stripe||!webhookSecret||!store)return response({error:'Stripe webhooks are not configured for this payment mode.'},503);
  if(Number(request.headers.get('content-length'))>1024*1024)return response({error:'Webhook too large.'},413);
  let event;
  try{
   if(!request.body)return response({error:'Missing webhook body.'},400);
   const reader=request.body.getReader(),chunks=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>1024*1024){await reader.cancel();return response({error:'Webhook too large.'},413);}chunks.push(Buffer.from(value));}
   event=stripe.webhooks.constructEvent(Buffer.concat(chunks),request.headers.get('stripe-signature')??'',webhookSecret);
  }catch{return response({error:'Invalid Stripe webhook signature.'},400);}
  if(event.livemode!==live)return response({error:'Webhook payment mode does not match this service.'},400);
  if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))return response({received:true});
  try{const session=await stripe.checkout.sessions.retrieve(event.data.object.id);checkSessionMode(session);await fulfill(session);return response({received:true});}catch{return response({error:'Payment could not be recorded. Stripe should retry delivery.'},500);}
 }
 async function list(request){try{
  const user=await verify(request);if(!store)throw new AccessError('Private portrait storage is not configured.',503);
  const params=new URL(request.url).searchParams,status=params.get('status')??'all';
  if(!['all','unpaid','purchased'].includes(status))throw new AccessError('Invalid gallery filter.',400);
  let cursor;const encoded=params.get('cursor');
  if(encoded){try{if(encoded.length>300)throw new Error();cursor=JSON.parse(Buffer.from(encoded,'base64url').toString());validId(cursor.id);if(typeof cursor.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.createdAt)||!Number.isFinite(Date.parse(cursor.createdAt)))throw new Error();}catch{throw new AccessError('Invalid gallery cursor.',400);}}
  const rows=await store.list(user.id,status,cursor),page=rows.slice(0,12),last=page.at(-1);
  return response({photos:page.map(row=>({id:row.id,style:row.style,createdAt:row.created_at,paid:row.payment_state==='paid'})),nextCursor:rows.length>12?Buffer.from(JSON.stringify({createdAt:last.created_at,id:last.id})).toString('base64url'):null});
 }catch(error){return errorResponse(error);}}
 async function thumbnail(request,id){try{
  const row=await owned(request,id),image=await store.read(row.payment_state==='paid'?row.original_path:row.preview_path);
  const buffer=await sharp(image).resize({width:480,height:640,fit:'inside',withoutEnlargement:true}).jpeg({quality:80}).toBuffer();
  return new Response(new Uint8Array(buffer),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});
 }catch(error){return errorResponse(error);}}
 async function remove(request,id){try{
  checkOrigin(request);validId(id);const user=await verify(request);if(!store)throw new AccessError('Private portrait storage is not configured.',503);
  const row=await store.get(id);if(!row)return response({deleted:true});if(row.owner_id!==user.id)throw new AccessError('Portrait not found.',404);
  let confirmation;try{confirmation=await request.json();}catch{throw new AccessError('Confirm permanent deletion first.',400);}
  if(confirmation.confirm!==true||typeof confirmation.paid!=='boolean')throw new AccessError('Confirm permanent deletion first.',400);
  if(row.payment_state!=='deleting'){
   if(confirmation.paid!==(row.payment_state==='paid'))throw new AccessError('Purchase status changed. Refresh and confirm deletion again.',409);
   if(row.payment_state==='unpaid'&&row.checkout_key){
    if(!stripe||!row.checkout_session_id)throw new AccessError('Checkout is unresolved. Refresh payment status or contact support before deleting.',409);
    let session=await stripe.checkout.sessions.retrieve(row.checkout_session_id);checkSessionMode(session);
    if(session.id!==row.checkout_session_id||session.metadata?.portrait_id!==row.id)throw new Error('Checkout mismatch');
    if(session.status==='open')session=await stripe.checkout.sessions.expire(session.id);
    if(session.payment_status==='paid'){await fulfill(session);throw new AccessError('Payment confirmed. Refresh and confirm deletion of the purchased original again.',409);}
    if(session.status!=='expired'||session.payment_status!=='unpaid')throw new AccessError('Payment is processing. Try deleting again after payment is resolved.',409);
   }
   if(!await store.claimDelete(row))throw new AccessError('Portrait status changed. Refresh before deleting.',409);
  }
  await store.remove(row);return response({deleted:true});
 }catch(error){return errorResponse(error);}}
 async function cleanup(){
  if(!store)throw new Error('Storage is not configured.');await store.ready();let removed=0;
  for(const row of await store.pendingDeletion()){await store.remove(row);removed++;}
  return{removed,skipped:0};
 }

 return{detail,download,checkout,packageCheckout,packageStatus,unlock,webhook,cleanup,list,thumbnail,remove};
}
export const commerce=createCommerce();
