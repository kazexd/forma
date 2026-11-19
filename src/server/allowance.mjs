import {createPortraitStore} from './portrait-store.mjs';
import {createVerifier,AccessError,response} from './access.mjs';
export function createAllowanceHandler({store=createPortraitStore(),verify=createVerifier()}={}){
 return async request=>{try{
  const user=await verify(request);
  if(!store)throw new AccessError('Generation allowance is not configured.',503);
  const {remaining,unlocks}=await store.credits(user.id);
  if(!Number.isSafeInteger(remaining)||remaining<0||!Number.isSafeInteger(unlocks)||unlocks<0)throw new Error('Invalid credits');
  return response({remaining,unlocks});
 }catch(error){return response({error:error instanceof AccessError?error.message:'Could not check your generation allowance. Please try again later.'},error instanceof AccessError?error.status:503);}};
}
export const GET=createAllowanceHandler();
