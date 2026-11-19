import {describe,it,expect,vi} from 'vitest';
import {createTurnstileVerifier} from './turnstile.mjs';
const env={NODE_ENV:'production',TURNSTILE_SECRET_KEY:'private-test',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'public-test',TURNSTILE_HOSTNAME:'forma.example'};
const requestId='11111111-1111-4111-8111-111111111111';
describe('server-side human verification',()=>{
 it('validates the token, exact hostname and action with a bounded provider request',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({success:true,hostname:'forma.example',action:'generate_portrait'}));
  await createTurnstileVerifier({env,fetcher})('token',requestId);
  const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');expect(options.signal).toBeInstanceOf(AbortSignal);expect(JSON.parse(options.body)).toEqual({secret:'private-test',response:'token',idempotency_key:requestId});
 });
 it.each([{success:false,hostname:'forma.example',action:'generate_portrait'},{success:true,hostname:'evil.example',action:'generate_portrait'},{success:true,hostname:'forma.example',action:'login'}])('rejects forged, expired, or mismatched verification %j',async result=>{
  await expect(createTurnstileVerifier({env,fetcher:async()=>Response.json(result)})('token',requestId)).rejects.toMatchObject({status:403});
 });
 it('rejects missing/oversized tokens without calling Cloudflare',async()=>{
  const fetcher=vi.fn();const verify=createTurnstileVerifier({env,fetcher});for(const token of [null,'','x'.repeat(2049)])await expect(verify(token,requestId)).rejects.toMatchObject({status:403});expect(fetcher).not.toHaveBeenCalled();
 });
 it('fails closed for missing production settings and provider outages',async()=>{
  await expect(createTurnstileVerifier({env:{NODE_ENV:'production'}})('token',requestId)).rejects.toMatchObject({status:503});
  await expect(createTurnstileVerifier({env,fetcher:async()=>{throw new Error('secret provider details');}})('token',requestId)).rejects.toMatchObject({status:503,message:'Human verification is temporarily unavailable. Please try again.'});
 });
 it('allows unconfigured local development only and uses the Render hostname fallback',async()=>{
  await expect(createTurnstileVerifier({env:{NODE_ENV:'development'}})(null,requestId)).resolves.toBeUndefined();
  await expect(createTurnstileVerifier({env:{...env,TURNSTILE_HOSTNAME:'',RENDER_EXTERNAL_HOSTNAME:'forma.example'},fetcher:async()=>Response.json({success:true,hostname:'forma.example',action:'generate_portrait'})})('token',requestId)).resolves.toBeUndefined();
 });
});
