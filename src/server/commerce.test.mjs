import {describe,it,expect,vi} from 'vitest';

import Stripe from 'stripe';

import {createCommerce} from './commerce.mjs';

const id='11111111-1111-4111-8111-111111111111';

const row=()=>({id,owner_id:'owner',style:'casual',payment_state:'unpaid',original_path:'private/original.jpg',preview_path:'private/preview.jpg',expires_at:'2035-01-01T00:00:00.000Z',checkout_key:'key',checkout_session_id:'cs_test_1',price_id:'price_test',price_amount:100,price_currency:'usd',checkout_origin:'http://localhost:5173',checkout_expires_at:Math.floor(Date.now()/1000)+1800});

function setup(overrides={}){

 const record=row();

 const store={ready:vi.fn().mockResolvedValue(),get:vi.fn().mockImplementation(async()=>record),read:vi.fn().mockResolvedValue(Buffer.from('JPEG')),reserveCheckout:vi.fn().mockImplementation(async()=>record),attachSession:vi.fn().mockResolvedValue(),clearCheckout:vi.fn().mockResolvedValue(),markPaid:vi.fn().mockImplementation(async()=>{record.payment_state='paid';return true;}),pendingDeletion:vi.fn().mockResolvedValue([]),list:vi.fn().mockResolvedValue([]),claimDelete:vi.fn().mockResolvedValue(true),remove:vi.fn().mockResolvedValue()};

 const session={id:'cs_test_1',livemode:false,mode:'payment',status:'complete',payment_status:'paid',client_reference_id:id,amount_total:100,currency:'usd',metadata:{portrait_id:id,owner_id:'owner',checkout_key:'key'}};

 const stripe={webhooks:new Stripe('sk_test_not_real').webhooks,prices:{retrieve:vi.fn().mockResolvedValue({id:'price_test',livemode:false,active:true,type:'one_time',unit_amount:100,currency:'usd'})},checkout:{sessions:{retrieve:vi.fn().mockResolvedValue(session),create:vi.fn().mockResolvedValue({id:'cs_test_1',livemode:false,url:'https://checkout.stripe.com/c/pay/test'}),expire:vi.fn().mockResolvedValue({...session,status:'expired',payment_status:'unpaid'})}}};

 const verify=vi.fn().mockResolvedValue({id:'owner'});

 const app=createCommerce({store,verify,stripeClient:stripe,priceId:'price_test',webhookSecret:'whsec_test',...overrides});

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

 it('reuses an open session rather than creating a duplicate',async()=>{const {app,stripe}=setup();stripe.checkout.sessions.retrieve.mockResolvedValue({status:'open',url:'https://checkout.stripe.com/test'});const response=await app.checkout(request('POST'),id);expect(response.status).toBe(200);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('uses a server-side fixed price and idempotency key',async()=>{const {app,stripe,record}=setup();record.checkout_session_id=null;const response=await app.checkout(request('POST'),id);expect(response.status).toBe(200);expect(stripe.checkout.sessions.create.mock.calls[0][0]).not.toHaveProperty('payment_method_types');expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({line_items:[{price:'price_test',quantity:1}],metadata:expect.objectContaining({owner_id:'owner',portrait_id:id})}),{idempotencyKey:'portrait-v2-key'});});

 it('does not unlock from a completed checkout while webhook confirmation is pending',async()=>{const {app,store}=setup();expect((await app.checkout(request('POST'),id)).status).toBe(409);expect(store.markPaid).not.toHaveBeenCalled();});

 it('rejects cross-site checkout requests',async()=>{const {app,stripe}=setup();expect((await app.checkout(new Request('http://localhost:5173/api/checkout',{method:'POST',headers:{Origin:'https://evil.example'}}),id)).status).toBe(403);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('does not charge again for an already purchased portrait',async()=>{const {app,record,stripe}=setup();record.payment_state='paid';expect((await app.checkout(request('POST'),id)).status).toBe(409);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();});

 it('rejects recurring, zero-value or live prices',async()=>{for(const invalid of [{type:'recurring'},{unit_amount:0},{livemode:true},{unit_amount:200},{currency:'cad'}]){const {app,record,stripe}=setup();record.checkout_session_id=null;record.checkout_key=null;stripe.prices.retrieve.mockResolvedValue({id:'price_test',livemode:false,active:true,type:'one_time',unit_amount:100,currency:'usd',...invalid});expect((await app.checkout(request('POST'),id)).status).toBe(503);expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();}});

});

describe('verified payment fulfillment',()=>{

 it('rejects unsigned or altered webhook bodies',async()=>{const {app,store}=setup();expect((await app.webhook(new Request('http://localhost:5173/webhook',{method:'POST',body:'{}'}))).status).toBe(400);expect(store.markPaid).not.toHaveBeenCalled();});

 it('records payment once despite duplicate signed webhook deliveries',async()=>{const {app,stripe,store}=setup();expect((await app.webhook(eventRequest(stripe))).status).toBe(200);expect((await app.webhook(eventRequest(stripe))).status).toBe(200);expect(store.markPaid).toHaveBeenCalledTimes(1);expect((await app.download(request(),id)).status).toBe(200);});

 it('does not unlock unpaid sessions',async()=>{const {app,stripe,session,store}=setup();session.payment_status='unpaid';await app.webhook(eventRequest(stripe));expect(store.markPaid).not.toHaveBeenCalled();});

 it.each(['amount','currency','owner','key','session'])('does not unlock mismatched %s',async(field)=>{const {app,stripe,session,store}=setup();if(field==='amount')session.amount_total=1;if(field==='currency')session.currency='cad';if(field==='owner')session.metadata.owner_id='other';if(field==='key')session.metadata.checkout_key='other';if(field==='session')session.id='cs_different';expect((await app.webhook(eventRequest(stripe))).status).toBe(500);expect(store.markPaid).not.toHaveBeenCalled();});

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

 it.each(['amount','currency','owner','key','session','portrait','live','unpaid'])('never unlocks an invalid %s session on refresh',async(field)=>{const {app,session,store}=setup();if(field==='amount')session.amount_total=1;if(field==='currency')session.currency='cad';if(field==='owner')session.metadata.owner_id='other';if(field==='key')session.metadata.checkout_key='other';if(field==='session')session.id='other';if(field==='portrait')session.metadata.portrait_id='other';if(field==='live')session.livemode=true;if(field==='unpaid')session.payment_status='unpaid';await app.detail(request(),id);expect(store.markPaid).not.toHaveBeenCalled();});

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
