import {createPortraitStore} from './portrait-store.mjs';
import {createVerifier,AccessError,checkOrigin,response} from './access.mjs';
export function createWelcomeHandler({store=createPortraitStore(),verify=createVerifier()}={}){
 return async request=>{try{
  if(request.method==='POST')checkOrigin(request);
  const user=await verify(request);
  if(!store)throw new AccessError('Account welcome is unavailable.',503);
  if(request.method==='POST'){await store.acknowledgeWelcome(user.id);return response({acknowledged:true});}
  const pending=await store.welcomePending(user.id);
  return response({welcome:pending,freeAttempts:3});
 }catch(error){return response({error:error instanceof AccessError?error.message:'Could not load your welcome. Please try again.'},error instanceof AccessError?error.status:503);}};
}
export const GET=createWelcomeHandler();
export const POST=GET;
