import {createVerifier,validId,AccessError,response} from './access.mjs';
import {createPortraitStore} from './portrait-store.mjs';
export function createGenerationStatus({store=createPortraitStore(),verify=createVerifier(),now=Date.now}={}){
 return async(request,id)=>{try{
  validId(id);const user=await verify(request);
  if(!store)throw new AccessError('Generation status is unavailable.',503);
  const job=await store.generationRequest(user.id,id);
  if(!job)throw new AccessError('Generation request not found.',404);
  const status=job.status==='running'&&Date.parse(job.lease_until)<=now()?'uncertain':job.status;
  return response({request:{id:job.id,status,portraitId:job.status==='succeeded'?job.portrait_id:null}});
 }catch(error){return response({error:error instanceof AccessError?error.message:'Could not check generation status.'},error instanceof AccessError?error.status:503);}};
}
export const GET=createGenerationStatus();
