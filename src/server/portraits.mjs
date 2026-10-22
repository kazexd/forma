import sharp from 'sharp';
import OpenAI,{toFile} from 'openai';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {parseUpload,UploadError} from './uploads.mjs';

const looks={
 formal:'Tailored dark business suit with a simple neutral shirt, understated gray studio backdrop, elegant studio lighting.',
 casual:'Smart business casual clothing, an unstructured blazer and simple shirt, warm neutral studio backdrop, soft flattering light.',
 natural:'Simple professional clothing, soft window light and a softly blurred natural background, approachable and relaxed.'
};
const mimeFormats={'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const fail=(message,status)=>json({error:message},status);
export function createHandlers({apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_IMAGE_MODEL||'gpt-image-2',client,
 supabaseUrl=process.env.NEXT_PUBLIC_SUPABASE_URL,supabaseKey=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,authClient}={}){
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
  try{
   const {data,error}=await auth.auth.getUser(match[1]);
   if(error){if(error.status>=500||!error.status)return fail('Sign-in verification is temporarily unavailable. Please try again.',503);return fail('Your sign-in has expired or is invalid. Please sign in again.',401);}
   if(!data?.user?.id)return fail('Your sign-in has expired or is invalid. Please sign in again.',401);
   if(data.user.is_anonymous)return fail('Please sign in with Google before generating a portrait.',401);
  }catch{return fail('Sign-in verification is temporarily unavailable. Please try again.',503);}
  if(!apiKey&&!client)return fail('OpenAI is not configured. Set OPENAI_API_KEY in .env and restart the app.',503);
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
     const buffer=await input.rotate().resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
     images.push(await toFile(buffer,`reference-${images.length+1}.jpg`,{type:'image/jpeg'}));
    }catch{return fail('One of your photos could not be read. Use non-animated JPEG, PNG or WebP photos under 40 megapixels.',400);}
   }
   const openai=client??new OpenAI({apiKey,timeout:180_000,maxRetries:0});
   const signal=AbortSignal.any([request.signal,AbortSignal.timeout(190_000)]);
   const response=await openai.images.edit({model,image:images,n:1,size:'1024x1536',quality:'medium',output_format:'jpeg',prompt:`Create ONE photorealistic professional head-and-shoulders portrait of the same person shown in all five reference photos. Use all references to preserve their recognizable identity, facial proportions, skin tone, age, hairstyle and natural skin texture. Do not blend identities, change ethnicity, reshape the face or apply heavy beauty retouching. The subject is facing the camera with a relaxed, confident expression. ${looks[style]} Realistic photographic detail, professional composition, no text, no watermark, no collage.`},{signal});
   const base64=response.data?.[0]?.b64_json;
   if(!base64)return fail('OpenAI returned no portrait. Please try again.',502);
   return json({photos:[{id:randomUUID(),previewUrl:`data:image/jpeg;base64,${base64}`,downloadFilename:`forma-${style}-portrait.jpg`}]});
  }catch(error){
   if(error instanceof UploadError)return fail(error.message,error.status);
   if(request.signal.aborted)return fail('Generation was cancelled. Check API usage before trying again.',499);
   if(error.status===401||error.status===403)return fail('The OpenAI key or image model access needs attention. Check the server configuration and OpenAI project permissions.',503);
   if(error.status===429)return fail('OpenAI usage or rate limit reached. Check API billing or wait before trying again.',429);
   if(error.status===400)return fail('OpenAI could not process these photos. Try other clear photos or a different style.',422);
   if(['APIConnectionTimeoutError','APIUserAbortError','TimeoutError'].includes(error.name))return fail('Generation timed out. No automatic retry was made; check usage before generating again.',504);
   return fail('Could not complete generation. Check your connection and try again. Requests are not retried automatically.',502);
  }finally{active=false;for(const file of files)file.buffer=Buffer.alloc(0);}
 }
 return {GET,POST};
}
export const handlers=createHandlers();
