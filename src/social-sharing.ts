export const shareCaption='My new professional portrait.';
export const socialDestinations=[
 {id:'x',name:'X',url:'https://x.com/intent/tweet?'+new URLSearchParams({text:shareCaption})},
 {id:'linkedin',name:'LinkedIn',url:'https://www.linkedin.com/feed/'},
 {id:'facebook',name:'Facebook',url:'https://www.facebook.com/'},
 {id:'other',name:'Other apps',url:null}
] as const;
export type SocialDestination=typeof socialDestinations[number];
export function canSharePhoto(file:File):boolean{
 try{return typeof navigator.share==='function'&&typeof navigator.canShare==='function'&&navigator.canShare({files:[file]});}catch{return false;}
}
export async function sharePhoto(file:File):Promise<void>{
 if(!canSharePhoto(file))throw new Error('File sharing is unavailable. Download the photo and attach it in your chosen app.');
 // Called directly from a second click after fetching, retaining browser user activation.
 await navigator.share({files:[file],title:'My professional portrait',text:shareCaption});
}
