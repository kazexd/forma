import {describe,it,expect,vi} from 'vitest';
import {featureEnabled} from './features.mjs';
import {createReadinessHandler,probeDeployment} from './readiness.mjs';
import {startOptions} from '../../scripts/start.mjs';

describe('deployment safety defaults',()=>{
 it('disables production operations until explicitly enabled',()=>{
  expect(featureEnabled('GENERATION_ENABLED',{NODE_ENV:'production'})).toBe(false);
  expect(featureEnabled('CHECKOUT_ENABLED',{NODE_ENV:'production'})).toBe(false);
  expect(featureEnabled('GENERATION_ENABLED',{NODE_ENV:'development'})).toBe(true);
  expect(featureEnabled('GENERATION_ENABLED',{NODE_ENV:'production',GENERATION_ENABLED:'true'})).toBe(true);
  expect(featureEnabled('GENERATION_ENABLED',{GENERATION_ENABLED:'false'})).toBe(false);
  expect(featureEnabled('GENERATION_ENABLED',{GENERATION_ENABLED:'TRUE'})).toBe(false);
 });
 it('binds to the platform port on every interface',()=>{
  expect(startOptions({PORT:'10000'})).toEqual(['start','--hostname','0.0.0.0','--port','10000']);
  expect(startOptions({})).toContain('5173');
  for(const PORT of ['0','65536','abc','10000; echo secret'])expect(()=>startOptions({PORT})).toThrow('PORT');
 });
});

const functions=['forma_get_credits','forma_reserve_credit_order','forma_complete_credit_order','forma_unlock_portrait','forma_get_generation_allowance','forma_generation_rate_allowed','forma_begin_generation','forma_finish_generation','forma_publish_generation','forma_complete_purchase','forma_claim_portrait_delete','forma_reserve_checkout'];
const env={NODE_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public-test',SUPABASE_SERVICE_ROLE_KEY:'server-test'};
function fetchFixture({publicBucket=false,missingFunction=false,google=true,tableStatus=200}={}){
 return vi.fn(async(url,options)=>{
  expect(options.signal).toBeInstanceOf(AbortSignal);
  if(url.includes('/storage/'))return Response.json({id:'forma-portraits',public:publicBucket});
  if(url.endsWith('/auth/v1/settings'))return Response.json({external:{google}});
  if(url.endsWith('/rest/v1/'))return Response.json({paths:Object.fromEntries(functions.slice(missingFunction?1:0).map(name=>['/rpc/'+name,{}]))});
  return Response.json([],{status:tableStatus});
 });
}
describe('read-only readiness',()=>{
 it('checks private storage, table columns, Google auth and every required function',async()=>{
  const fetcher=fetchFixture();expect(await probeDeployment({env,fetcher})).toBe(true);
  expect(fetcher).toHaveBeenCalledTimes(5);
  for(const [url,options] of fetcher.mock.calls){expect(options.method??'GET').toBe('GET');expect(url).not.toContain('/rpc/');}
 });
 it.each([{publicBucket:true},{missingFunction:true},{google:false},{tableStatus:404}])('rejects incomplete deployment %j',async invalid=>{
  expect(await probeDeployment({env,fetcher:fetchFixture(invalid)})).toBe(false);
 });
 it('requires service credentials and checks enabled-operation configuration without upstream calls',async()=>{
  const fetcher=fetchFixture();expect(await probeDeployment({env:{...env,SUPABASE_SERVICE_ROLE_KEY:''},fetcher})).toBe(false);
  expect(await probeDeployment({env:{...env,GENERATION_ENABLED:'true'},fetcher})).toBe(false);
  expect(await probeDeployment({env:{...env,CHECKOUT_ENABLED:'true'},fetcher})).toBe(false);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('returns only a no-cache boolean even when provider errors contain secrets',async()=>{
  const handler=createReadinessHandler({probe:async()=>{throw new Error('sensitive provider data');}});
  const res=await handler();expect(res.status).toBe(503);expect(await res.json()).toEqual({ready:false});expect(res.headers.get('cache-control')).toBe('no-store');
 });
 it('coalesces concurrent health requests, caches checks and retries after expiry',async()=>{
  let time=1,resolve;const probe=vi.fn().mockImplementationOnce(()=>new Promise(r=>{resolve=r;})).mockResolvedValue(false);
  const handler=createReadinessHandler({probe,now:()=>time});const a=handler(),b=handler();await Promise.resolve();resolve(true);
  expect((await a).status).toBe(200);expect((await b).status).toBe(200);expect(probe).toHaveBeenCalledTimes(1);
  await handler();expect(probe).toHaveBeenCalledTimes(1);time+=30001;expect((await handler()).status).toBe(503);expect(probe).toHaveBeenCalledTimes(2);
 });
});

it('readiness checks only the selected image provider and rejects unknown providers',async()=>{
 const base={...env,GENERATION_ENABLED:'true',TURNSTILE_SECRET_KEY:'secret',NEXT_PUBLIC_TURNSTILE_SITE_KEY:'public',TURNSTILE_HOSTNAME:'example.com'};
 expect(await probeDeployment({env:{...base,IMAGE_PROVIDER:'openrouter',OPENROUTER_API_KEY:'router'},fetcher:fetchFixture()})).toBe(true);
 const fetcher=fetchFixture();
 expect(await probeDeployment({env:{...base,IMAGE_PROVIDER:'openrouter',OPENAI_API_KEY:'direct'},fetcher})).toBe(false);
 expect(await probeDeployment({env:{...base,IMAGE_PROVIDER:'typo',OPENAI_API_KEY:'direct'},fetcher})).toBe(false);
 expect(fetcher).not.toHaveBeenCalled();
});
