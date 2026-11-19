import {describe,it,expect,vi} from 'vitest';
import {imageConfiguration,createImageClient} from './image-provider.mjs';

describe('image provider selection',()=>{
 it('defaults to direct OpenAI and selects only the active provider key',()=>{
  expect(imageConfiguration({OPENAI_API_KEY:'direct'})).toMatchObject({provider:'openai',apiKey:'direct',model:'gpt-image-2'});
  expect(imageConfiguration({IMAGE_PROVIDER:'openrouter',OPENAI_API_KEY:'direct',OPENROUTER_API_KEY:'router',OPENROUTER_IMAGE_MODEL:'qwen/qwen-image-2.1-turbo'})).toMatchObject({provider:'openrouter',apiKey:'router',model:'qwen/qwen-image-2.1-turbo'});
  expect(imageConfiguration({IMAGE_PROVIDER:'typo',OPENAI_API_KEY:'direct'})).toMatchObject({invalid:true,apiKey:null});
  expect(imageConfiguration({IMAGE_PROVIDER:'openrouter',OPENAI_API_KEY:'direct'}).apiKey).toBeUndefined();
 });
 it('sends all five references in one authenticated image request without fallbacks',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({data:[{b64_json:'YWJj'}]}));
  const client=createImageClient({provider:'openrouter',apiKey:'private-key',fetcher});
  const signal=AbortSignal.timeout(1000);
  const result=await client.images.edit({model:'openai/gpt-image-2',image:Array.from({length:5},()=>new Blob(['ref'],{type:'image/jpeg'})),prompt:'same person',n:1,size:'1024x1536',quality:'medium',output_format:'jpeg'},{signal});
  expect(result.data[0].b64_json).toBe('YWJj');expect(fetcher).toHaveBeenCalledTimes(1);
  const [url,options]=fetcher.mock.calls[0];expect(url).toBe('https://openrouter.ai/api/v1/images');expect(options.signal).toBe(signal);expect(options.redirect).toBe('error');expect(options.headers.Authorization).toBe('Bearer private-key');
  const body=JSON.parse(options.body);expect(body.input_references).toHaveLength(5);expect(body.input_references[0].image_url.url).toBe('data:image/jpeg;base64,cmVm');expect(body).toMatchObject({n:1,model:'openai/gpt-image-2',provider:{allow_fallbacks:false,data_collection:'deny'}});
 });
 it.each([400,401,402,429,500])('does not retry or expose upstream details on HTTP %i',async status=>{
  const fetcher=vi.fn().mockResolvedValue(new Response('secret upstream details',{status}));
  const client=createImageClient({provider:'openrouter',apiKey:'secret',fetcher});
  await expect(client.images.edit({model:'openai/gpt-image-2',image:Array.from({length:5},()=>new Blob(['ref'])),n:1},{signal:AbortSignal.timeout(1000)})).rejects.toMatchObject({status,message:'Image provider rejected the request'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('propagates unknown network outcomes without retry',async()=>{
  const fetcher=vi.fn().mockRejectedValue(new DOMException('timeout','TimeoutError'));
  await expect(createImageClient({provider:'openrouter',apiKey:'secret',fetcher}).images.edit({model:'openai/gpt-image-2',image:Array.from({length:5},()=>new Blob(['ref'])),n:1},{signal:AbortSignal.timeout(1000)})).rejects.toMatchObject({name:'TimeoutError'});expect(fetcher).toHaveBeenCalledTimes(1);
 });
 it('rejects an HTTP 200 error envelope',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({error:{message:'private'}}));
  await expect(createImageClient({provider:'openrouter',apiKey:'secret',fetcher}).images.edit({model:'openai/gpt-image-2',image:Array.from({length:5},()=>new Blob(['ref'])),n:1},{signal:AbortSignal.timeout(1000)})).rejects.toMatchObject({status:502});
 });
});

const alternatives=[
 ['qwen/qwen-image-2.1-turbo',false],
 ['bytedance-seed/seedream-5-0-flash',true],
 ['bytedance-seed/seedream-5-5',true],
 ['google/gemini-nano-banana-2.1',false]
];
it.each(alternatives)('maps %s to compatible portrait parameters',async(model,jpeg)=>{
 const fetcher=vi.fn().mockResolvedValue(Response.json({data:[{b64_json:'YWJj'}]}));
 const configuration=imageConfiguration({IMAGE_PROVIDER:'openrouter',OPENROUTER_IMAGE_MODEL:model,OPENROUTER_API_KEY:'router'});
 expect(configuration.invalid).toBe(false);
 await createImageClient({...configuration,fetcher}).images.edit({model,image:Array.from({length:5},()=>new Blob(['ref'])),prompt:'same person',n:1,size:'1024x1536',quality:'medium',output_format:'jpeg'},{signal:AbortSignal.timeout(1000)});
 const body=JSON.parse(fetcher.mock.calls[0][1].body);
 expect(body).toMatchObject({model,n:1,resolution:'1K',aspect_ratio:'2:3'});
 expect(body.input_references).toHaveLength(5);expect(body).not.toHaveProperty('size');expect(body).not.toHaveProperty('quality');
 if(jpeg)expect(body.output_format).toBe('jpeg');else expect(body).not.toHaveProperty('output_format');
 expect(fetcher).toHaveBeenCalledTimes(1);
});
it('fails closed for unsupported models without calling the provider',async()=>{
 expect(imageConfiguration({IMAGE_PROVIDER:'openrouter',OPENROUTER_IMAGE_MODEL:'unknown/model'}).invalid).toBe(true);
 const fetcher=vi.fn();
 await expect(createImageClient({provider:'openrouter',apiKey:'key',fetcher}).images.edit({model:'unknown/model',image:[],n:1},{})).rejects.toThrow('Unsupported');
 expect(fetcher).not.toHaveBeenCalled();
});
