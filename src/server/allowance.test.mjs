import {describe,it,expect,vi} from 'vitest';
import {createAllowanceHandler} from './allowance.mjs';
import {AccessError} from './access.mjs';
const request=new Request('http://localhost:5173/api/generation-allowance');
describe('generation allowance API',()=>{
 it.each([0,1,3])('returns the authenticated account balance %i without caching',async remaining=>{const store={allowance:vi.fn().mockResolvedValue(remaining)};const handler=createAllowanceHandler({store,verify:async()=>({id:'owner'})});const res=await handler(request);expect(await res.json()).toEqual({remaining,limit:3});expect(store.allowance).toHaveBeenCalledWith('owner');expect(res.headers.get('cache-control')).toBe('no-store');});
 it('requires authentication before reading allowance',async()=>{const store={allowance:vi.fn()};const res=await createAllowanceHandler({store,verify:async()=>{throw new AccessError('Sign in',401);}})(request);expect(res.status).toBe(401);expect(store.allowance).not.toHaveBeenCalled();});
 it('fails closed when the migration is unavailable',async()=>{const res=await createAllowanceHandler({store:{allowance:async()=>{throw new Error('missing RPC');}},verify:async()=>({id:'owner'})})(request);expect(res.status).toBe(503);});
});
