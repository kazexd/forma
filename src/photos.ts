import {getAccessToken} from './auth';
export type Style = 'formal' | 'casual' | 'natural';
export const styles: { id: Style; title: string; description: string; tag: string }[] = [
 {id:'formal',title:'Business Formal',description:'Sharp tailoring. A confident presence.',tag:'THE CLASSIC'},
 {id:'casual',title:'Business Casual',description:'Polished, approachable, unmistakably you.',tag:'MOST POPULAR'},
 {id:'natural',title:'Natural Professional',description:'Soft light. An effortless first impression.',tag:'THE EVERYDAY'}
];
export interface GeneratedPhoto { id: string; previewUrl: string; downloadFilename: string; paid: boolean; watermarked: true; expiresAt: string; style: Style }
export const canContinue = (count:number) => count === 5;
export function fileError(file:File): string | null {
 if (!['image/jpeg','image/png','image/webp'].includes(file.type)) return `${file.name}: choose a JPEG, PNG or WebP image.`;
 if (file.size > 10 * 1024 * 1024) return `${file.name}: exceeds the 10 MB limit.`;
 return null;
}
export function decodeImage(url:string):Promise<void> {
 return new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{image.naturalWidth ? resolve() : reject(new Error('Empty image'));};image.onerror=()=>reject(new Error('Unreadable image'));image.src=url;});
}
export async function generatePhotos(files:File[],style:Style):Promise<GeneratedPhoto[]> {
 if(!canContinue(files.length)) throw new Error('Please select exactly 5 photos.');
 if(files.some(file=>fileError(file))) throw new Error('Please remove invalid photos.');
 const token=await getAccessToken();
 const data=new FormData();
 files.forEach(file=>data.append('photos',file));
 data.append('style',style);
 data.append('consent','true');
 const abort=new AbortController();
 const timeout=setTimeout(()=>abort.abort(),210_000);
 try{
  const response=await fetch('/api/generate',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:data,signal:abort.signal});
  const payload=await response.json().catch(()=>null);
  if(!response.ok)throw new Error(payload?.error||'Generation failed. Please try again.');
  if(!Array.isArray(payload?.photos)||payload.photos.length!==1||typeof payload.photos[0]?.previewUrl!=='string'||!payload.photos[0].previewUrl.startsWith('data:image/jpeg;base64,')||payload.photos[0].watermarked!==true||payload.photos[0].paid!==false)throw new Error('The server returned an invalid portrait.');
  return payload.photos;
 }catch(error){
  if(abort.signal.aborted)throw new Error('Generation timed out. Check API usage before trying again.');
  if(error instanceof TypeError)throw new Error('Could not reach the local API. Make sure npm run dev is running.');
  throw error;
 }finally{clearTimeout(timeout);}
}


async function portraitRequest(id:string,action='' ,method='GET'){
 const token=await getAccessToken();
 const response=await fetch('/api/portraits/'+encodeURIComponent(id)+action,{method,headers:{Authorization:'Bearer '+token}});
 if(!response.ok){const payload=await response.json().catch(()=>null);throw new Error(payload?.error||'Could not complete the portrait request.');}
 return response;
}
export async function loadPortrait(id:string):Promise<GeneratedPhoto>{
 const response=await portraitRequest(id);const payload=await response.json();
 if(!payload.photo||payload.photo.watermarked!==true||!payload.photo.previewUrl?.startsWith('data:image/jpeg;base64,'))throw new Error('Invalid watermarked preview.');
 return payload.photo;
}
export async function buyPortrait(id:string):Promise<void>{
 const response=await portraitRequest(id,'/checkout','POST');const payload=await response.json();
 const url=new URL(payload.url);if(url.protocol!=='https:'||url.hostname!=='checkout.stripe.com')throw new Error('Invalid checkout destination.');
 window.location.assign(url.href);
}
export async function getOriginalFile(id:string):Promise<File>{
 const response=await portraitRequest(id,'/download');const blob=await response.blob();
 if(blob.type!=='image/jpeg'||!blob.size)throw new Error('The server returned an invalid original photo.');
 return new File([blob],'forma-professional-portrait.jpg',{type:'image/jpeg'});
}
export function saveOriginalFile(file:File):void{
 const url=URL.createObjectURL(file);const link=document.createElement('a');link.href=url;link.download=file.name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export async function downloadOriginal(id:string):Promise<void>{
 saveOriginalFile(await getOriginalFile(id));
}
