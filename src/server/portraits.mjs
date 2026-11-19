import {featureEnabled} from './features.mjs';
import sharp from 'sharp';
import {toFile} from 'openai';
import {imageConfiguration,createImageClient} from './image-provider.mjs';
import {createHash} from 'node:crypto';
import {createTurnstileVerifier,VerificationError} from './turnstile.mjs';
import {createClient} from '@supabase/supabase-js';
import {parseUpload,UploadError} from './uploads.mjs';
import {createPortraitStore} from './portrait-store.mjs';
import {watermarkPreview} from './watermark.mjs';

const looks={
 formal:'Tailored dark business suit with a simple neutral shirt, understated gray studio backdrop, elegant studio lighting.',
 casual:'Smart business casual clothing, an unstructured blazer and simple shirt, warm neutral studio backdrop, soft flattering light.',
 natural:'Simple professional clothing, soft window light and a softly blurred natural background, approachable and relaxed.'
};
const mimeFormats={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status)=>json({error:message},status);
export function createHandlers({configuration=imageConfiguration(),apiKey=configuration.apiKey,model=configuration.model,provider=configuration.provider,client,
 supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,authClient,
 store=createPortraitStore(),generationEnabled=featureEnabled('GENERATION_ENABLED'),verifyHuman=createTurnstileVerifier()}={}){
 let auth=authClient;
 if(!auth&&supabaseUrl&&supabaseKey){try{auth=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});}catch{/* Fail closed. */}}
 // Also bound upload/decode memory within each process; Postgres gates every upstream call globally.
 let active=false;
 async function GET(){return json({configured:Boolean(apiKey||client),authConfigured:Boolean(auth)});}
 async function POST(request){
  if(!generationEnabled)return fail('Portrait generation is temporarily unavailable. Please try again later.',503);
  const origin=request.headers.get('origin');
  const requestUrl=new URL(request.url);
  const allowedOrigins=new Set([requestUrl.origin]);
  // Next may normalize a loopback URL to localhost internally, even when the
  // browser uses 127.0.0.1. Both existing OAuth origins must continue to work.
  if(['localhost','127.0.0.1'].includes(requestUrl.hostname)){
   allowedOrigins.add('http://localhost:5173');allowedOrigins.add('http://127.0.0.1:5173');
  }
  if((origin&&!allowedOrigins.has(origin))||request.headers.get('sec-fetch-site')==='cross-site')return fail('Cross-site requests are not allowed.',403);
  if(!auth)return fail('Google sign-in is not configured. Set the Supabase environment variables and restart the app.',503);
  const match=/^Bearer ([^\s]+)$/i.exec(request.headers.get('authorization')??'');
  if(!match)return fail('Please sign in with Google before generating a portrait.',401);
  let owner;
  try{
   const {data,error}=await auth.auth.getUser(match[1]);
   if(error){if(error.status>=500||!error.status)return fail('Sign-in verification is temporarily unavailable. Please try again.',503);return fail('Your sign-in has expired or is invalid. Please sign in again.',401);}
   if(!data?.user?.id)return fail('Your sign-in has expired or is invalid. Please sign in again.',401);
   if(data.user.is_anonymous)return fail('Please sign in with Google before generating a portrait.',401);
   owner=data.user.id;
  }catch{return fail('Sign-in verification is temporarily unavailable. Please try again.',503);}
  if(!['openai','openrouter'].includes(provider))return fail('IMAGE_PROVIDER must be openai or openrouter.',503);
  if(configuration.invalid)return fail('The configured image model is not supported. Check OPENROUTER_IMAGE_MODEL.',503);
  if(!apiKey&&!client)return fail(`${configuration.label} is not configured. Set ${configuration.keyName} and restart the app.`,503);
  if(!store)return fail('Private portrait storage is not configured. Complete the Supabase storage setup before generating.',503);
  try{await store.ready();}catch{return fail('Private portrait storage is unavailable. Check the migration and private bucket before generating.',503);}
  if(active)return fail('A portrait is already being generated. Please wait before trying again.',429);
  active=true;
  let files=[],accepted=false,requestId;
  async function attemptFailure(message,status,uncertain=false){
   if(accepted){try{await store.finishGeneration(owner,requestId,uncertain);}catch{uncertain=true;}}
   return json({error:message,code:accepted?(uncertain?'generation_uncertain':'generation_failed'):'generation_unavailable',requestId},status);
  }
  async function replay(job){
   if(job.status==='succeeded'){
    if(!job.portrait_id)return json({error:'This generated portrait has been deleted.',code:'generation_deleted',requestId},410);
    const row=await store.get(job.portrait_id);
    if(!row||row.owner_id!==owner||row.payment_state==='deleting')return json({error:'This generated portrait is no longer available.',code:'generation_deleted',requestId},410);
    const preview=await store.read(row.preview_path);
    return json({photos:[{id:row.id,previewUrl:`data:image/jpeg;base64,${preview.toString('base64')}`,downloadFilename:`forma-${row.style}-preview.jpg`,style:row.style,paid:false,watermarked:true,expiresAt:null}],requestId});
   }
   return json({error:job.status==='failed'?'This attempt failed and was counted. Start a new attempt when ready.':'This attempt may still be processing. Check its status before starting another.',code:job.status==='failed'?'generation_failed':job.status==='uncertain'||Date.parse(job.lease_until)<=Date.now()?'generation_uncertain':'generation_in_progress',requestId},409);
  }
  try{
   requestId=request.headers.get('idempotency-key');
   if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId??''))return fail('A valid generation request ID is required.',400);
   requestId=requestId.toLowerCase();
   if(!await store.generationRateAllowed(owner))return json({error:'Too many generation requests. Wait a minute before trying again.',code:'generation_rate_limited'},429);
   const existing=await store.generationRequest(owner,requestId);
   const humanToken=request.headers.get('x-turnstile-token');
   if(!existing)await verifyHuman(humanToken,requestId);
   const upload=await parseUpload(request);files=upload.files;
   const style=upload.fields.style;
   if(upload.fields.consent!=='true')return fail('Please confirm that you may use these photos and send them to the configured image provider.',400);
   if(!Object.hasOwn(looks,style))return fail('Please choose a supported portrait style.',400);
   const images=[];
   for(const file of files){
    try{
     const input=sharp(file.buffer,{limitInputPixels:40_000_000,animated:false,failOn:'warning'});
     const metadata=await input.metadata();
     if(metadata.format!==mimeFormats[file.mimetype]||(metadata.pages??1)>1)throw new Error('Unsupported content');
     const buffer=await input.rotate().resize({width:1024,height:1024,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
     images.push(await toFile(buffer,`reference-${images.length+1}.jpg`,{type:'image/jpeg'}));
    }catch{return fail('One of your photos could not be read. Use non-animated JPEG, PNG or WebP photos under 40 megapixels.',400);}
   }
   const hash=createHash('sha256').update(style);
   for(const file of files){hash.update(String(file.buffer.length)+':');hash.update(file.buffer);}
   const fingerprint=hash.digest('hex');
   if(existing){if(existing.fingerprint!==fingerprint||existing.style!==style)return json({error:'This request ID belongs to different photos or a different style.',code:'request_conflict'},409);return await replay(existing);}
   if(request.signal.aborted)return fail('Generation was cancelled before starting.',499);
   let reservation;
   try{reservation=await store.beginGeneration(owner,requestId,style,fingerprint,humanToken?createHash('sha256').update(humanToken).digest('hex'):null);}
   catch{return json({error:'Could not confirm whether generation started. Check this request status before trying again.',code:'generation_uncertain',requestId},503);}
   const denied={allowance_exhausted:['No generation attempts remain. Buy a credit package to add generation attempts.','generation_allowance_exhausted',429],daily_limit:['The daily site generation limit has been reached. Try again after midnight UTC.','site_generation_limit',429],busy:['A portrait is already being generated. Please wait before trying again.','generation_busy',429],paused:['Portrait generation is temporarily unavailable.','generation_paused',503],storage_limit:['New portrait generation is paused because storage is near its limit. Existing portraits remain available.','generation_storage_limit',503],verification_reused:['Human verification has already been used. Please complete it again.','human_verification_failed',403],request_conflict:['This request ID belongs to another attempt.','request_conflict',409]};
   if(denied[reservation]){const [error,code,status]=denied[reservation];return json({error,code},status);}
   if(reservation!=='accepted'){
    const job=await store.generationRequest(owner,requestId);if(job)return await replay(job);
    return json({error:'Could not check the generation request.','code':'generation_uncertain',requestId},503);
   }
   accepted=true;
   const openai=client??createImageClient({provider,apiKey});
   // Continue saving the result after a browser disconnect. Never retry an upstream call.
   const signal=AbortSignal.timeout(190_000);
   const response=await openai.images.edit({model,image:images,n:1,size:'1024x1536',quality:'medium',output_format:'jpeg',prompt:`Create ONE photorealistic professional head-and-shoulders portrait of the same person shown in all five reference photos. Use all references to preserve their recognizable identity, facial proportions, skin tone, age, hairstyle and natural skin texture. Do not blend identities, change ethnicity, reshape the face or apply heavy beauty retouching. The subject is facing the camera with a relaxed, confident expression. ${looks[style]} Realistic photographic detail, professional composition, no text, no watermark, no collage.`},{signal});
   const base64=response.data?.[0]?.b64_json;
   if(typeof base64!=='string'||!base64||base64.length>28*1024*1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(base64))return await attemptFailure('The image provider returned no valid portrait. This attempt was counted.',502);
   const id=requestId;
   const expiresAt=null;
   let original;
   let preview;
   try{
    original=await sharp(Buffer.from(base64,'base64'),{limitInputPixels:40_000_000,animated:false,failOn:'warning'}).rotate().jpeg({quality:95}).toBuffer();
    if(original.length>20*1024*1024)throw new Error('Portrait exceeds storage limit');
    preview=await watermarkPreview(original);
    await store.save({id,owner_id:owner,style,original_path:`${owner}/${id}/original.jpg`,preview_path:`${owner}/${id}/preview.jpg`,expires_at:expiresAt},original,preview,requestId);
   }catch{return await attemptFailure('The portrait was generated but could not be saved securely. Do not regenerate immediately; check storage and API usage first.',503,true);}
   return json({photos:[{id,previewUrl:`data:image/jpeg;base64,${preview.toString('base64')}`,downloadFilename:`forma-${style}-preview.jpg`,style,paid:false,watermarked:true,expiresAt}]});
  }catch(error){
   if(error instanceof VerificationError)return json({error:error.message,code:'human_verification_failed'},error.status);
   if(error instanceof UploadError)return fail(error.message,error.status);
   if(!accepted)return json({error:'Could not validate the generation request. Please try again later.',code:'generation_unavailable'},503);
   if(provider==='openrouter'&&[400,401,402,403,404,422,429].includes(error.status))return await attemptFailure(error.status===402?'OpenRouter credits are unavailable. Check OpenRouter billing before trying again.':error.status===429?'OpenRouter rate limit reached. Wait before starting a new attempt. No automatic retry was made.':'OpenRouter could not process this request. Check the API key, model, reference-image support and privacy routing settings.',error.status===429?429:error.status===400||error.status===422?422:503);
   if(error.status===401||error.status===403)return await attemptFailure('The OpenAI key or image model access needs attention. Check the server configuration and OpenAI project permissions.',503);
   if(error.status===429){
    const code=error.code??error.error?.code;
    const type=error.type??error.error?.type;
    if(code==='credit_balance_exhausted')return await attemptFailure('OpenAI API credit balance is exhausted. Add credits in OpenAI Platform Billing before trying again. Waiting alone will not restore credits.',429);
    if(code==='organization_spend_limit_exceeded')return await attemptFailure('OpenAI organization spend limit reached. Review the organization limit in OpenAI Platform before trying again.',429);
    if(code==='project_spend_limit_exceeded')return await attemptFailure('OpenAI project spend limit reached. Review the limit for the project that owns this API key before trying again.',429);
    if(code==='organization_usage_limit_exceeded')return await attemptFailure('OpenAI organization usage limit reached. Check OpenAI Platform Limits and request a higher approved limit if needed.',429);
    if(code==='insufficient_quota'||type==='insufficient_quota')return await attemptFailure('OpenAI API quota is unavailable. Check the credit balance, billing and usage limits for the API key’s project and organization. Waiting alone may not resolve this.',429);
    if(code==='rate_limit_exceeded'||code==='slow_down'||type==='rate_limit_error')return await attemptFailure('OpenAI temporary rate limit reached. Wait before generating again and check the image model limits in OpenAI Platform. No automatic retry was made.',429);
    return await attemptFailure('OpenAI returned a usage or rate limit error. Check API Billing and Limits before trying again. No automatic retry was made.',429);
   }
   if(error.status===400)return await attemptFailure('OpenAI could not process these photos. Try other clear photos or a different style.',422);
   if(['APIConnectionTimeoutError','APIUserAbortError','TimeoutError'].includes(error.name))return await attemptFailure('Generation timed out. No automatic retry was made; check usage before generating again.',504,true);
   return await attemptFailure('Could not complete generation. Check your connection and try again. Requests are not retried automatically.',502,true);
  }finally{active=false;for(const file of files)file.buffer=Buffer.alloc(0);}
 }
 return {GET,POST};
}
export const handlers=createHandlers();
