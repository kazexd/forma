import {describe,it,expect,vi} from 'vitest';
import {createAllowanceHandler} from './allowance.mjs';
import {AccessError} from './access.mjs';
const request=new Request('http://localhost:5173/api/generation-allowance');
describe('generation allowance API',()=>{
 it.each([0,1,3,8,100])('returns the authenticated account balance %i without caching',async remaining=>{const store={billingMode:vi.fn().mockResolvedValue('test'),credits:vi.fn().mockResolvedValue({remaining,unlocks:2,mode:'test'})};const handler=createAllowanceHandler({store,verify:async()=>({id:'owner'})});const res=await handler(request);expect(await res.json()).toEqual({remaining,unlocks:2,mode:'test'});expect(store.credits).toHaveBeenCalledWith('owner');expect(res.headers.get('cache-control')).toBe('no-store');});
 it('requires authentication before reading allowance',async()=>{const store={billingMode:vi.fn().mockResolvedValue('test'),credits:vi.fn()};const res=await createAllowanceHandler({store,verify:async()=>{throw new AccessError('Sign in',401);}})(request);expect(res.status).toBe(401);expect(store.credits).not.toHaveBeenCalled();});
 it('fails closed when the migration is unavailable',async()=>{const res=await createAllowanceHandler({store:{billingMode:async()=>'test',credits:async()=>{throw new Error('missing RPC');}},verify:async()=>({id:'owner'})})(request);expect(res.status).toBe(503);});
});
