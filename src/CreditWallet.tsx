'use client';
import {useEffect,useRef,useState} from 'react';
import {buyCreditPackage,getPackageStatus} from './photos';
import {packagePrice} from './portrait-price.mjs';

export default function CreditWallet({remaining,unlocks,onRefresh,paymentMode=null,disabled=false}:{remaining:number|null;unlocks:number|null;onRefresh:()=>Promise<void>;paymentMode?:'test'|'live'|null;disabled?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true),refresh=useRef(onRefresh);refresh.current=onRefresh;
 const [orderId]=useState(()=>typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('package'));
 async function check(){if(!orderId)return;try{const state=await getPackageStatus(orderId);if(!alive.current)return;setError('');setMessage(state==='paid'?'Payment confirmed. 5 generation attempts and 2 unlock credits have been added.':state==='expired'?'Package checkout expired. No credits were added.':'Payment is not confirmed yet. Wait briefly and check again.');await refresh.current();return state;}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not confirm payment.');}}
 useEffect(()=>{alive.current=true;if(!orderId)return()=>{alive.current=false;};let timer:ReturnType<typeof setTimeout>,tries=0;
  const poll=async()=>{const state=await check();if(alive.current&&state==='pending'&&++tries<10)timer=setTimeout(()=>void poll(),3000);};void poll();
  return()=>{alive.current=false;clearTimeout(timer);};
 },[orderId]);
 async function buy(){setBusy(true);setError('');try{await buyCreditPackage();if(alive.current)await refresh.current();}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not start checkout.');}finally{if(alive.current)setBusy(false);}}
 return <section className="credit-wallet" aria-label="Your credits"><div><strong>Your credits</strong><p>{remaining===null?'Generation balance unavailable.':`${remaining} generation attempts remaining.`} {unlocks===null?'Unlock balance unavailable.':`${unlocks} original unlock credits.`}</p><small>New accounts receive 3 free attempts. Failed accepted attempts count. Credits accumulate and do not expire. Buying an original does not add attempts.</small></div><div><button className="primary" disabled={disabled||busy} onClick={()=>void buy()}>{busy?'Opening checkout…':`Buy 5 attempts + 2 unlocks — ${packagePrice.label} CAD`}</button><p>One-time purchase · {paymentMode==='live'?'Live checkout — real charges':paymentMode==='test'?'Test checkout — no real charges':'Checkout mode unavailable'} · Buy again whenever you need more.</p><button className="text-button" disabled={disabled||busy} onClick={()=>void onRefresh()}>Refresh credits</button>{orderId&&<button className="text-button" disabled={disabled||busy} onClick={()=>void check()}>Check package payment</button>}</div>{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}</section>;
}
