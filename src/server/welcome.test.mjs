import {describe,it,expect,vi} from 'vitest';
import {createWelcomeHandler} from './welcome.mjs';
import {AccessError} from './access.mjs';
const request=(method='GET',headers={})=>new Request('http://127.0.0.1:5173/api/account-welcome',{method,headers});
function setup(pending=true){const store={welcomePending:vi.fn().mockResolvedValue(pending),acknowledgeWelcome:vi.fn().mockResolvedValue()};return{store,handler:createWelcomeHandler({store,verify:async()=>({id:'owner'})})};}
describe('account welcome',()=>{
 it.each([true,false])('returns only the current account eligibility: %s',async pending=>{const {store,handler}=setup(pending);const res=await handler(request());expect(await res.json()).toEqual({welcome:pending,freeAttempts:3});expect(store.welcomePending).toHaveBeenCalledWith('owner');expect(res.headers.get('cache-control')).toBe('no-store');});
 it('acknowledges only the authenticated account, ignoring submitted identity',async()=>{const {store,handler}=setup();const res=await handler(new Request('http://127.0.0.1:5173/api/account-welcome',{method:'POST',body:JSON.stringify({owner:'other'})}));expect(res.status).toBe(200);expect(store.acknowledgeWelcome).toHaveBeenCalledWith('owner');});
 it('rejects cross-site acknowledgement',async()=>{const {store,handler}=setup();expect((await handler(request('POST',{Origin:'https://evil.example'}))).status).toBe(403);expect(store.acknowledgeWelcome).not.toHaveBeenCalled();});
 it('requires authentication',async()=>{const {store}=setup();const handler=createWelcomeHandler({store,verify:async()=>{throw new AccessError('Sign in',401);}});expect((await handler(request())).status).toBe(401);expect(store.welcomePending).not.toHaveBeenCalled();});
 it('does not acknowledge when persistence fails',async()=>{const {store,handler}=setup();store.acknowledgeWelcome.mockRejectedValue(new Error('database private error'));const res=await handler(request('POST'));expect(res.status).toBe(503);expect(await res.text()).not.toContain('private error');});
});
