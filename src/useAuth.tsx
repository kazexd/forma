import {useEffect,useRef,useState} from 'react';
import type {User} from '@supabase/supabase-js';
import {supabase,authConfigured} from './auth';

export function useAuth(){
 const [user,setUser]=useState<User|null>(null);
 const [loading,setLoading]=useState(authConfigured);
 const [signingIn,setSigningIn]=useState(false);
 const [error,setError]=useState<string|null>(null);
 const popup=useRef<Window|null>(null);
 const timer=useRef<ReturnType<typeof setInterval>|null>(null);
 function stopWatching(){if(timer.current){clearInterval(timer.current);timer.current=null;}}
 useEffect(()=>{
  if(!supabase)return;
  let mounted=true;
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
   if(!mounted)return;
   setUser(session?.user??null);setLoading(false);
   if(session){setError(null);setSigningIn(false);stopWatching();}
  });
  void supabase.auth.getSession().then(({data,error})=>{
   if(!mounted)return;
   if(error)setError('Could not restore your sign-in. Please sign in again.');
   setUser(data.session?.user??null);setLoading(false);
  }).catch(()=>{if(mounted){setError('Could not restore your sign-in. Please sign in again.');setLoading(false);}});
  return()=>{mounted=false;subscription.unsubscribe();stopWatching();popup.current?.close();};
 },[]);
 async function signIn(){
  if(signingIn||loading)return;
  if(!supabase){setError('Sign-in is not configured yet. Follow the Supabase setup in README.');return;}
  // A popup keeps uploaded File objects in the original tab's memory.
  const opened=window.open('about:blank','forma-google-login','popup,width=520,height=700');
  if(!opened){setError('Please allow the sign-in popup and try again. Your photos are still here.');return;}
  popup.current=opened;setSigningIn(true);setError(null);
  try{
   const {data,error}=await supabase.auth.signInWithOAuth({provider:'google',options:{redirectTo:`${window.location.origin}/auth/callback`,skipBrowserRedirect:true,queryParams:{prompt:'select_account'}}});
   if(error||!data.url)throw new Error('Could not start Google sign-in. Check the Supabase Google provider settings and try again.');
   opened.location.href=data.url;
   const started=Date.now();
   timer.current=setInterval(()=>{
    if(opened.closed){stopWatching();setSigningIn(false);void supabase!.auth.getSession().then(({data})=>{if(!data.session)setError('Sign-in was not completed. Your photos are still here; please try again.');}).catch(()=>setError('Could not complete sign-in. Please try again.'));}
    else if(Date.now()-started>5*60_000){stopWatching();opened.close();setSigningIn(false);setError('Sign-in timed out. Your photos are still here; please try again.');}
   },500);
  }catch(error){opened.close();setSigningIn(false);setError(error instanceof Error?error.message:'Could not sign in. Please try again.');}
 }
 async function signOut(){
  if(!supabase)return false;
  setError(null);
  try{const {error}=await supabase.auth.signOut({scope:'local'});if(error)throw error;setUser(null);return true;}
  catch{setError('Could not sign out. Please try again.');return false;}
 }
 return {user,loading,signingIn,error,configured:authConfigured,signIn,signOut};
}

export function AuthCallback(){
 const auth=useAuth();
 const params=new URLSearchParams(window.location.search);
 const callbackError=params.has('error')||params.has('error_description');
 useEffect(()=>{if(!auth.loading&&auth.user&&window.opener)window.close();},[auth.loading,auth.user]);
 return <main className="auth-callback"><a className="brand" href="/">forma.</a><h1>{auth.user?'You’re signed in.':'Connecting your account.'}</h1><p role={callbackError||auth.error?'alert':'status'}>{callbackError?'Google sign-in was cancelled or declined. Close this window and try again.':auth.error??(!auth.configured?'Supabase sign-in is not configured yet.':auth.user?'You can close this window and return to your photos.':auth.loading?'Finishing Google sign-in…':'Sign-in could not be completed. Close this window and try again.')}</p>{auth.user&&<a className="primary" href="/">Continue to Forma</a>}</main>;
}
