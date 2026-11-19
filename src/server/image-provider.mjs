import OpenAI from 'openai';

// Explicit capabilities: do not send OpenAI-only knobs to other model families.
export const openRouterModels=Object.freeze({
 'openai/gpt-image-2':Object.freeze({size:'1024x1536',quality:'medium',output_format:'jpeg'}),
 'qwen/qwen-image-2.1-turbo':Object.freeze({resolution:'1K',aspect_ratio:'2:3'}),
 'bytedance-seed/seedream-5-0-flash':Object.freeze({resolution:'1K',aspect_ratio:'2:3',output_format:'jpeg'}),
 'bytedance-seed/seedream-5-5':Object.freeze({resolution:'1K',aspect_ratio:'2:3',output_format:'jpeg'}),
 'google/gemini-nano-banana-2.1':Object.freeze({resolution:'1K',aspect_ratio:'2:3'})
});

export function imageConfiguration(env=process.env){
 const provider=env.IMAGE_PROVIDER?.trim()||'openai';
 if(provider==='openai')return {provider,label:'OpenAI',apiKey:env.OPENAI_API_KEY,model:env.OPENAI_IMAGE_MODEL||'gpt-image-2',keyName:'OPENAI_API_KEY'};
 if(provider==='openrouter'){
  const model=env.OPENROUTER_IMAGE_MODEL?.trim()||'openai/gpt-image-2';
  return {provider,label:'OpenRouter',apiKey:env.OPENROUTER_API_KEY,model,keyName:'OPENROUTER_API_KEY',invalid:!Object.hasOwn(openRouterModels,model)};
 }
 return {provider,label:'Image provider',apiKey:null,model:null,keyName:'IMAGE_PROVIDER',invalid:true};
}

// Both adapters expose the existing image-edit contract; no automatic retries or fallback.
export function createImageClient({provider,apiKey,fetcher=fetch}){
 if(provider==='openai')return new OpenAI({apiKey,timeout:180_000,maxRetries:0});
 if(provider!=='openrouter')throw new Error('Unsupported image provider');
 return {images:{async edit({model,image,prompt,n},{signal}){
  if(!Object.hasOwn(openRouterModels,model))throw new Error('Unsupported OpenRouter image model');
  if(image.length!==5||n!==1)throw new Error('Exactly five references and one output are required');
  const input_references=await Promise.all(image.map(async file=>({type:'image_url',image_url:{url:'data:image/jpeg;base64,'+Buffer.from(await file.arrayBuffer()).toString('base64')}})));
  const response=await fetcher('https://openrouter.ai/api/v1/images',{
   method:'POST',redirect:'error',signal,
   headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},
   body:JSON.stringify({model,prompt,input_references,n:1,...openRouterModels[model],provider:{allow_fallbacks:false,data_collection:'deny'}})
  });
  if(!response.ok){const error=new Error('Image provider rejected the request');error.status=response.status;throw error;}
  // Bound output memory; never download provider-supplied URLs or expose raw errors.
  const reader=response.body?.getReader();if(!reader)throw new Error('Missing image response');
  const chunks=[];let length=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>30*1024*1024)throw new Error('Image response too large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(result.error){const error=new Error('Image provider returned an error');error.status=502;throw error;}
  return {data:result.data};
 }}};
}
