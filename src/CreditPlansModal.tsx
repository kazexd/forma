"use client";
import {useEffect,useRef,useState} from 'react';
import {Sparkles,KeyRound,Check,X} from 'lucide-react';
import {buyCreditPackage} from './photos';
import {creditPackages,portraitPrice} from './portrait-price.mjs';
import PurchasePolicies from './PurchasePolicies';

export default function CreditPlansModal({remaining,unlocks,paymentMode,onClose,onRefresh}:{remaining:number|null;unlocks:number|null;paymentMode:'test'|'live'|null;onClose:()=>void;onRefresh?:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(true),submitting=useRef(false);
 const [buying,setBuying]=useState<'starter'|'plus'|null>(null);
 const [busy,setBusy]=useState(false),[refreshing,setRefreshing]=useState(false),[error,setError]=useState('');
 useEffect(()=>{alive.current=true;dialog.current?.showModal();return()=>{alive.current=false;dialog.current?.close();};},[]);
 function close(){if(!submitting.current)onClose();}
 async function buy(plan:'starter'|'plus'){
  if(submitting.current||paymentMode===null)return;
  submitting.current=true;setBuying(plan);setBusy(true);setError('');
  try{await buyCreditPackage(plan);if(alive.current)await onRefresh?.();}
  catch(e){if(alive.current)setError(e instanceof Error?e.message:'Could not open checkout. Please try again.');}
  finally{submitting.current=false;if(alive.current){setBusy(false);setBuying(null);}}
 }
 async function refresh(){setRefreshing(true);setError('');try{await onRefresh?.();}catch{if(alive.current)setError('Could not refresh your credits. Please try again.');}finally{if(alive.current)setRefreshing(false);}}
 return <dialog ref={dialog} className="credit-plans-dialog" aria-labelledby="credit-plans-title" onCancel={event=>{event.preventDefault();close();}} onClick={event=>{if(event.target===event.currentTarget)close();}}>
  <button className="dialog-close" aria-label="Close purchase options" disabled={busy} onClick={close}><X size={18}/></button>
  <span className="eyebrow">YOUR NEXT GREAT PORTRAIT</span>
  <h2 id="credit-plans-title">A little more possibility.</h2>
  <p className="plans-intro">Choose more attempts, or unlock a portrait you already love.</p>
  <div className="plans-balance"><span><Sparkles size={16} aria-hidden="true"/>{remaining??'—'} generation attempts</span><span><KeyRound size={16} aria-hidden="true"/>{unlocks??'—'} original unlocks</span></div>
  <div className="credit-package-options">{creditPackages.map(plan=><section key={plan.id} className={`credit-package-card ${plan.id==='plus'?'package-plus':''}`} aria-label={`${plan.name} credit package`}>
   <span className="eyebrow">{plan.name.toUpperCase()} PACKAGE</span><div className="plan-price">{plan.label}<span> CAD</span></div>
   <ul><li><Check size={16} aria-hidden="true"/>{plan.generations} generation attempts</li><li><Check size={16} aria-hidden="true"/>{plan.unlocks} watermark-free original {plan.unlocks===1?'unlock':'unlocks'}</li><li><Check size={16} aria-hidden="true"/>Credits accumulate. No expiry.</li></ul>
   <button className="primary" autoFocus={plan.id==='plus'} disabled={busy||refreshing||paymentMode===null} onClick={()=>void buy(plan.id)}>{buying===plan.id?'Opening checkout…':`Buy credit package — ${plan.label} CAD`}</button>
  </section>)}</div>
  <p className="plan-note">One-time purchases. No subscription. Buy either package again whenever you need more.</p>
  <section className="single-portrait-plan" aria-label="Single original"><div><strong>Just one original?</strong><p>{portraitPrice.label} CAD to unlock a specific photo. No generation attempts included.</p></div><a className="account-button" aria-disabled={busy||undefined} onClick={event=>{if(busy)event.preventDefault();}} href="/gallery">Choose in My Gallery</a></section>
  <p className="checkout-mode-note">{paymentMode==='live'?'Live checkout — real charges.':paymentMode==='test'?'Test checkout — no real charges.':'Checkout mode unavailable. Refresh your credits before paying.'}</p>
  <PurchasePolicies/>
  <p className="plan-note">Delivered portraits use one attempt, even if you dislike the result. Confirmed technical failures restore your attempt. Buying an original does not add attempts.</p>
  {error&&<p role="alert" className="plans-error">{error}</p>}
  {onRefresh&&<button className="text-button" disabled={busy||refreshing} onClick={()=>void refresh()}>{refreshing?'Refreshing…':'Refresh credits'}</button>}
 </dialog>;
}
