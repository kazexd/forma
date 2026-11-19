import {describe,it,expect,vi} from 'vitest';

import Stripe from 'stripe';

import {createCommerce} from './commerce.mjs';

function financials(session,priceId='price_test',amount=399){return {...session,amount_subtotal:amount,total_details:{amount_discount:0,amount_tax:0,amount_shipping:0},discounts:[],line_items:{has_more:false,data:[{quantity:1,price:{id:priceId,unit_amount:amount,currency:session.currency,livemode:session.livemode},currency:session.currency,amount_subtotal:amount,amount_discount:0,amount_tax:0,amount_total:amount}]}};}

const id='11111111-1111-4111-8111-111111111111';

const row=()=>({id,owner_id:'owner',style:'casual',stripe_livemode:false,payment_state:'unpaid',original_path:'private/original.jpg',preview_path:'private/preview.jpg',expires_at:'2035-01-01T00:00:00.000Z',checkout_key:'key',checkout_session_id:'cs_test_1',price_id:'price_test',price_amount:399,price_currency:'cad',checkout_origin:'http://localhost:5173',checkout_expires_at:Math.floor(Date.now()/1000)+1800});

function setup(overrides={}){

 const record=row();

 const store={billingMode:vi.fn().mockResolvedValue('test'),ready:vi.fn().mockResolvedValue(),get:vi.fn().mockImplementation(async()=>record),read:vi.fn().mockResolvedValue(Buffer.from('JPEG')),reserveCheckout:vi.fn().mockImplementation(async()=>record),attachSession:vi.fn().mockResolvedValue(),clearCheckout:vi.fn().mockResolvedValue(),markPaid:vi.fn().mockImplementation(async()=>{record.payment_state='paid';return true;}),pendingDeletion:vi.fn().mockResolvedValue([]),list:vi.fn().mockResolvedValue([]),claimDelete:vi.fn().mockResolvedValue(true),remove:vi.fn().mockResolvedValue()};

 const session=financials({id:'cs_test_1',livemode:false,mode:'payment',status:'complete',payment_status:'paid',client_reference_id:id,amount_total:399,currency:'cad',metadata:{portrait_id:id,owner_id:'owner',checkout_key:'key'}});

 const stripe={webhooks:new Stripe('sk_test_not_real').webhooks,prices:{retrieve:vi.fn().mockResolvedValue({id:'price_test',livemode:false,active:true,type:'one_time',unit_amount:399,currency:'cad'})},checkout:{sessions:{retrieve:vi.fn().mockResolvedValue(session),create:vi.fn().mockResolvedValue({id:'cs_test_1',livemode:false,url:'https://checkout.stripe.com/c/pay/test'}),expire:vi.fn().mockResolvedValue({...session,status:'expired',payment_status:'unpaid'})}}};

 const verify=vi.fn().mockResolvedValue({id:'owner'});

 const app=createCommerce({store,verify,checkoutEnabled:true,stripeClient:stripe,priceId:'price_test',webhookSecret:'whsec_test',...overrides});

 return{app,store,record,stripe,session,verify};

}

const request=(method='GET')=>new Request('http://localhost:5173/api/portraits/'+id,{method});

function eventRequest(stripe,{type='checkout.session.completed',livemode=false}={}){const payload=JSON.stringify({id:'evt_test',type,livemode,data:{object:{id:'cs_test_1'}}});const signature=stripe.webhooks.generateTestHeaderString({payload,secret:'whsec_test'});return new Request('http://localhost:5173/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':signature},body:payload});}

describe('portrait ownership and preview',()=>{

 it('returns only a watermarked preview without private object paths',async()=>{const {app,store,session}=setup();session.payment_status='unpaid';const response=await app.detail(request(),id);const body=await response.json();expect(response.status).toBe(200);expect(body.photo.watermarked).toBe(true);expect(body.photo.paid).toBe(false);expect(store.read).toHaveBeenCalledWith('private/preview.jpg');expect(JSON.stringify(body)).not.toContain('private/');expect(response.headers.get('cache-control')).toBe('no-store');});

 it('blocks original downloads before payment, even if the browser claims success',async()=>{const {app,store}=setup();const response=await app.download(new Request('http://localhost:5173/?checkout=success&paid=true'),id);expect(response.status).toBe(402);expect(store.read).not.toHaveBeenCalled();});

 it('serves original bytes only after a paid record is found',async()=>{const {app,store,record}=setup();record.payment_state='paid';const response=await app.download(request(),id);expect(response.status).toBe(200);expect(store.read).toHaveBeenCalledWith('private/original.jpg');expect(response.headers.get('content-disposition')).toContain('attachment');expect(response.headers.get('cache-control')).toContain('no-store');});

 it.each(['detail','download','checkout'])('hides another userâ€™s portrait from %s',async(action)=>{const {app,record,store}=setup();record.owner_id='someone-else';expect((await app[action](request(action==='checkout'?'POST':'GET'),id)).status).toBe(404);expect(store.read).not.toHaveBeenCalled();});

 it('rejects invalid IDs without reading storage',async()=>{const {app,store}=setup();expect((await app.detail(request(),'../original')).status).toBe(404);expect(store.get).not.toHaveBeenCalled();});

 it('retains unpaid previews and purchased downloads indefinitely',async()=>{const {app,record,session}=setup();session.payment_status='unpaid';record.expires_at='2020-01-01T00:00:00Z';expect((await app.detail(request(),id)).status).toBe(200);record.payment_state='paid';expect((await app.download(request(),id)).status).toBe(200);});

});

