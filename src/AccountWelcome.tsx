"use client";
import {useEffect,useRef,useState} from 'react';
import {Sparkles,Camera,Images,KeyRound,X} from 'lucide-react';
import {getAccessToken} from './auth';

export default function AccountWelcome({userId,home=true}:{userId:string;home?:boolean}){
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),saving=useRef(false);
 useEffect(()=>{
  let cancelled=false;alive.current=true;
  void (async()=>{try{
   const token=await getAccessToken();
   const response=await fetch('/api/account-welcome',{headers:{Authorization:'Bearer '+token},cache:'no-store'});
   if(!response.ok)return;
   const data=await response.json();if(cancelled||data.welcome!==true)return;
   if(!home){window.location.replace('/');return;}
   setOpen(true);
  }catch{/* Welcome availability must not prevent sign-in or portrait creation. */}})();
  return()=>{cancelled=true;alive.current=false;};
 },[userId,home]);
 useEffect(()=>{if(open)dialog.current?.showModal();return()=>dialog.current?.close();},[open]);
 async function dismiss(){
  if(saving.current)return;saving.current=true;setBusy(true);setError('');
  try{
   const token=await getAccessToken();const response=await fetch('/api/account-welcome',{method:'POST',headers:{Authorization:'Bearer '+token}});
   if(!response.ok)throw new Error();if(alive.current)setOpen(false);
  }catch{if(alive.current)setError('Could not save your welcome. Please try again.');}
  finally{saving.current=false;if(alive.current)setBusy(false);}
 }
 if(!open)return null;
 return <dialog ref={dialog} className="welcome-dialog" aria-labelledby="welcome-title" aria-describedby="welcome-description" onCancel={event=>{event.preventDefault();void dismiss();}}>
  <button className="dialog-close" aria-label="Close welcome" disabled={busy} onClick={()=>void dismiss()}><X size={18}/></button>
  <div className="welcome-emblem"><Sparkles size={28} aria-hidden="true"/></div>
  <span className="eyebrow">YOUR FIRST IMPRESSION STARTS HERE</span>
  <h2 id="welcome-title">Welcome to Forma.</h2>
  <p id="welcome-description" className="welcome-intro">Your account comes with <strong>3 free generation attempts</strong>. No payment needed to get started.</p>
  <ul className="welcome-steps">
   <li><Camera size={20} aria-hidden="true"/><div><strong>Five photos. A fresh look.</strong><p>Upload 5 clear, recent photos of yourself, choose a style and generate one professional portrait per attempt.</p></div></li>
   <li><Images size={20} aria-hidden="true"/><div><strong>Preview free. Keep your favourites.</strong><p>View watermarked results in your private My Gallery. Your portraits stay there until you delete them.</p></div></li>
   <li><KeyRound size={20} aria-hidden="true"/><div><strong>Unlock when you love it.</strong><p>Buy an original or use an unlock credit to download and share it without the watermark.</p></div></li>
  </ul>
  <p className="welcome-note">Delivered portraits use one attempt, even if you dislike the result. Confirmed technical failures restore your attempt. Free attempts do not reset daily.</p>
  {error&&<p role="alert">{error}</p>}
  <button className="primary" disabled={busy} onClick={()=>void dismiss()} autoFocus>{busy?'Getting ready…':"Let’s create your portrait"}</button>
 </dialog>;
}
