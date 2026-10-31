"use client";

import {Camera} from 'lucide-react';
import type {useAuth} from './useAuth';

type HeaderProps={
 auth:ReturnType<typeof useAuth>;
 current:'create'|'gallery';
 disabled?:boolean;
 onSignedOut?:()=>void;
};

export default function Header({auth,current,disabled=false,onSignedOut}:HeaderProps){
 async function signOut(){if(await auth.signOut())onSignedOut?.();}
 return <header className="site-header">
  <a className="brand" href="/" aria-label="Forma home"><span className="brand-icon"><Camera size={19}/></span>forma<span className="brand-dot">.</span></a>
  <nav className="site-navigation" aria-label="Main navigation">
   <a href="/" aria-current={current==='create'?'page':undefined}>Create portrait</a>
   <a href="/gallery" aria-current={current==='gallery'?'page':undefined}>My Gallery</a>
  </nav>
  <div className="header-right">
   <span className="demo-badge"><span/>OpenAI portraits</span>
   <div className="account-controls">{auth.user?<>
    <span className="account-email" title={auth.user.email}>{auth.user.email}</span>
    <button className="account-button" disabled={disabled} onClick={()=>void signOut()}>Sign out</button>
   </>:<button className="account-button" disabled={disabled||auth.loading||auth.signingIn} onClick={()=>void auth.signIn()}>{auth.loading?'Checking sign-in…':auth.signingIn?'Signing in…':'Sign in with Google'}</button>}</div>
  </div>
 </header>;
}