describe('Stripe test checkout',()=>{

 it('reuses an open session rather than creating a duplicate',async()=>{const {app,stripe}=setup();stripe.checkout.sessions.retrieve.mockResolvedValue({livemode:false,status:'open',url:'https://checkout.stripe.com/test'});const response=await app.checkout(request('POST'),id);expect(response.status).toBe(200);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('uses a server-side fixed price and idempotency key',async()=>{const {app,stripe,record}=setup();record.checkout_session_id=null;const response=await app.checkout(request('POST'),id);expect(response.status).toBe(200);expect(stripe.checkout.sessions.create.mock.calls[0][0]).not.toHaveProperty('payment_method_types');expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({line_items:[{price:'price_test',quantity:1}],metadata:expect.objectContaining({owner_id:'owner',portrait_id:id})}),{idempotencyKey:'portrait-v2-key'});});

 it('does not unlock from a completed checkout while webhook confirmation is pending',async()=>{const {app,store}=setup();expect((await app.checkout(request('POST'),id)).status).toBe(409);expect(store.markPaid).not.toHaveBeenCalled();});

 it('rejects cross-site checkout requests',async()=>{const {app,stripe}=setup();expect((await app.checkout(new Request('http://localhost:5173/api/checkout',{method:'POST',headers:{Origin:'https://evil.example'}}),id)).status).toBe(403);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('does not charge again for an already purchased portrait',async()=>{const {app,record,stripe}=setup();record.payment_state='paid';expect((await app.checkout(request('POST'),id)).status).toBe(409);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('rejects recurring, zero-value or live prices',async()=>{for(const invalid of [{type:'recurring'},{unit_amount:0},{livemode:true},{unit_amount:200},{currency:'usd'}]){const {app,record,stripe}=setup();record.checkout_session_id=null;record.checkout_key=null;stripe.prices.retrieve.mockResolvedValue({id:'price_test',livemode:false,active:true,type:'one_time',unit_amount:399,currency:'cad',...invalid});expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();}});

});

describe('verified payment fulfillment',()=>{

 it('rejects unsigned or altered webhook bodies',async()=>{const {app,store}=setup();expect((await app.webhook(new Request('http://localhost:5173/webhook',{method:'POST',body:'{}'}))).status).toBe(400);expect(store.markPaid).not.toHaveBeenCalled();});

 it('records payment once despite duplicate signed webhook deliveries',async()=>{const {app,stripe,store}=setup();expect((await app.webhook(eventRequest(stripe))).status).toBe(200);expect((await app.webhook(eventRequest(stripe))).status).toBe(200);expect(store.markPaid).toHaveBeenCalledTimes(1);expect((await app.download(request(),id)).status).toBe(200);});

 it('does not unlock unpaid sessions',async()=>{const {app,stripe,session,store}=setup();session.payment_status='unpaid';await app.webhook(eventRequest(stripe));expect(store.markPaid).not.toHaveBeenCalled();});

 it.each(['amount','currency','owner','key','session'])('does not unlock mismatched %s',async(field)=>{const {app,stripe,session,store}=setup();if(field==='amount')session.amount_total=1;if(field==='currency')session.currency='usd';if(field==='owner')session.metadata.owner_id='other';if(field==='key')session.metadata.checkout_key='other';if(field==='session')session.id='cs_different';expect((await app.webhook(eventRequest(stripe))).status).toBe(500);expect(store.markPaid).not.toHaveBeenCalled();});

 it('rejects signed live events in the test integration',async()=>{const {app,stripe,store}=setup();expect((await app.webhook(eventRequest(stripe,{livemode:true}))).status).toBe(400);expect(store.markPaid).not.toHaveBeenCalled();});

 it('requests retry when database fulfillment fails',async()=>{const {app,stripe,store}=setup();store.markPaid.mockRejectedValue(new Error('database unavailable'));expect((await app.webhook(eventRequest(stripe))).status).toBe(500);});

});

describe('explicit deletion cleanup',()=>{
 it('removes only records already marked deleting',async()=>{const {app,record,store}=setup();record.payment_state='deleting';store.pendingDeletion.mockResolvedValue([record]);expect(await app.cleanup()).toEqual({removed:1,skipped:0});expect(store.remove).toHaveBeenCalledWith(record);});
 it('never removes expired unpaid portraits',async()=>{const {app,store}=setup();await app.cleanup();expect(store.remove).not.toHaveBeenCalled();});
});

describe('streamed webhook limits',()=>{

 it('limits a chunked webhook even when no Content-Length is provided',async()=>{const {app,store}=setup();let n=0;const body=new ReadableStream({pull(controller){if(n++<3)controller.enqueue(new Uint8Array(512*1024));else controller.close();}});const response=await app.webhook(new Request('http://localhost:5173/webhook',{method:'POST',body,duplex:'half'}));expect(response.status).toBe(413);expect(store.markPaid).not.toHaveBeenCalled();});

});





describe('payment status reconciliation',()=>{

 it('recovers a paid checkout when webhook delivery is missing, idempotently',async()=>{const {app,store,stripe}=setup();const res=await app.detail(request(),id);expect(res.status).toBe(200);expect((await res.json()).photo.paid).toBe(true);expect(store.markPaid).toHaveBeenCalledTimes(1);await app.detail(request(),id);expect(store.markPaid).toHaveBeenCalledTimes(1);expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledTimes(1);});

 it.each(['amount','currency','owner','key','session','portrait','live','unpaid'])('never unlocks an invalid %s session on refresh',async(field)=>{const {app,session,store}=setup();if(field==='amount')session.amount_total=1;if(field==='currency')session.currency='usd';if(field==='owner')session.metadata.owner_id='other';if(field==='key')session.metadata.checkout_key='other';if(field==='session')session.id='other';if(field==='portrait')session.metadata.portrait_id='other';if(field==='live')session.livemode=true;if(field==='unpaid')session.payment_status='unpaid';await app.detail(request(),id);expect(store.markPaid).not.toHaveBeenCalled();});

 it('does not contact Stripe for another user’s portrait',async()=>{const {app,record,stripe}=setup();record.owner_id='other';expect((await app.detail(request(),id)).status).toBe(404);expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();});

 it('keeps access locked when Stripe verification is unavailable',async()=>{const {app,store,stripe}=setup();stripe.checkout.sessions.retrieve.mockRejectedValue(new Error('network'));expect((await app.detail(request(),id)).status).toBe(503);expect(store.markPaid).not.toHaveBeenCalled();});

});





describe('purchased portrait display',()=>{

 it('returns the original bytes only for a verified purchased portrait',async()=>{const {app,record,store,stripe}=setup();record.payment_state='paid';store.read.mockResolvedValue(Buffer.from('ORIGINAL'));const res=await app.detail(request(),id);const {photo}=await res.json();expect(photo.paid).toBe(true);expect(photo.watermarked).toBe(false);expect(photo.previewUrl).toBe('data:image/jpeg;base64,'+Buffer.from('ORIGINAL').toString('base64'));expect(store.read).toHaveBeenCalledWith('private/original.jpg');expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();});

 it('shows the original immediately after verified payment recovery',async()=>{const {app,store}=setup();const res=await app.detail(request(),id);expect((await res.json()).photo.watermarked).toBe(false);expect(store.read).toHaveBeenCalledWith('private/original.jpg');});

});


const deletion=(paid=false)=>new Request('http://localhost:5173/api/portraits/'+id,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirm:true,paid})});
describe('private gallery API',()=>{
 it('returns a sanitized owner-only page and cursor',async()=>{const {app,store}=setup();store.list.mockResolvedValue(Array.from({length:13},()=>({...row(),created_at:'2026-10-31T00:00:00.123456+00:00',original_path:'secret'})));const res=await app.list(new Request('http://localhost:5173/api/portraits?status=all'));const body=await res.json();expect(body.photos).toHaveLength(12);expect(body.nextCursor).toBeTruthy();expect(JSON.stringify(body)).not.toContain('secret');expect(store.list).toHaveBeenCalledWith('owner','all',undefined);expect((await app.list(new Request('http://localhost:5173/api/portraits?cursor='+body.nextCursor))).status).toBe(200);expect(res.headers.get('cache-control')).toBe('no-store');});
 it.each(['status=bad','cursor=bad'])('rejects invalid query %s',async query=>{const {app,store}=setup();expect((await app.list(new Request('http://localhost:5173/api/portraits?'+query))).status).toBe(400);expect(store.list).not.toHaveBeenCalled();});
 it.each([false,true])('uses the correct thumbnail source for paid=%s',async paid=>{const {app,store,record}=setup();record.payment_state=paid?'paid':'unpaid';const sharp=(await import('sharp')).default;store.read.mockResolvedValue(await sharp({create:{width:600,height:900,channels:3,background:'red'}}).jpeg().toBuffer());const res=await app.thumbnail(request(),id);expect(res.status).toBe(200);expect(store.read).toHaveBeenCalledWith(paid?'private/original.jpg':'private/preview.jpg');expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBeLessThanOrEqual(480);expect(res.headers.get('cache-control')).toContain('no-store');});
 it.each(['thumbnail','remove'])('blocks another owner from %s',async method=>{const {app,record,store}=setup();record.owner_id='other';expect((await app[method](deletion(),id)).status).toBe(404);expect(store.read).not.toHaveBeenCalled();expect(store.remove).not.toHaveBeenCalled();});
});
describe('safe permanent deletion',()=>{
 it('requires explicit confirmation',async()=>{const {app,store}=setup();expect((await app.remove(request('DELETE'),id)).status).toBe(400);expect(store.claimDelete).not.toHaveBeenCalled();});
 it('rejects cross-site deletion',async()=>{const {app,store}=setup();expect((await app.remove(new Request('http://localhost:5173/api/portraits/'+id,{method:'DELETE',headers:{Origin:'https://evil.example'}}),id)).status).toBe(403);expect(store.remove).not.toHaveBeenCalled();});
 it('deletes unpaid portraits without a checkout',async()=>{const {app,record,store}=setup();record.checkout_key=null;expect((await app.remove(deletion(),id)).status).toBe(200);expect(store.claimDelete).toHaveBeenCalledWith(record);expect(store.remove).toHaveBeenCalledWith(record);expect(store.markPaid).not.toHaveBeenCalled();});
 it('requires a purchased confirmation before deleting a paid original',async()=>{const {app,record,store}=setup();record.payment_state='paid';expect((await app.remove(deletion(),id)).status).toBe(409);expect(store.remove).not.toHaveBeenCalled();expect((await app.remove(deletion(true),id)).status).toBe(200);expect(store.markPaid).not.toHaveBeenCalled();});
 it('records newly discovered payment and asks for fresh confirmation',async()=>{const {app,store}=setup();expect((await app.remove(deletion(),id)).status).toBe(409);expect(store.markPaid).toHaveBeenCalled();expect(store.claimDelete).not.toHaveBeenCalled();expect(store.remove).not.toHaveBeenCalled();});
 it('expires an open unpaid session before claiming deletion',async()=>{const {app,stripe,session,store}=setup();session.payment_status='unpaid';session.status='open';stripe.checkout.sessions.expire.mockResolvedValue({...session,status:'expired'});expect((await app.remove(deletion(),id)).status).toBe(200);expect(stripe.checkout.sessions.expire).toHaveBeenCalled();expect(store.claimDelete).toHaveBeenCalled();});
 it('blocks unresolved reservations',async()=>{const {app,record,store}=setup();record.checkout_session_id=null;expect((await app.remove(deletion(),id)).status).toBe(409);expect(store.remove).not.toHaveBeenCalled();});
 it('blocks processing payments',async()=>{const {app,session,store}=setup();session.payment_status='unpaid';expect((await app.remove(deletion(),id)).status).toBe(409);expect(store.claimDelete).not.toHaveBeenCalled();});
 it('does not delete if checkout or payment changed concurrently',async()=>{const {app,record,store}=setup();record.checkout_key=null;store.claimDelete.mockResolvedValue(false);expect((await app.remove(deletion(),id)).status).toBe(409);expect(store.remove).not.toHaveBeenCalled();});
 it('retains deleting state for retry after storage failure',async()=>{const {app,record,store}=setup();record.payment_state='deleting';store.remove.mockRejectedValueOnce(new Error('storage'));expect((await app.remove(deletion(),id)).status).toBe(503);expect((await app.remove(deletion(),id)).status).toBe(200);expect(store.claimDelete).not.toHaveBeenCalled();});
});

it('fails closed when Stripe cannot verify a deletion',async()=>{const {app,stripe,store}=setup();stripe.checkout.sessions.retrieve.mockRejectedValue(new Error('network'));expect((await app.remove(deletion(),id)).status).toBe(503);expect(store.claimDelete).not.toHaveBeenCalled();});
it('returns idempotent success after a portrait has already been removed',async()=>{const {app,store}=setup();store.get.mockResolvedValue(null);expect((await app.remove(deletion(),id)).status).toBe(200);expect(store.remove).not.toHaveBeenCalled();});


it('blocks disabled checkout before reserving or creating a Stripe session',async()=>{const {app,store,stripe}=setup({checkoutEnabled:false});expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(store.reserveCheckout).not.toHaveBeenCalled();expect(stripe.prices.retrieve).not.toHaveBeenCalled();expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
it('keeps paid downloads and payment reconciliation available when new checkout is disabled',async()=>{const {app,store}=setup({checkoutEnabled:false});const detail=await app.detail(request(),id);expect((await detail.json()).photo.paid).toBe(true);expect(store.markPaid).toHaveBeenCalled();expect((await app.download(request(),id)).status).toBe(200);});

describe('credit packages and credit redemption',()=>{
 const orderId='22222222-2222-4222-8222-222222222222';
 function credits(options={}){
  const x=setup({packagePriceId:'price_package',...options});
  const order={id:orderId,owner_id:'owner',state:'pending',stripe_livemode:false,price_id:'price_package',price_amount:549,price_currency:'cad',checkout_origin:'http://localhost:5173',checkout_expires_at:Math.floor(Date.now()/1000)+3600,checkout_session_id:null};
  x.store.reserveCreditOrder=vi.fn().mockResolvedValue(order);x.store.creditOrder=vi.fn().mockResolvedValue(order);x.store.attachCreditSession=vi.fn().mockResolvedValue();x.store.expireCreditOrder=vi.fn().mockResolvedValue();x.store.completeCreditOrder=vi.fn().mockImplementation(async()=>{order.state='paid';return true;});x.store.unlockPortrait=vi.fn().mockResolvedValue('unlocked');
  x.stripe.prices.retrieve.mockResolvedValue({id:'price_package',livemode:false,active:true,type:'one_time',unit_amount:549,currency:'cad'});
  return {...x,order};
 }
 const paidPackage=()=>financials({id:'cs_package',livemode:false,mode:'payment',payment_status:'paid',status:'complete',client_reference_id:orderId,amount_total:549,currency:'cad',metadata:{kind:'credit_package',order_id:orderId,owner_id:'owner'}},'price_package',549);
 it('fulfills a fully discounted package without a PaymentIntent',async()=>{
  const {app,order,stripe,store}=credits();order.promotions_enabled=true;order.checkout_session_id='cs_package';
  const session=paidPackage();session.amount_total=0;session.payment_status='no_payment_required';session.total_details.amount_discount=549;session.discounts=[{promotion_code:'promo_free'}];session.line_items.data[0].amount_discount=549;session.line_items.data[0].amount_total=0;
  stripe.checkout.sessions.retrieve.mockResolvedValue(session);
  expect((await app.packageStatus(request(),orderId)).status).toBe(200);
  expect(store.completeCreditOrder).toHaveBeenCalledWith(order,session,expect.objectContaining({subtotal:549,discount:549,total:0}));
 });
 it('offers promotion-code entry for new package reservations',async()=>{
  const {app,order,stripe}=credits();order.promotions_enabled=true;
  expect((await app.packageCheckout(request('POST'))).status).toBe(200);
  expect(stripe.checkout.sessions.create.mock.calls[0][0].allow_promotion_codes).toBe(true);
 });
 const starterRequest=(plan='starter')=>new Request('http://localhost:5173/api/credit-packages/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({package:plan,amount:1,generations:999,unlocks:999})});
 it('creates a starter checkout using only its server-controlled CAD price and package',async()=>{
  const {app,order,stripe,store}=credits({starterPackagePriceId:'price_starter'});Object.assign(order,{package_code:'starter',generation_credits:3,unlock_credits:1,price_id:'price_starter',price_amount:449,promotions_enabled:true});
  stripe.prices.retrieve.mockResolvedValue({id:'price_starter',livemode:false,active:true,type:'one_time',unit_amount:449,currency:'cad'});
  expect((await app.packageCheckout(starterRequest())).status).toBe(200);
  expect(store.reserveCreditOrder).toHaveBeenCalledWith('owner',expect.objectContaining({id:'price_starter',unit_amount:449}),'http://localhost:5173','starter');
  expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({allow_promotion_codes:true,line_items:[{price:'price_starter',quantity:1}]}),{idempotencyKey:'credit-package-v1-'+orderId});
 });
 it('rejects unknown packages before Stripe price lookup',async()=>{const {app,stripe}=credits();expect((await app.packageCheckout(starterRequest('__proto__'))).status).toBe(400);expect(stripe.prices.retrieve).not.toHaveBeenCalled();});
 it('does not substitute the plus price when starter is unconfigured',async()=>{const {app,stripe}=credits();expect((await app.packageCheckout(starterRequest())).status).toBe(503);expect(stripe.prices.retrieve).not.toHaveBeenCalled();});
 it('rejects a configured starter price of the wrong amount',async()=>{const {app,store}=credits({starterPackagePriceId:'price_starter'});expect((await app.packageCheckout(starterRequest())).status).toBe(503);expect(store.reserveCreditOrder).not.toHaveBeenCalled();});
 it('fulfills a fully discounted starter against its original 449-cent snapshot',async()=>{
  const {app,order,stripe,store}=credits();Object.assign(order,{package_code:'starter',price_id:'price_starter',price_amount:449,generation_credits:3,unlock_credits:1,promotions_enabled:true,checkout_session_id:'cs_package'});
  const session=financials({...paidPackage(),amount_total:0,payment_status:'no_payment_required'},'price_starter',449);session.total_details.amount_discount=449;session.discounts=[{promotion_code:'promo_starter'}];Object.assign(session.line_items.data[0],{amount_discount:449,amount_total:0});stripe.checkout.sessions.retrieve.mockResolvedValue(session);
  expect((await app.packageStatus(request(),orderId)).status).toBe(200);expect(store.completeCreditOrder).toHaveBeenCalledWith(order,session,expect.objectContaining({subtotal:449,discount:449,total:0}));
 });
 it('uses a fixed server-side package price and durable order idempotency',async()=>{
  const {app,stripe,store}=credits();const res=await app.packageCheckout(request('POST'));expect(res.status).toBe(200);
  expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({line_items:[{price:'price_package',quantity:1}],metadata:{kind:'credit_package',order_id:orderId,owner_id:'owner'}}),{idempotencyKey:'credit-package-v1-'+orderId});expect(store.attachCreditSession).toHaveBeenCalled();
 });
 it('blocks cross-origin package checkout and disabled checkout',async()=>{
  const {app,store}=credits();expect((await app.packageCheckout(new Request('http://localhost:5173/api',{method:'POST',headers:{Origin:'https://evil.com'}}))).status).toBe(403);expect(store.reserveCreditOrder).not.toHaveBeenCalled();
  expect((await setup({checkoutEnabled:false}).app.packageCheckout(request('POST'))).status).toBe(503);
 });
 it('rejects a wrong package price before reserving an order',async()=>{const {app,store,stripe}=credits();stripe.prices.retrieve.mockResolvedValue({livemode:false,active:true,type:'one_time',unit_amount:100,currency:'cad'});expect((await app.packageCheckout(request('POST'))).status).toBe(503);expect(store.reserveCreditOrder).not.toHaveBeenCalled();});
 it('reuses an open package session without creating another',async()=>{const {app,order,stripe}=credits();order.checkout_session_id='cs_package';stripe.checkout.sessions.retrieve.mockResolvedValue({...paidPackage(),payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/test'});expect((await app.packageCheckout(request('POST'))).status).toBe(200);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
 it('reconciles a verified paid package on refresh and signed webhook',async()=>{const {app,order,stripe,store}=credits();order.checkout_session_id='cs_package';stripe.checkout.sessions.retrieve.mockResolvedValue(paidPackage());const res=await app.packageStatus(request(),orderId);expect(await res.json()).toEqual({order:{id:orderId,state:'paid'}});expect(store.completeCreditOrder).toHaveBeenCalled();expect((await app.webhook(eventRequest(stripe))).status).toBe(200);});
 it.each([{amount_total:100},{currency:'hkd'},{client_reference_id:'other'},{metadata:{kind:'credit_package',order_id:orderId,owner_id:'other'}},{id:'other_session'}])('rejects mismatched package payment %j',async change=>{const {app,order,stripe,store}=credits();order.checkout_session_id='cs_package';stripe.checkout.sessions.retrieve.mockResolvedValue({...paidPackage(),...change});expect((await app.packageStatus(request(),orderId)).status).toBe(503);expect(store.completeCreditOrder).not.toHaveBeenCalled();});
 it('does not grant for unpaid or live packages',async()=>{const {app,order,stripe,store}=credits();order.checkout_session_id='cs_package';for(const change of [{payment_status:'unpaid'},{livemode:true}]){stripe.checkout.sessions.retrieve.mockResolvedValue({...paidPackage(),...change});const res=await app.packageStatus(request(),orderId);if(change.livemode===true)expect(res.status).toBe(409);else expect((await res.json()).order.state).toBe('pending');}expect(store.completeCreditOrder).not.toHaveBeenCalled();});
 it('does not recreate unresolved orders after their checkout deadline',async()=>{const {app,order,stripe}=credits();order.checkout_expires_at=1;expect((await app.packageCheckout(request('POST'))).status).toBe(409);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
 it('hides other-account package orders',async()=>{const {app,store}=credits();store.creditOrder.mockResolvedValue(null);expect((await app.packageStatus(request(),orderId)).status).toBe(404);expect(store.creditOrder).toHaveBeenCalledWith('owner',orderId);});
 it('unlocks with a credit after cancelling an open single-photo checkout',async()=>{const {app,stripe,store}=credits();stripe.checkout.sessions.retrieve.mockResolvedValue({...paidPackage(),id:'cs_test_1',status:'open',payment_status:'unpaid',metadata:{portrait_id:id}});expect((await app.unlock(request('POST'),id)).status).toBe(200);expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_test_1');expect(store.unlockPortrait).toHaveBeenCalled();});
 it('does not spend a credit if Stripe already paid for that photo',async()=>{const {app,store}=credits();expect((await app.unlock(request('POST'),id)).status).toBe(200);expect(store.markPaid).toHaveBeenCalled();expect(store.unlockPortrait).not.toHaveBeenCalled();});
 it.each([['exhausted',402],['changed',409],['not_found',404]])('handles credit unlock %s safely',async(result,status)=>{const {app,record,store}=credits();record.checkout_key=null;store.unlockPortrait.mockResolvedValue(result);expect((await app.unlock(request('POST'),id)).status).toBe(status);});
 it('rejects unresolved photo checkout and cross-account credit unlock',async()=>{const {app,record,store}=credits();record.checkout_session_id=null;expect((await app.unlock(request('POST'),id)).status).toBe(409);record.owner_id='other';expect((await app.unlock(request('POST'),id)).status).toBe(404);expect(store.unlockPortrait).not.toHaveBeenCalled();});
});
it.each([
 [{code:'resource_missing'},'same Stripe account and mode/sandbox'],
 [{type:'StripeAuthenticationError'},'authentication failed'],
 [{type:'StripePermissionError'},'permissions'],
 [{type:'StripeConnectionError'},'No checkout was created']
])('explains package price lookup failures without exposing Stripe details: %j',async(error,message)=>{
 const {app,stripe,store}=setup({packagePriceId:'price_package'});
 stripe.prices.retrieve.mockRejectedValue(Object.assign(new Error('private upstream details'),error));
 const res=await app.packageCheckout(request('POST'));const body=await res.json();expect(res.status).toBe(503);expect(body.error).toContain(message);expect(body.error).not.toContain('private upstream');expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it('rejects Product IDs used instead of package Price IDs before contacting Stripe',async()=>{
 const {app,stripe}=setup({packagePriceId:'prod_wrong'});const res=await app.packageCheckout(request('POST'));expect((await res.json()).error).toContain('starting with price_');expect(stripe.prices.retrieve).not.toHaveBeenCalled();
});
it('reports a safe package checkout stage and reference for unknown storage errors',async()=>{
 const logger=vi.fn();const {app,stripe,store}=setup({packagePriceId:'price_package',logger});
 stripe.prices.retrieve.mockResolvedValue({id:'price_package',livemode:false,active:true,type:'one_time',unit_amount:549,currency:'cad'});
 store.reserveCreditOrder=vi.fn().mockRejectedValue(Object.assign(new Error('private database details'),{code:'42501',details:'secret token'}));
 const res=await app.packageCheckout(request('POST'));const body=await res.json();expect(res.status).toBe(503);expect(body.code).toBe('package_checkout_unavailable');expect(body.reference).toMatch(/^[0-9a-f-]{36}$/);
 const log=logger.mock.calls[0][0];expect(log).toContain('order_reservation');expect(log).toContain('42501');expect(log).toContain(body.reference);expect(log).not.toContain('private');expect(log).not.toContain('secret');expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
});
it('accepts package checkout through a Render reverse proxy and saves the public redirect origin',async()=>{
 vi.stubEnv('APP_ORIGIN','https://forma-production.onrender.com');
 try{
  const {app,stripe,store}=setup({packagePriceId:'price_package'});
  stripe.prices.retrieve.mockResolvedValue({id:'price_package',livemode:false,active:true,type:'one_time',unit_amount:549,currency:'cad'});
  store.reserveCreditOrder=vi.fn().mockResolvedValue({id:'22222222-2222-4222-8222-222222222222',owner_id:'owner',stripe_livemode:false,price_id:'price_package',price_amount:549,price_currency:'cad',checkout_origin:'https://forma-production.onrender.com',checkout_expires_at:Math.floor(Date.now()/1000)+3600});store.attachCreditSession=vi.fn();
  const res=await app.packageCheckout(new Request('http://localhost:10000/api/credit-packages/checkout',{method:'POST',headers:{Origin:'https://forma-production.onrender.com','sec-fetch-site':'same-origin'}}));
  expect(res.status).toBe(200);expect(store.reserveCreditOrder).toHaveBeenCalledWith('owner',expect.anything(),'https://forma-production.onrender.com','plus');expect(stripe.checkout.sessions.create.mock.calls[0][0].success_url).toMatch(/^https:\/\/forma-production\.onrender\.com\/gallery/);
 }finally{vi.unstubAllEnvs();}
});
describe('explicit Live payment mode',()=>{
 function live(){const x=setup({stripeMode:'live',packagePriceId:'price_package'});x.store.billingMode.mockResolvedValue('live');x.record.stripe_livemode=true;x.session.livemode=true;x.session.line_items.data[0].price.livemode=true;x.stripe.prices.retrieve.mockResolvedValue({id:'price_live',livemode:true,active:true,type:'one_time',unit_amount:399,currency:'cad'});x.stripe.checkout.sessions.create.mockResolvedValue({id:'cs_live',livemode:true,url:'https://checkout.stripe.com/live'});return x;}
 it('creates a single-image Live checkout only with a matching Live price and database',async()=>{const {app,record,stripe}=live();record.checkout_key=null;record.checkout_session_id=null;expect((await app.checkout(request('POST'),id)).status).toBe(200);expect(stripe.checkout.sessions.create).toHaveBeenCalledTimes(1);});
 it('fulfills a signed Live webhook and keeps payment idempotency in the database path',async()=>{const {app,store,stripe}=live();expect((await app.webhook(eventRequest(stripe,{livemode:true}))).status).toBe(200);expect(store.markPaid).toHaveBeenCalledTimes(1);});
 it('rejects test events in Live mode before retrieving a session',async()=>{const {app,store,stripe}=live();expect((await app.webhook(eventRequest(stripe))).status).toBe(400);expect(store.markPaid).not.toHaveBeenCalled();expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();});
 it('does not fulfill a different-mode session even when the signed event matches Live',async()=>{const {app,store,stripe,session}=live();session.livemode=false;expect((await app.webhook(eventRequest(stripe,{livemode:true}))).status).toBe(500);expect(store.markPaid).not.toHaveBeenCalled();});
 it('rejects environment/database mode mismatch before pricing or checkout',async()=>{const {app,store,stripe}=live();store.billingMode.mockResolvedValue('test');expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(stripe.prices.retrieve).not.toHaveBeenCalled();expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
 it('rejects a test Price even when configured for Live',async()=>{const {app,record,stripe}=live();record.checkout_key=null;record.checkout_session_id=null;stripe.prices.retrieve.mockResolvedValue({livemode:false,active:true,type:'one_time',unit_amount:399,currency:'cad'});expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
 it('does not fulfill old test portraits in a Live deployment',async()=>{const {app,record,store}=live();record.stripe_livemode=false;expect((await app.detail(request(),id)).status).toBe(503);expect(store.markPaid).not.toHaveBeenCalled();});
 it('serves previously unlocked test originals without trying to recharge them',async()=>{const {app,record,stripe}=live();record.payment_state='paid';record.stripe_livemode=false;expect((await app.download(request(),id)).status).toBe(200);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
 it('creates and reconciles a Live credit package without accepting a test record',async()=>{
  const {app,store,stripe}=live();const orderId='22222222-2222-4222-8222-222222222222';
  const order={id:orderId,owner_id:'owner',state:'pending',stripe_livemode:true,price_id:'price_live_package',price_amount:549,price_currency:'cad',checkout_origin:'http://localhost:5173',checkout_expires_at:Math.floor(Date.now()/1000)+3600};
  store.reserveCreditOrder=vi.fn().mockResolvedValue(order);store.attachCreditSession=vi.fn();store.creditOrder=vi.fn().mockResolvedValue(order);store.completeCreditOrder=vi.fn().mockImplementation(async()=>{order.state='paid';return true;});
  stripe.prices.retrieve.mockResolvedValue({id:'price_live_package',livemode:true,active:true,type:'one_time',unit_amount:549,currency:'cad'});
  expect((await app.packageCheckout(request('POST'))).status).toBe(200);
  order.checkout_session_id='cs_live';stripe.checkout.sessions.retrieve.mockResolvedValue(financials({id:'cs_live',livemode:true,mode:'payment',payment_status:'paid',status:'complete',client_reference_id:orderId,amount_total:549,currency:'cad',metadata:{kind:'credit_package',order_id:orderId,owner_id:'owner'}},'price_live_package',549));
  expect((await app.packageStatus(request(),orderId)).status).toBe(200);expect(store.completeCreditOrder).toHaveBeenCalledTimes(1);
  order.stripe_livemode=false;expect((await app.packageStatus(request(),orderId)).status).toBe(409);expect(store.completeCreditOrder).toHaveBeenCalledTimes(1);
 });
 it('fails closed on misspelled modes even with an injected Stripe client',async()=>{const {app,stripe}=setup({stripeMode:'LIVE'});expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});
});

it('fulfills a recorded historical USD portrait without rewriting its currency',async()=>{
 const {app,record,session,store}=setup();record.price_currency='usd';session.currency='usd';session.line_items.data[0].currency='usd';session.line_items.data[0].price.currency='usd';expect((await app.detail(request(),id)).status).toBe(200);expect(store.markPaid).toHaveBeenCalledTimes(1);expect(record.price_currency).toBe('usd');
});
it('fulfills a historical USD package against its stored snapshot rather than the new CAD price',async()=>{
 const {app,store,stripe}=setup({packagePriceId:'price_cad'});const orderId='22222222-2222-4222-8222-222222222222';const order={id:orderId,owner_id:'owner',state:'pending',stripe_livemode:false,price_id:'price_usd',price_amount:549,price_currency:'usd',checkout_session_id:'cs_test_1'};
 store.creditOrder=vi.fn().mockResolvedValue(order);store.completeCreditOrder=vi.fn().mockImplementation(async()=>{order.state='paid';return true;});
 stripe.checkout.sessions.retrieve.mockResolvedValue(financials({id:'cs_test_1',livemode:false,mode:'payment',payment_status:'paid',status:'complete',client_reference_id:orderId,amount_total:549,currency:'usd',metadata:{kind:'credit_package',order_id:orderId,owner_id:'owner'}},order.price_id,549));
 expect((await app.packageStatus(request(),orderId)).status).toBe(200);expect(store.completeCreditOrder).toHaveBeenCalledTimes(1);expect(order.price_currency).toBe('usd');
});
it('does not silently reopen a legacy USD package checkout under a CAD-labelled button',async()=>{
 const {app,store,stripe}=setup({packagePriceId:'price_cad'});const orderId='22222222-2222-4222-8222-222222222222';const order={id:orderId,owner_id:'owner',state:'pending',stripe_livemode:false,price_id:'price_usd',price_amount:549,price_currency:'usd',checkout_session_id:'cs_test_1'};
 const session={id:'cs_test_1',livemode:false,mode:'payment',payment_status:'unpaid',status:'open',url:'https://checkout.stripe.com/old',metadata:{kind:'credit_package',order_id:orderId,owner_id:'owner'}};
 store.reserveCreditOrder=vi.fn().mockResolvedValue(order);store.expireCreditOrder=vi.fn().mockResolvedValue();stripe.prices.retrieve.mockResolvedValue({id:'price_cad',livemode:false,active:true,type:'one_time',unit_amount:549,currency:'cad'});stripe.checkout.sessions.retrieve.mockResolvedValue(session);stripe.checkout.sessions.expire.mockResolvedValue({...session,status:'expired'});
 const res=await app.packageCheckout(request('POST'));expect(res.status).toBe(409);expect((await res.json()).error).toContain('changed to CAD');expect(store.expireCreditOrder).toHaveBeenCalledTimes(1);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
});

describe('general promotion codes',()=>{
 it.each([true,false])('preserves reservation promotion opt-in: %s',async enabled=>{
  const {app,record,stripe}=setup();record.checkout_session_id=null;record.promotions_enabled=enabled;
  expect((await app.checkout(request('POST'),id)).status).toBe(200);
  const options=stripe.checkout.sessions.create.mock.calls[0][0];
  if(enabled)expect(options.allow_promotion_codes).toBe(true);else expect(options).not.toHaveProperty('allow_promotion_codes');
 });
 it.each([100,399])('fulfills verified discount %s through signed completion and refresh',async discount=>{
  const {app,record,session,stripe,store}=setup();record.promotions_enabled=true;
  session.amount_total=399-discount;session.total_details.amount_discount=discount;
  session.discounts=[{coupon:'coupon_test',promotion_code:'promo_test'}];
  session.line_items.data[0].amount_discount=discount;session.line_items.data[0].amount_total=399-discount;
  if(discount===399)session.payment_status='no_payment_required';
  expect((await app.webhook(eventRequest(stripe))).status).toBe(200);
  expect(store.markPaid).toHaveBeenCalledWith(record,session,expect.objectContaining({subtotal:399,discount,total:399-discount}));
  expect((await app.detail(request(),id)).status).toBe(200);
  expect(store.markPaid).toHaveBeenCalledTimes(1);
  expect(store.read).toHaveBeenCalledWith('private/original.jpg');
 });
 it('rejects a discounted legacy reservation without granting an original',async()=>{
  const {app,session,stripe,store}=setup();session.amount_total=0;session.payment_status='no_payment_required';
  session.total_details.amount_discount=399;session.discounts=[{promotion_code:'promo_test'}];
  session.line_items.data[0].amount_discount=399;session.line_items.data[0].amount_total=0;
  expect((await app.webhook(eventRequest(stripe))).status).toBe(500);expect(store.markPaid).not.toHaveBeenCalled();
 });
});
