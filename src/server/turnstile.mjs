export class VerificationError extends Error{
 constructor(message,status=403){super(message);this.status=status;}
}
export function createTurnstileVerifier({env=process.env,fetcher=fetch}={}){
 const required=env.NODE_ENV==='production'||!!env.TURNSTILE_SECRET_KEY||!!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
 const hostname=env.TURNSTILE_HOSTNAME||env.RENDER_EXTERNAL_HOSTNAME;
 return async(token,requestId)=>{
  if(!required)return;
  if(!env.TURNSTILE_SECRET_KEY||!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY||!hostname)throw new VerificationError('Human verification is not configured. Please try again later.',503);
  if(typeof token!=='string'||!token||token.length>2048)throw new VerificationError('Complete the human verification before generating.');
  let data;
  try{
   const res=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET_KEY,response:token,idempotency_key:requestId}),signal:AbortSignal.timeout(10000)});
   if(!res.ok)throw new Error('Verification service unavailable');
   data=await res.json();
  }catch{throw new VerificationError('Human verification is temporarily unavailable. Please try again.',503);}
  if(data.success!==true||data.hostname!==hostname||data.action!=='generate_portrait')throw new VerificationError('Human verification expired or failed. Please complete it again.');
 };
}
