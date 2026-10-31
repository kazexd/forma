import {describe,it,expect,vi} from 'vitest';
import sharp from 'sharp';
import {createHandlers} from './portraits.mjs';
import {MAX_REQUEST_BYTES} from './uploads.mjs';
const image=await sharp({create:{width:20,height:20,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
const validAuth=()=>({auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'test-user'}},error:null})}});
const fakeClient=()=>({images:{edit:vi.fn().mockResolvedValue({data:[{b64_json:image.toString('base64')}]})}});
const fakeStore=()=>({ready:vi.fn().mockResolvedValue(),reserveAttempt:vi.fn().mockResolvedValue(true),save:vi.fn().mockResolvedValue()});
const setup=(options={})=>createHandlers({authClient:validAuth(),store:fakeStore(),...options});
function request({count=5,style='casual',consent='true',buffer=image,mime='image/jpeg',authorization='Bearer valid-token',headers={},signal,extraFields=[]}={}){
 const form=new FormData();form.append('style',style);form.append('consent',consent);
 for(const [key,value] of extraFields)form.append(key,value);
 for(let i=0;i<count;i++)form.append('photos',new Blob([buffer],{type:mime}),`photo-${i}.jpg`);
 return new Request('http://localhost:5173/api/generate',{method:'POST',body:form,headers:{...(authorization?{Authorization:authorization}:{}),...headers},signal});
}
async function submit(handlers,options){const response=await handlers.POST(request(options));return {status:response.status,body:await response.json(),headers:response.headers};}
describe('Next.js portrait API',()=>{
 it('exposes configuration booleans without secrets and disables caching',async()=>{const response=await setup({apiKey:'secret'}).GET();expect(await response.json()).toEqual({configured:true,authConfigured:true});expect(response.headers.get('cache-control')).toBe('no-store');});
 it('reports a missing OpenAI key',async()=>{const result=await submit(setup({apiKey:''}));expect(result.status).toBe(503);expect(result.body.error).toContain('OPENAI_API_KEY');});
 it.each(['formal','casual','natural'])('normalizes five images and generates one %s portrait',async(style)=>{const client=fakeClient(),authClient=validAuth();const result=await submit(setup({client,authClient}),{style});expect(result.status).toBe(200);expect(result.body.photos).toHaveLength(1);expect(result.body.photos[0].previewUrl).toMatch(/^data:image\/jpeg;base64,/);expect(result.body.photos[0].downloadFilename).toContain(style);const [options,reqOptions]=client.images.edit.mock.calls[0];expect(options.image).toHaveLength(5);expect(options.n).toBe(1);expect(options.size).toBe('1024x1536');expect(options.prompt).toContain('same person');expect(reqOptions.signal).toBeInstanceOf(AbortSignal);expect(authClient.auth.getUser).toHaveBeenCalledWith('valid-token');});
 it.each([0,4,6])('rejects %i files',async(count)=>{const client=fakeClient();expect((await submit(setup({client}),{count})).status).toBe(400);expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([{style:'unknown'},{consent:'false'},{buffer:Buffer.from('bad')},{mime:'text/plain'},{extraFields:[['style','formal']]},{extraFields:[['extra','value']]}])('rejects invalid input %j',async(options)=>{const client=fakeClient();expect((await submit(setup({client}),options)).status).toBe(400);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects oversized files and releases the generation slot',async()=>{const client=fakeClient(),handlers=setup({client});expect((await submit(handlers,{count:1,buffer:Buffer.alloc(10*1024*1024+1)})).status).toBe(413);expect(client.images.edit).not.toHaveBeenCalled();expect((await submit(handlers)).status).toBe(200);});
 it('enforces the total byte limit without trusting Content-Length',async()=>{const client=fakeClient(),handlers=setup({client});const bytes=new Uint8Array(1024*1024);let i=0;const stream=new ReadableStream({pull(controller){if(i++<52)controller.enqueue(bytes);else controller.close();}});const req=new Request('http://localhost:5173/api/generate',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'multipart/form-data; boundary=test'},body:stream,duplex:'half'});expect((await handlers.POST(req)).status).toBe(413);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects a declared oversized upload before parsing',async()=>{const client=fakeClient();expect((await submit(setup({client}),{headers:{'Content-Length':String(MAX_REQUEST_BYTES+1)}})).status).toBe(413);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects malformed multipart bodies',async()=>{const response=await setup({client:fakeClient()}).POST(new Request('http://localhost:5173/api/generate',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'multipart/form-data; boundary=missing'},body:'bad'}));expect(response.status).toBe(400);});
 it('rejects requests with the wrong content type',async()=>{const response=await setup({client:fakeClient()}).POST(new Request('http://localhost:5173/api/generate',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:'{}'}));expect(response.status).toBe(400);});
 it('rejects cross-site requests',async()=>{const client=fakeClient();expect((await submit(setup({client}),{headers:{Origin:'https://example.com'}})).status).toBe(403);expect(client.images.edit).not.toHaveBeenCalled();});
 it('accepts same-origin requests',async()=>expect((await submit(setup({client:fakeClient()}),{headers:{Origin:'http://localhost:5173'}})).status).toBe(200));
 it.each([[401,503],[403,503],[429,429],[400,422],[500,502]])('maps upstream %i to %i',async(upstream,status)=>{const client={images:{edit:vi.fn().mockRejectedValue({status:upstream,message:'sensitive upstream details'})}},handlers=setup({client});const result=await submit(handlers);expect(result.status).toBe(status);expect(JSON.stringify(result.body)).not.toContain('sensitive');expect(client.images.edit).toHaveBeenCalledTimes(1);expect((await submit(handlers)).status).toBe(status);});
 it('handles missing upstream image output',async()=>expect((await submit(setup({client:{images:{edit:vi.fn().mockResolvedValue({data:[]})}}}))).status).toBe(502));
 it('handles timeouts without retrying',async()=>{const client={images:{edit:vi.fn().mockRejectedValue({name:'APIConnectionTimeoutError'})}};expect((await submit(setup({client}))).status).toBe(504);expect(client.images.edit).toHaveBeenCalledTimes(1);});
 it('allows only one generation at a time',async()=>{let finish;const client={images:{edit:vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}))}},handlers=setup({client});const pending=submit(handlers);await vi.waitFor(()=>expect(client.images.edit).toHaveBeenCalledTimes(1));expect((await submit(handlers)).status).toBe(429);finish({data:[{b64_json:image.toString('base64')}]});expect((await pending).status).toBe(200);});
});
describe('Supabase authorization',()=>{
 it('fails closed without Supabase configuration',async()=>{const client=fakeClient();const result=await submit(createHandlers({client,supabaseUrl:'',supabaseKey:''}));expect(result.status).toBe(503);expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([null,'Basic abc','Bearer','Bearer forged token'])('rejects malformed credentials: %s',async(authorization)=>{const client=fakeClient(),authClient=validAuth();expect((await submit(setup({client,authClient}),{authorization})).status).toBe(401);expect(authClient.auth.getUser).not.toHaveBeenCalled();expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([401,403])('rejects invalid Supabase sessions (%i)',async(status)=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:null},error:{status}})}};expect((await submit(setup({client,authClient}))).status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects anonymous identities',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'anon',is_anonymous:true}},error:null})}};expect((await submit(setup({client,authClient}))).status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects absent user records',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:null},error:null})}};expect((await submit(setup({client,authClient}))).status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();});
 it('fails closed on verification outages',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockRejectedValue(new Error('network'))}};expect((await submit(setup({client,authClient}))).status).toBe(503);expect(client.images.edit).not.toHaveBeenCalled();});
});

