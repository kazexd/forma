import {describe,it,expect,vi,afterEach} from 'vitest';
const createClient=vi.hoisted(()=>vi.fn());
vi.mock('@supabase/supabase-js',()=>({createClient}));
afterEach(()=>{vi.unstubAllEnvs();vi.resetModules();createClient.mockReset();});
describe('Supabase browser adapter',()=>{
 it('allows browsing without project configuration but rejects generation',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','');vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','');const auth=await import('./auth');expect(auth.authConfigured).toBe(false);await expect(auth.getAccessToken()).rejects.toThrow('not configured');expect(createClient).not.toHaveBeenCalled();});
 it('uses PKCE and returns a current session token',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','public-key');createClient.mockReturnValue({auth:{getSession:vi.fn().mockResolvedValue({data:{session:{access_token:'fresh-token'}},error:null})}});const auth=await import('./auth');expect(auth.authConfigured).toBe(true);expect(await auth.getAccessToken()).toBe('fresh-token');expect(createClient).toHaveBeenCalledWith('https://example.supabase.co','public-key',expect.objectContaining({auth:expect.objectContaining({flowType:'pkce',autoRefreshToken:true})}));});
 it('rejects expired or absent sessions',async()=>{vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://example.supabase.co');vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','public-key');createClient.mockReturnValue({auth:{getSession:vi.fn().mockResolvedValue({data:{session:null},error:null})}});const auth=await import('./auth');await expect(auth.getAccessToken()).rejects.toThrow('Please sign in');});
});
