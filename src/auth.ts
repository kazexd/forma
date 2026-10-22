import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const url=process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
let client:SupabaseClient|null=null;
// Only a publishable (or legacy anon) key belongs here; never a service-role key.
if(url&&key&&typeof window!=='undefined'){
 try{client=createClient(url,key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:window.location.pathname==='/auth/callback'}});}catch{/* Invalid configuration must not prevent browsing. */}
}
export const supabase=client;
export const authConfigured=Boolean(url&&key);
export async function getAccessToken():Promise<string>{
 if(!supabase)throw new Error('Sign-in is not configured. Follow the Supabase setup in README.');
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session?.access_token)throw new Error('Please sign in with Google before generating a portrait.');
 return data.session.access_token;
}