describe('loopback request origins',()=>{
 it('allows the existing 127.0.0.1 browser origin when Next normalizes its URL to localhost',async()=>{const client=fakeClient();expect((await submit(setup({client}),{headers:{Origin:'http://127.0.0.1:5173'}})).status).toBe(200);});
 it('still rejects local requests from an unrelated port',async()=>{const client=fakeClient();expect((await submit(setup({client}),{headers:{Origin:'http://localhost:9999'}})).status).toBe(403);expect(client.images.edit).not.toHaveBeenCalled();});
});

describe('multipart boundary sizes',()=>{
 it('accepts an exactly 10 MiB file at the parser boundary',async()=>{const {parseUpload}=await import('./uploads.mjs');const form=new FormData();form.append('style','casual');form.append('consent','true');form.append('photos',new Blob([Buffer.alloc(10*1024*1024)],{type:'image/jpeg'}),'large.jpg');for(let i=0;i<4;i++)form.append('photos',new Blob([image],{type:'image/jpeg'}),'small.jpg');const upload=await parseUpload(new Request('http://localhost:5173/api/generate',{method:'POST',body:form}));expect(upload.files).toHaveLength(5);expect(upload.files[0].buffer.length).toBe(10*1024*1024);});
 it('rejects a declared MIME type that does not match decoded pixels',async()=>{const client=fakeClient();expect((await submit(setup({client}),{mime:'image/png'})).status).toBe(400);expect(client.images.edit).not.toHaveBeenCalled();});
});

