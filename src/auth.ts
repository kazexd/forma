import {createClient, type SupabaseClient} from '@supabase/supabase-js';

const url=import.meta.env.VITE_SUPABASE_URL?.trim();
const key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
let client:SupabaseClient|null=null;
// Only a publishable (or legacy anon) key belongs here; never a service-role key.
if(url&&key){
 try{client=createClient(url,key,{auth:{flowType:'pkce',persistSession:true,autoRefreshToken:true,detectSessionInUrl:window.location.pathname==='/auth/callback'}});}catch{/* Invalid configuration must not prevent browsing. */}
}
export const supabase=client;
export const authConfigured=Boolean(client);
export async function getAccessToken():Promise<string>{
 if(!supabase)throw new Error('Sign-in is not configured. Follow the Supabase setup in README.');
 const {data,error}=await supabase.auth.getSession();
 if(error||!data.session?.access_token)throw new Error('Please sign in with Google before generating a portrait.');
 return data.session.access_token;
}
