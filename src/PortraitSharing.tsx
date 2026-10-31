'use client';

import {useEffect,useRef,useState} from 'react';
import {Copy,Download,ExternalLink,Facebook,Linkedin,LoaderCircle,Share2} from 'lucide-react';
import {getOriginalFile,saveOriginalFile} from './photos';
import {canSharePhoto,sharePhoto,shareCaption,socialDestinations,type SocialDestination} from './social-sharing';

export default function PortraitSharing({id,disabled=false}:{id:string;disabled?:boolean}){
 const [destination,setDestination]=useState<SocialDestination|null>(null);
 const [file,setFile]=useState<File|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
 const active=useRef(true),loading=useRef(false);
 useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
 async function prepare(next:SocialDestination){
  if(disabled||loading.current)return;
  setDestination(next);setMessage('');setError('');
  if(file)return;
  loading.current=true;setBusy(true);
  try{const original=await getOriginalFile(id);if(active.current)setFile(original);}
  catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not prepare your photo. Please try again.');}
  finally{loading.current=false;if(active.current)setBusy(false);}
 }
 async function nativeShare(){
  if(!file||disabled||loading.current)return;
  loading.current=true;setBusy(true);setMessage('');setError('');
  try{await sharePhoto(file);if(active.current)setMessage('The photo was handed to your device’s share menu. Finish sharing in the app you choose.');}
  catch(error){if(!active.current)return;if(typeof error==='object'&&error!==null&&'name' in error&&error.name==='AbortError')setMessage('Sharing cancelled. Your photo is still available.');else setError(error instanceof Error?error.message:'Could not open sharing. Download the photo and attach it manually.');}
  finally{loading.current=false;if(active.current)setBusy(false);}
 }
 async function copyCaption(){
  setError('');try{if(!navigator.clipboard?.writeText)throw new Error('Copy is unavailable. Select the caption below and copy it manually.');await navigator.clipboard.writeText(shareCaption);if(active.current)setMessage('Caption copied. Paste it into your post.');}catch(error){if(active.current)setError(error instanceof Error?error.message:'Could not copy the caption.');}
 }
 return <section className="portrait-sharing" aria-label="Share your purchased portrait">
  <div className="share-heading"><Share2 size={18}/><h3>Share your new look.</h3><span className="preview-badge">PURCHASED ORIGINAL</span></div>
  <p>Choose where to share your watermark-free photo. You decide what gets posted.</p>
  <div className="social-destinations">{socialDestinations.map(item=><button type="button" key={item.id} aria-pressed={destination?.id===item.id} disabled={disabled||busy} onClick={()=>void prepare(item)}>{item.id==='x'?<span className="x-mark" aria-hidden="true">𝕏</span>:item.id==='linkedin'?<Linkedin size={17}/>:item.id==='facebook'?<Facebook size={17}/>:<Share2 size={17}/>}<span>{item.name}</span></button>)}</div>
  {destination&&<div className="share-options">
   {busy&&!file&&<p role="status"><LoaderCircle className="spin" size={15}/> Preparing your purchased photo…</p>}
   {file&&<>
    <p>{canSharePhoto(file)?`Use Share photo to choose ${destination.id==='other'?'an installed app':destination.name+' if it is available'} in your device’s share menu. You may need to download and attach the photo instead.`:`Download the photo, then ${destination.id==='other'?'attach it in your preferred social or messaging app.':'open '+destination.name+' and attach it to a new post.'}`}</p>
    <div className="share-actions">{canSharePhoto(file)&&<button type="button" className="primary" disabled={disabled||busy} onClick={()=>void nativeShare()}><Share2 size={16}/> Share photo…</button>}<button type="button" className="account-button" disabled={disabled||busy} onClick={()=>{saveOriginalFile(file);setMessage('Photo download started. Attach the downloaded file to your post.');}}><Download size={16}/> Download photo</button>{destination.url&&<a className="account-button" href={destination.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"><ExternalLink size={16}/> Open {destination.name}</a>}</div>
    <div className="share-caption"><span>{shareCaption}</span><button type="button" className="text-button" disabled={disabled||busy} onClick={()=>void copyCaption()}><Copy size={14}/> Copy caption</button></div>
   </>}
   {error&&<p className="share-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
  </div>}
  <p className="share-privacy">The platform links open X’s composer or LinkedIn/Facebook’s feed; they do not attach the photo automatically. Your private portrait URL is never shared.</p>
 </section>;
}
