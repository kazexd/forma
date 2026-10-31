import {createClient} from '@supabase/supabase-js';
export const response=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export class AccessError extends Error{constructor(message,status){super(message);this.status=status;}}
export function createVerifier(client){
 let auth=client;
 if(!auth&&process.env.NEXT_PUBLIC_SUPABASE_URL&&process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});
 return async request=>{
  const token=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'')?.[1];
  if(!token)throw new AccessError('Please sign in with Google.',401);
  if(!auth)throw new AccessError('Sign-in is not configured.',503);
  let result;try{result=await auth.auth.getUser(token);}catch{throw new AccessError('Sign-in verification is unavailable.',503);}
  if(result.error){if(!result.error.status||result.error.status>=500)throw new AccessError('Sign-in verification is unavailable.',503);throw new AccessError('Please sign in again.',401);}
  if(!result.data?.user?.id||result.data.user.is_anonymous)throw new AccessError('Please sign in again.',401);
  return result.data.user;
 };
}
export function checkOrigin(request){
 const url=new URL(request.url),allowed=new Set([url.origin]);
 if(['localhost','127.0.0.1'].includes(url.hostname)){allowed.add('http://localhost:5173');allowed.add('http://127.0.0.1:5173');}
 const origin=request.headers.get('origin');
 if((origin&&!allowed.has(origin))||request.headers.get('sec-fetch-site')==='cross-site')throw new AccessError('Cross-site requests are not allowed.',403);
 return origin??url.origin;
}
export function validId(id){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw new AccessError('Portrait not found.',404);}
