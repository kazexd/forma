'use client';
import Script from 'next/script';
import {useEffect,useRef,useState} from 'react';

interface TurnstileAPI{
 render(element:HTMLElement,options:Record<string,unknown>):string;
 remove(id:string):void;
}
declare global{interface Window{turnstile?:TurnstileAPI}}

export default function Turnstile({siteKey,resetKey,onToken}:{siteKey:string;resetKey:number;onToken:(token:string)=>void}){
 const container=useRef<HTMLDivElement>(null),callback=useRef(onToken);
 callback.current=onToken;
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(window.turnstile)setReady(true);},[]);
 useEffect(()=>{
  callback.current('');setError('');
  if(!ready||!container.current||!window.turnstile)return;
  let active=true;
  const widget=window.turnstile.render(container.current,{sitekey:siteKey,action:'generate_portrait',theme:'light',size:'flexible','response-field':false,
   callback:(token:string)=>{if(active){callback.current(token);setError('');}},
   'expired-callback':()=>{if(active)callback.current('');},
   'error-callback':()=>{if(active){callback.current('');setError('Verification could not load. Check your connection and retry.');}}
  });
  return()=>{active=false;window.turnstile?.remove(widget);};
 },[ready,siteKey,resetKey]);
 return <div className="human-verification"><Script id="forma-turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={()=>setReady(true)} onError={()=>{callback.current('');setError('Verification could not load. Please reload this page.');}}/><div ref={container}/>{error&&<p role="alert">{error}</p>}</div>;
}