describe('OpenAI quota and rate limit guidance',()=>{
 it.each([
  [{code:'credit_balance_exhausted'},'credit balance is exhausted'],
  [{code:'organization_spend_limit_exceeded'},'organization spend limit'],
  [{code:'project_spend_limit_exceeded'},'project spend limit'],
  [{code:'organization_usage_limit_exceeded'},'organization usage limit'],
  [{code:'insufficient_quota'},'quota is unavailable'],
  [{type:'insufficient_quota'},'quota is unavailable'],
  [{code:'rate_limit_exceeded'},'temporary rate limit'],
  [{code:'slow_down'},'temporary rate limit'],
  [{type:'rate_limit_error'},'temporary rate limit'],
  [{error:{code:'credit_balance_exhausted',type:'insufficient_quota'}},'credit balance is exhausted'],
  [{code:'unknown'},'Check API Billing and Limits']
 ])('returns actionable guidance for %j without exposing upstream details or retrying',async(details,expected)=>{
  const client={images:{edit:vi.fn().mockRejectedValue({status:429,...details,message:'private upstream details',request_id:'private-id'})}};
  const result=await submit(setup({client}));
  expect(result.status).toBe(429);expect(result.body.error).toContain(expected);
  expect(JSON.stringify(result.body)).not.toContain('private');expect(client.images.edit).toHaveBeenCalledTimes(1);
 });
});

describe('reference image dimensions',()=>{
 it.each([[2048,1536,1024,768],[1536,2048,768,1024],[320,240,320,240]])('prepares a %i × %i reference as %i × %i without upscaling',async(width,height,expectedWidth,expectedHeight)=>{
  const buffer=await sharp({create:{width,height,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
  const client=fakeClient();
  const result=await submit(setup({client}),{buffer});
  expect(result.status).toBe(200);
  const [options]=client.images.edit.mock.calls[0];
  for(const file of options.image){
   const metadata=await sharp(Buffer.from(await file.arrayBuffer())).metadata();
   expect(metadata.width).toBe(expectedWidth);expect(metadata.height).toBe(expectedHeight);expect(metadata.format).toBe('jpeg');
  }
  expect(options.size).toBe('1024x1536');expect(options.quality).toBe('medium');
 });
});

describe('private original persistence',()=>{
 it('returns different watermarked image bytes and never includes original paths',async()=>{const client=fakeClient(),store=fakeStore();const result=await submit(setup({client,store}));expect(result.status).toBe(200);expect(result.body.photos[0].watermarked).toBe(true);expect(result.body.photos[0].paid).toBe(false);expect(result.body.photos[0].previewUrl).not.toBe('data:image/jpeg;base64,'+image.toString('base64'));expect(store.save).toHaveBeenCalledWith(expect.objectContaining({owner_id:'test-user'}),expect.any(Buffer),expect.any(Buffer));expect(JSON.stringify(result.body)).not.toContain('original_path');});
 it('fails before OpenAI when storage is missing',async()=>{const client=fakeClient();expect((await submit(setup({client,store:null}))).status).toBe(503);expect(client.images.edit).not.toHaveBeenCalled();});
 it('fails before OpenAI when storage is public or unavailable',async()=>{const client=fakeClient(),store=fakeStore();store.ready.mockRejectedValue(new Error('public'));expect((await submit(setup({client,store}))).status).toBe(503);expect(client.images.edit).not.toHaveBeenCalled();});
 it('enforces the shared user allowance before a paid generation',async()=>{const client=fakeClient(),store=fakeStore();store.reserveAttempt.mockResolvedValue(false);expect((await submit(setup({client,store}))).status).toBe(429);expect(client.images.edit).not.toHaveBeenCalled();});
 it('never leaks the generated original when persistence fails',async()=>{const client=fakeClient(),store=fakeStore();store.save.mockRejectedValue(new Error('storage'));const result=await submit(setup({client,store}));expect(result.status).toBe(503);expect(result.body.error).toContain('Do not regenerate');expect(JSON.stringify(result.body)).not.toContain(image.toString('base64'));});
});


describe('purchase-reset allowance consumption',()=>{
 it('returns a stable exhausted code and never invokes OpenAI',async()=>{const store=fakeStore(),client=fakeClient();store.reserveAttempt.mockResolvedValue(false);const res=await submit(setup({store,client}));expect(res.status).toBe(429);expect(res.body.code).toBe('generation_allowance_exhausted');expect(client.images.edit).not.toHaveBeenCalled();expect(store.reserveAttempt).toHaveBeenCalledWith('test-user');});
 it('does not consume attempts for invalid uploads',async()=>{const store=fakeStore();await submit(setup({store,client:fakeClient()}),{count:4});expect(store.reserveAttempt).not.toHaveBeenCalled();});
 it('consumes a slot for failed upstream generation',async()=>{const store=fakeStore(),client=fakeClient();client.images.edit.mockRejectedValue(new Error('upstream'));await submit(setup({store,client}));expect(store.reserveAttempt).toHaveBeenCalledTimes(1);});
});
