// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import request from 'supertest';
import sharp from 'sharp';
import {createApp as createRealApp} from './app.mjs';
const validAuth=()=>({auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'test-user',email:'user@example.com'}},error:null})}});
const createApp=(options={})=>createRealApp({authClient:validAuth(),...options});
const image=await sharp({create:{width:20,height:20,channels:3,background:'#aabbcc'}}).jpeg().toBuffer();
function submit(app,{count=5,style='casual',consent='true',buffer=image,mime='image/jpeg'}={}){
 let query=request(app).post('/api/generate').set('Authorization','Bearer valid-test-token').field('style',style).field('consent',consent);
 for(let i=0;i<count;i++)query=query.attach('photos',buffer,{filename:`reference-${i}.jpg`,contentType:mime});
 return query;
}
const fakeClient=()=>({images:{edit:vi.fn().mockResolvedValue({data:[{b64_json:image.toString('base64')}]})}});
describe('local generation server',()=>{
 it('exposes configuration state without exposing secrets',async()=>{const response=await request(createApp({apiKey:'secret'})).get('/api/health');expect(response.body).toEqual({configured:true,authConfigured:true});expect(response.headers['cache-control']).toBe('no-store');});
 it('returns an actionable error when no key exists',async()=>{const response=await submit(createApp({apiKey:''}));expect(response.status).toBe(503);expect(response.body.error).toContain('OPENAI_API_KEY');});
 it.each(['formal','casual','natural'])('sends five normalized files and requests one %s portrait',async(style)=>{const client=fakeClient();const response=await submit(createApp({client}),{style});expect(response.status).toBe(200);expect(response.body.photos).toHaveLength(1);expect(response.body.photos[0].previewUrl).toMatch(/^data:image\/jpeg;base64,/);const [options,requestOptions]=client.images.edit.mock.calls[0];expect(options.image).toHaveLength(5);expect(options.n).toBe(1);expect(options.model).toBe('gpt-image-2');expect(options.size).toBe('1024x1536');expect(options.prompt).toContain('same person');expect(requestOptions.signal).toBeInstanceOf(AbortSignal);});
 it.each([4,6])('rejects %i files before any paid call',async(count)=>{const client=fakeClient();const response=await submit(createApp({client}),{count});expect(response.status).toBe(400);expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([{style:'unknown'},{consent:'false'},{buffer:Buffer.from('broken')},{mime:'text/plain'}])('rejects invalid input %j',async(input)=>{const client=fakeClient();const response=await submit(createApp({client}),input);expect(response.status).toBe(400);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects oversized files',async()=>{const client=fakeClient();const response=await submit(createApp({client}),{count:1,buffer:Buffer.alloc(10*1024*1024+1)});expect(response.status).toBe(413);expect(client.images.edit).not.toHaveBeenCalled();});
 it('rejects cross-site requests before any paid call',async()=>{const client=fakeClient();const response=await request(createApp({client})).post('/api/generate').set('Origin','https://example.com');expect(response.status).toBe(403);expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([[401,503],[403,503],[429,429],[400,422],[500,502]])('maps upstream %i to %i and hides upstream details',async(upstream,status)=>{const client={images:{edit:vi.fn().mockRejectedValue({status:upstream,message:'sensitive upstream message'})}};const app=createApp({client});const response=await submit(app);expect(response.status).toBe(status);expect(JSON.stringify(response.body)).not.toContain('sensitive');expect(client.images.edit).toHaveBeenCalledTimes(1);const again=await submit(app);expect(again.status).toBe(status);});
 it('rejects an empty upstream image',async()=>{const client={images:{edit:vi.fn().mockResolvedValue({data:[]})}};expect((await submit(createApp({client}))).status).toBe(502);});
 it('prevents simultaneous generation and releases the lock afterwards',async()=>{let finish;const client={images:{edit:vi.fn().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}))}};const app=createApp({client});const pending=submit(app).then(response=>response);await vi.waitFor(()=>expect(client.images.edit).toHaveBeenCalledTimes(1));expect((await submit(app)).status).toBe(429);finish({data:[{b64_json:image.toString('base64')}]});expect((await pending).status).toBe(200);});
});

describe('Supabase authorization',()=>{
 it('fails closed when Supabase is not configured',async()=>{const client=fakeClient();const app=createRealApp({client,supabaseUrl:'',supabaseKey:''});const response=await submit(app);expect(response.status).toBe(503);expect(response.body.error).toContain('Supabase');expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([undefined,'Basic abc','Bearer','Bearer forged token'])('rejects missing or malformed credentials: %s',async(header)=>{const client=fakeClient(),authClient=validAuth();let query=request(createApp({client,authClient})).post('/api/generate');if(header)query=query.set('Authorization',header);query=query.field('style','casual').field('consent','true');for(let i=0;i<5;i++)query=query.attach('photos',image,{filename:`photo-${i}.jpg`,contentType:'image/jpeg'});expect((await query).status).toBe(401);expect(authClient.auth.getUser).not.toHaveBeenCalled();expect(client.images.edit).not.toHaveBeenCalled();});
 it.each([401,403])('rejects an expired or forged session (%i)',async(status)=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:null},error:{status}})}};const response=await submit(createApp({client,authClient}));expect(response.status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();expect(authClient.auth.getUser).toHaveBeenCalledWith('valid-test-token');});
 it('rejects a response with no authenticated user',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:null},error:null})}};expect((await submit(createApp({client,authClient}))).status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();});
 it('fails closed when Supabase is unavailable',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockRejectedValue(new Error('network'))}};expect((await submit(createApp({client,authClient}))).status).toBe(503);expect(client.images.edit).not.toHaveBeenCalled();});
});

describe('anonymous identities',()=>{
 it('does not permit an anonymous Supabase account to generate',async()=>{const client=fakeClient(),authClient={auth:{getUser:vi.fn().mockResolvedValue({data:{user:{id:'anonymous-user',is_anonymous:true}},error:null})}};expect((await submit(createApp({client,authClient}))).status).toBe(401);expect(client.images.edit).not.toHaveBeenCalled();});
});
