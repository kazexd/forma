import {stripeConfiguration} from './stripe-config.mjs';
import {imageConfiguration} from './image-provider.mjs';
import {featureEnabled} from './features.mjs';
import {response,applicationOrigin} from './access.mjs';

const requiredFunctions=['forma_get_credits','forma_reserve_credit_package','forma_complete_credit_order_discounted','forma_unlock_portrait_mode','forma_get_generation_allowance','forma_generation_rate_allowed','forma_begin_generation_mode','forma_finish_generation_restoring','forma_publish_generation','forma_complete_purchase_discounted','forma_claim_portrait_delete','forma_reserve_checkout_mode'];

// Read metadata only: never reserve allowance, generate images, or create payments.
export async function probeDeployment({env=process.env,fetcher=fetch}={}){
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY,publicKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key||!publicKey)return false;
 try{applicationOrigin(env);}catch{return false;}
 const billing=stripeConfiguration(env);if(!billing.valid)return false;
 const image=imageConfiguration(env);
 if(featureEnabled('GENERATION_ENABLED',env)&&(image.invalid||!image.apiKey||!env.TURNSTILE_SECRET_KEY||!env.NEXT_PUBLIC_TURNSTILE_SITE_KEY||!(env.TURNSTILE_HOSTNAME||env.RENDER_EXTERNAL_HOSTNAME)))return false;
 if(featureEnabled('CHECKOUT_ENABLED',env)&&(!billing.keyValid||!env.STRIPE_PRICE_ID||!env.STRIPE_PACKAGE_PRICE_ID||!env.STRIPE_WEBHOOK_SECRET))return false;
 const origin=new URL(url).origin;
 const signal=AbortSignal.timeout(4000);
 const headers={apikey:key,Authorization:'Bearer '+key};
 const [bucket,portraits,allowance,schema,auth,control]=await Promise.all([
  fetcher(origin+'/storage/v1/bucket/forma-portraits',{headers,signal}),
  fetcher(origin+'/rest/v1/forma_portraits?select=id,expires_at,payment_state&limit=0',{headers,signal}),
  fetcher(origin+'/rest/v1/forma_generation_allowance?select=owner_id,remaining&limit=0',{headers,signal}),
  fetcher(origin+'/rest/v1/',{headers:{...headers,Accept:'application/openapi+json'},signal}),
  fetcher(origin+'/auth/v1/settings',{headers:{apikey:publicKey},signal}),
  fetcher(origin+'/rest/v1/forma_billing_control?select=mode&id=eq.true',{headers,signal})
 ]);
 if(![bucket,portraits,allowance,schema,auth,control].every(r=>r.ok))return false;
 const [bucketData,schemaData,authData,controlData]=await Promise.all([bucket.json(),schema.json(),auth.json(),control.json()]);
 return controlData?.length===1&&controlData[0].mode===billing.mode&&bucketData.id==='forma-portraits'&&bucketData.public===false&&authData.external?.google===true&&requiredFunctions.every(name=>!!schemaData.paths?.['/rpc/'+name]);
}

export function createReadinessHandler({probe=probeDeployment,now=Date.now,cacheMs=30000}={}){
 let cached=null,checkedAt=0,pending;
 return async()=>{
  if(cached===null||now()-checkedAt>=cacheMs){
   pending??=Promise.resolve().then(()=>probe()).then(value=>value===true).catch(()=>false).then(ready=>{cached=ready;checkedAt=now();pending=undefined;});
   await pending;
  }
  return response({ready:cached},cached?200:503);
 };
}
export const GET=createReadinessHandler();
