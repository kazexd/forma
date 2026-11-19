"use client";

import {useState} from 'react';
import CreditPlansModal from './CreditPlansModal';
import {Camera,Sparkles,KeyRound} from 'lucide-react';
import type {useAuth} from './useAuth';

type HeaderProps={
 auth:ReturnType<typeof useAuth>;
 current:'create'|'gallery';
 remaining?:number|null;
 unlocks?:number|null;
 paymentMode?:'test'|'live'|null;
 onRefreshCredits?:()=>Promise<void>;
 disabled?:boolean;
 onSignedOut?:()=>void;
};

export default function Header({auth,current,remaining=null,unlocks=null,paymentMode=null,onRefreshCredits,disabled=false,onSignedOut}:HeaderProps){
 const [planOwner,setPlanOwner]=useState<string|null>(null);
 async function signOut(){if(await auth.signOut())onSignedOut?.();}
 return <><header className="site-header">
  <a className="brand" href="/" aria-label="Forma home"><span className="brand-icon"><Camera size={19}/></span>forma<span className="brand-dot">.</span></a>
  <nav className="site-navigation" aria-label="Main navigation">
   <a href="/" aria-current={current==='create'?'page':undefined}>Create portrait</a>
   <a href="/gallery" aria-current={current==='gallery'?'page':undefined}>My Gallery</a>
  </nav>
  <div className="header-right">
   <span className="demo-badge"><span/>AI portraits</span>
   {auth.user&&<button type="button" className="header-credits" aria-label="Your credits — view purchase options" aria-haspopup="dialog" disabled={disabled} onClick={()=>setPlanOwner(auth.user!.id)}><span title="Generation attempts remaining" aria-label={remaining===null?'Generation balance unavailable':`${remaining} generation attempts remaining`}><Sparkles size={16} aria-hidden="true"/><strong>{remaining??'—'}</strong></span><span title="Original unlock credits" aria-label={unlocks===null?'Unlock balance unavailable':`${unlocks} original unlock credits`}><KeyRound size={16} aria-hidden="true"/><strong>{unlocks??'—'}</strong></span></button>}
   <div className="account-controls">{auth.user?<>
    <span className="account-email" title={auth.user.email}>{auth.user.email}</span>
    <button className="account-button" disabled={disabled} onClick={()=>void signOut()}>Sign out</button>
   </>:<button className="account-button" disabled={disabled||auth.loading||auth.signingIn} onClick={()=>void auth.signIn()}>{auth.loading?'Checking sign-in…':auth.signingIn?'Signing in…':'Sign in with Google'}</button>}</div>
  </div>
 </header>{auth.user&&planOwner===auth.user.id&&<CreditPlansModal key={auth.user.id} remaining={remaining} unlocks={unlocks} paymentMode={paymentMode} onRefresh={onRefreshCredits} onClose={()=>setPlanOwner(null)}/>}</>;
}
