import express from 'express';
import multer from 'multer';
import sharp from 'sharp';
import OpenAI, {toFile} from 'openai';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';

const looks = {
  formal: 'Tailored dark business suit with a simple neutral shirt, understated gray studio backdrop, elegant studio lighting.',
  casual: 'Smart business casual clothing, an unstructured blazer and simple shirt, warm neutral studio backdrop, soft flattering light.',
  natural: 'Simple professional clothing, soft window light and a softly blurred natural background, approachable and relaxed.'
};
const mimeFormats = {'image/jpeg':'jpeg','image/png':'png','image/webp':'webp'};
export function createApp({apiKey=process.env.OPENAI_API_KEY,model=process.env.OPENAI_IMAGE_MODEL||'gpt-image-2',client,
  supabaseUrl=process.env.VITE_SUPABASE_URL, supabaseKey=process.env.VITE_SUPABASE_PUBLISHABLE_KEY, authClient}={}) {
  const app=express();
  let auth=authClient;
  if(!auth&&supabaseUrl&&supabaseKey){
    try{auth=createClient(supabaseUrl,supabaseKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(10000)})}});}catch{/* Fail closed on invalid configuration. */}
  }
  let active=false;
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:10*1024*1024,files:5,fields:2,fieldSize:100,parts:7},fileFilter(_req,file,done){
    if(!Object.hasOwn(mimeFormats,file.mimetype))return done(new Error('Choose JPEG, PNG or WebP images.'));
    done(null,true);
  }}).array('photos',5);
  app.disable('x-powered-by');
  app.use('/api',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  // Local tool: reject cross-site form submissions, and never expose credentials to clients.
  app.use('/api',(req,res,next)=>{
    const origin=req.get('origin');
    if(origin && !['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:3001','http://localhost:3001'].includes(origin))return res.status(403).json({error:'This local API only accepts requests from the local app.'});
    if(req.get('sec-fetch-site')==='cross-site')return res.status(403).json({error:'Cross-site requests are not allowed.'});
    next();
  });
  app.get('/api/health',(_req,res)=>res.json({configured:Boolean(apiKey||client),authConfigured:Boolean(auth)}));
  app.post('/api/generate',(req,res,next)=>{
    upload(req,res,error=>{
      if(error)return next(error);
      next();
    });
  },async(req,res)=>{
    // Consume the bounded multipart body before responding; early responses can
    // reset Vite's proxy connection while it is still forwarding image bytes.
    if(!auth)return res.status(503).json({error:'Google sign-in is not configured. Set the Supabase environment variables and restart the app.'});
    const match=/^Bearer ([^\s]+)$/i.exec(req.get('authorization')??'');
    if(!match)return res.status(401).json({error:'Please sign in with Google before generating a portrait.'});
    try{
      // Validate with Supabase Auth, never trust a browser-supplied user ID or decoded JWT alone.
      const {data,error}=await auth.auth.getUser(match[1]);
      if(error){
        if(error.status>=500||!error.status)return res.status(503).json({error:'Sign-in verification is temporarily unavailable. Please try again.'});
        return res.status(401).json({error:'Your sign-in has expired or is invalid. Please sign in again.'});
      }
      if(!data?.user?.id)return res.status(401).json({error:'Your sign-in has expired or is invalid. Please sign in again.'});
      if(data.user.is_anonymous)return res.status(401).json({error:'Please sign in with Google before generating a portrait.'});
      req.user=data.user;
    }catch{return res.status(503).json({error:'Sign-in verification is temporarily unavailable. Please try again.'});}
    if(!apiKey&&!client)return res.status(503).json({error:'OpenAI is not configured. Set OPENAI_API_KEY in .env and restart the app.'});
    if(active)return res.status(429).json({error:'A portrait is already being generated. Please wait before trying again.'});
    active=true;
    const abort=new AbortController();
    const disconnect=()=>{if(!res.writableEnded)abort.abort();};
    res.on('close',disconnect);
    try{
      if(req.body.consent!=='true')return res.status(400).json({error:'Please confirm that you may use these photos and send them to OpenAI.'});
      if(!Object.hasOwn(looks,req.body.style))return res.status(400).json({error:'Please choose a supported portrait style.'});
      if(req.files?.length!==5)return res.status(400).json({error:'Please select exactly 5 photos.'});
      const images=[];
      for(const file of req.files){
        try{
          const input=sharp(file.buffer,{limitInputPixels:40_000_000,animated:false,failOn:'warning'});
          const metadata=await input.metadata();
          if(metadata.format!==mimeFormats[file.mimetype]||(metadata.pages??1)>1)throw new Error('Unsupported content');
          // Decode all pixels, normalize orientation, strip metadata, and bound reference size.
          const buffer=await input.rotate().resize({width:1536,height:1536,fit:'inside',withoutEnlargement:true}).jpeg({quality:90}).toBuffer();
          images.push(await toFile(buffer,`reference-${images.length+1}.jpg`,{type:'image/jpeg'}));
        }catch{return res.status(400).json({error:'One of your photos could not be read. Use non-animated JPEG, PNG or WebP photos under 40 megapixels.'});}
      }
      const openai=client??new OpenAI({apiKey,timeout:180_000,maxRetries:0});
      const response=await openai.images.edit({model,image:images,n:1,size:'1024x1536',quality:'medium',output_format:'jpeg',prompt:`Create ONE photorealistic professional head-and-shoulders portrait of the same person shown in all five reference photos. Use all references to preserve their recognizable identity, facial proportions, skin tone, age, hairstyle and natural skin texture. Do not blend identities, change ethnicity, reshape the face or apply heavy beauty retouching. The subject is facing the camera with a relaxed, confident expression. ${looks[req.body.style]} Realistic photographic detail, professional composition, no text, no watermark, no collage.`},{signal:abort.signal});
      const base64=response.data?.[0]?.b64_json;
      if(!base64)return res.status(502).json({error:'OpenAI returned no portrait. Please try again.'});
      res.json({photos:[{id:randomUUID(),previewUrl:`data:image/jpeg;base64,${base64}`,downloadFilename:`forma-${req.body.style}-portrait.jpg`}]});
    }catch(error){
      if(abort.signal.aborted)return;
      const status=error.status;
      if(status===401||status===403)return res.status(503).json({error:'The OpenAI key or image model access needs attention. Check the server configuration and OpenAI project permissions.'});
      if(status===429)return res.status(429).json({error:'OpenAI usage or rate limit reached. Check API billing or wait before trying again.'});
      if(status===400)return res.status(422).json({error:'OpenAI could not process these photos. Try other clear photos or a different style.'});
      if(error.name==='APIConnectionTimeoutError')return res.status(504).json({error:'Generation timed out. No automatic retry was made; check usage before generating again.'});
      res.status(502).json({error:'Could not complete generation. Check your connection and try again. Requests are not retried automatically.'});
    }finally{
      active=false;
      if(req.files)for(const file of req.files)file.buffer=Buffer.alloc(0);
      res.off('close',disconnect);
    }
  });
  app.use((error,_req,res,_next)=>{
    const tooLarge=error.code==='LIMIT_FILE_SIZE';
    res.status(tooLarge?413:400).json({error:tooLarge?'Each photo must be 10 MB or smaller.':error instanceof multer.MulterError?'Upload exactly 5 photos with one style and consent.':'Choose JPEG, PNG or WebP images.'});
  });
  return app;
}
