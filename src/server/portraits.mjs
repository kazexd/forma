import sharp from 'sharp';
import OpenAI,{toFile} from 'openai';
import {randomUUID} from 'node:crypto';
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
export function createHandlers({apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_IMAGE_MODEL||'gpt-image-2',client,
 supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,authClient,
 store=createPortraitStore(),dailyLimit=Number(process.env.DAILY_GENERATION_LIMIT||3),retentionDays=Number(process.env.UNPAID_RETENTION_DAYS||7)}={}){
 let auth=authClient;
 if(!auth&&supabaseUrl&&supabaseKey){try{auth=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});}catch{/* Fail closed. */}}
 // One in-flight generation per Node process, same as the original local backend.
 let active=false;
 async function GET(){return json({configured:Boolean(apiKey||client),authConfigured:Boolean(auth)});}
 async function POST(request){
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
  if(!apiKey&&!client)return fail('OpenAI is not configured. Set OPENAI_API_KEY in .env and restart the app.',503);
  if(!store)return fail('Private portrait storage is not configured. Complete the Supabase storage setup before generating.',503);
  try{await store.ready();}catch{return fail('Private portrait storage is unavailable. Check the migration and private bucket before generating.',503);}
  if(active)return fail('A portrait is already being generated. Please wait before trying again.',429);
  active=true;
  let files=[];
  try{
   const upload=await parseUpload(request);files=upload.files;
   const style=upload.fields.style;
   if(upload.fields.consent!=='true')return fail('Please confirm that you may use these photos and send them to OpenAI.',400);
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
   if(!Number.isInteger(dailyLimit)||dailyLimit<1||!Number.isInteger(retentionDays)||retentionDays<1)return fail('Portrait limits are not configured correctly.',503);
   try{if(!await store.reserveAttempt(owner,dailyLimit))return fail('Your daily generation allowance has been reached. Try again after midnight UTC.',429);}catch{return fail('Could not check your generation allowance. Please try again later.',503);}
   const openai=client??new OpenAI({apiKey,timeout:180_000,maxRetries:0});
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(190_000)]);
   const response=await openai.images.edit({model,image:images,n:1,size:'1024x1536',quality:'medium',output_format:'jpeg',prompt:`Create ONE photorealistic professional head-and-shoulders portrait of the same person shown in all five reference photos. Use all references to preserve their recognizable identity, facial proportions, skin tone, age, hairstyle and natural skin texture. Do not blend identities, change ethnicity, reshape the face or apply heavy beauty retouching. The subject is facing the camera with a relaxed, confident expression. ${looks[style]} Realistic photographic detail, professional composition, no text, no watermark, no collage.`},{signal});
   const base64=response.data?.[0]?.b64_json;
   if(!base64)return fail('OpenAI returned no portrait. Please try again.',502);
   const id=randomUUID();
   const expiresAt=new Date(Date.now()+retentionDays*86400000).toISOString();
   const original=Buffer.from(base64,'base64');
   let preview;
   try{
    preview=await watermarkPreview(original);
    await store.save({id,owner_id:owner,style,original_path:`${owner}/${id}/original.jpg`,preview_path:`${owner}/${id}/preview.jpg`,expires_at:expiresAt},original,preview);
   }catch{return fail('The portrait was generated but could not be saved securely. Do not regenerate immediately; check storage and API usage first.',503);}
   return json({photos:[{id,previewUrl:`data:image/jpeg;base64,${preview.toString('base64')}`,downloadFilename:`forma-${style}-preview.jpg`,style,paid:false,watermarked:true,expiresAt}]});
  }catch(error){
   if(error instanceof UploadError)return fail(error.message,error.status);
   if(request.signal.aborted)return fail('Generation was cancelled. Check API usage before trying again.',499);
   if(error.status===401||error.status===403)return fail('The OpenAI key or image model access needs attention. Check the server configuration and OpenAI project permissions.',503);
   if(error.status===429){
    const code=error.code??error.error?.code;
    const type=error.type??error.error?.type;
    if(code==='credit_balance_exhausted')return fail('OpenAI API credit balance is exhausted. Add credits in OpenAI Platform Billing before trying again. Waiting alone will not restore credits.',429);
    if(code==='organization_spend_limit_exceeded')return fail('OpenAI organization spend limit reached. Review the organization limit in OpenAI Platform before trying again.',429);
    if(code==='project_spend_limit_exceeded')return fail('OpenAI project spend limit reached. Review the limit for the project that owns this API key before trying again.',429);
    if(code==='organization_usage_limit_exceeded')return fail('OpenAI organization usage limit reached. Check OpenAI Platform Limits and request a higher approved limit if needed.',429);
    if(code==='insufficient_quota'||type==='insufficient_quota')return fail('OpenAI API quota is unavailable. Check the credit balance, billing and usage limits for the API key’s project and organization. Waiting alone may not resolve this.',429);
    if(code==='rate_limit_exceeded'||code==='slow_down'||type==='rate_limit_error')return fail('OpenAI temporary rate limit reached. Wait before generating again and check the image model limits in OpenAI Platform. No automatic retry was made.',429);
    return fail('OpenAI returned a usage or rate limit error. Check API Billing and Limits before trying again. No automatic retry was made.',429);
   }
   if(error.status===400)return fail('OpenAI could not process these photos. Try other clear photos or a different style.',422);
   if(['APIConnectionTimeoutError','APIUserAbortError','TimeoutError'].includes(error.name))return fail('Generation timed out. No automatic retry was made; check usage before generating again.',504);
   return fail('Could not complete generation. Check your connection and try again. Requests are not retried automatically.',502);
  }finally{active=false;for(const file of files)file.buffer=Buffer.alloc(0);}
 }
 return {GET,POST};
}
export const handlers=createHandlers();
