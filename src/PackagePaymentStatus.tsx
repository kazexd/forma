'use client';
import {useEffect,useRef,useState} from 'react';
import {getPackageStatus} from './photos';

export default function PackagePaymentStatus({onRefresh,disabled=false}:{onRefresh:()=>Promise<void>;disabled?:boolean}){
 const [error,setError]=useState(''),[message,setMessage]=useState('');
 const alive=useRef(true),refresh=useRef(onRefresh);refresh.current=onRefresh;
 const [orderId]=useState(()=>typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('package'));
 async function check(){if(!orderId)return;try{const state=await getPackageStatus(orderId);if(!alive.current)return;setError('');setMessage(state==='paid'?'Payment confirmed. 5 generation attempts and 2 unlock credits have been added.':state==='expired'?'Package checkout expired. No credits were added.':'Payment is not confirmed yet. Wait briefly and check again.');await refresh.current();return state;}catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not confirm payment.');}}
 useEffect(()=>{alive.current=true;if(!orderId)return()=>{alive.current=false;};let timer:ReturnType<typeof setTimeout>,tries=0;
  const poll=async()=>{const state=await check();if(alive.current&&state==='pending'&&++tries<10)timer=setTimeout(()=>void poll(),3000);};void poll();
  return()=>{alive.current=false;clearTimeout(timer);};
 },[orderId]);
 if(!orderId)return null;
 return <div className="package-payment-status">{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}<button className="text-button" disabled={disabled} onClick={()=>void check()}>Check package payment</button></div>;
}
