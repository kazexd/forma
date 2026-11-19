import {describe,it,expect,vi} from 'vitest';
import {createGenerationStatus} from './generation-status.mjs';
import {AccessError} from './access.mjs';
const id='11111111-1111-4111-8111-111111111111',request=new Request('https://forma.example/api/generation-requests/'+id);
describe('private generation status',()=>{
 it.each(['running','succeeded','failed','uncertain'])('returns sanitized %s status without changing allowance',async status=>{
  const store={generationRequest:vi.fn().mockResolvedValue({id,status,portrait_id:status==='succeeded'?id:null,lease_until:'2099-01-01',fingerprint:'sensitive',owner_id:'owner'})};
  const res=await createGenerationStatus({store,verify:async()=>({id:'owner'})})(request,id);
  expect(await res.json()).toEqual({request:{id,status,portraitId:status==='succeeded'?id:null,attemptRestored:false}});expect(store.generationRequest).toHaveBeenCalledWith('owner',id);expect(res.headers.get('cache-control')).toBe('no-store');
 });
 it('reports an expired running lease as uncertain, never restarting it',async()=>{
  const handler=createGenerationStatus({store:{generationRequest:async()=>({id,status:'running',portrait_id:null,lease_until:'2000-01-01'})},verify:async()=>({id:'owner'})});
  expect((await (await handler(request,id)).json()).request.status).toBe('uncertain');
 });
 it('requires authentication and hides another user request',async()=>{
  const store={generationRequest:vi.fn().mockResolvedValue(null)};
  expect((await createGenerationStatus({store,verify:async()=>{throw new AccessError('Sign in',401);}})(request,id)).status).toBe(401);expect(store.generationRequest).not.toHaveBeenCalled();
  expect((await createGenerationStatus({store,verify:async()=>({id:'other'})})(request,id)).status).toBe(404);
 });
});

it('reports confirmed restoration without exposing its private audit timestamp',async()=>{
 const stamp='2026-11-19T12:00:00Z';const handler=createGenerationStatus({store:{generationRequest:async()=>({id,status:'failed',portrait_id:null,restored_at:stamp})},verify:async()=>({id:'owner'})});const res=await handler(request,id);const body=await res.json();expect(body.request.attemptRestored).toBe(true);expect(JSON.stringify(body)).not.toContain(stamp);
});
