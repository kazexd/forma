'use client';

import {portraitPrice} from './portrait-price.mjs';
import PortraitSharing from './PortraitSharing';
import Header from './Header';
import CreditWallet from './CreditWallet';
import Turnstile from './Turnstile';

import {useAuth} from './useAuth';
import {useEffect,useRef,useState} from 'react';
import {ArrowRight,ArrowLeft,Upload,Plus,X,Check,ShieldCheck,Sparkles,Download,LoaderCircle,Expand,Camera} from 'lucide-react';
import {canContinue,decodeImage,fileError,generatePhotos,GenerationRequestError,getGenerationRequest,getGenerationAllowance,loadPortrait,buyPortrait,unlockPortrait,downloadOriginal,styles,type Style,type GeneratedPhoto} from './photos';
const turnstileSiteKey=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY??'';
const humanVerificationRequired=process.env.NODE_ENV==='production'||Boolean(turnstileSiteKey);
type UploadPhoto={id:string;file:File;url:string};
export default function App(){
 const auth=useAuth();
 const [humanToken,setHumanToken]=useState(''),[verificationReset,setVerificationReset]=useState(0);
 const [pendingGeneration,setPendingGeneration]=useState<{id:string;status:'running'|'uncertain'}|null>(null),[generationMessage,setGenerationMessage]=useState('');
 const recoveryVersion=useRef(0);
 function savePending(id:string|null,owner=auth.user?.id){if(!owner)return;try{if(id)sessionStorage.setItem('forma-generation:'+owner,id);else sessionStorage.removeItem('forma-generation:'+owner);}catch{/* Browser storage is optional; never store input photos. */}}
 async function checkGeneration(id:string){
  const owner=account.current,version=++recoveryVersion.current;
  try{
   const job=await getGenerationRequest(id);
   if(account.current!==owner||version!==recoveryVersion.current)return;
   if(job.status==='succeeded'){
    if(job.portraitId){const photo=await loadPortrait(job.portraitId);if(account.current!==owner||version!==recoveryVersion.current)return;setResults([photo]);setStyle(photo.style);setStep(2);window.history.replaceState(null,'','?portrait='+encodeURIComponent(photo.id));setGenerationMessage('Your generated portrait was recovered.');}
    else setGenerationMessage('This generated portrait has been deleted.');
    savePending(null,owner);setPendingGeneration(null);void refreshAllowance();
   }else if(job.status==='failed'){
    savePending(null,owner);setPendingGeneration(null);setGenerationMessage('The previous attempt failed and was counted. You can start a new attempt.');void refreshAllowance();
   }else{setPendingGeneration(old=>old?.id===id?{id,status:job.status as 'running'|'uncertain'}:old);setGenerationMessage(job.status==='running'?'Your portrait is still processing. This request will not be submitted again.':'The outcome of this attempt is uncertain. Check My Gallery and the attempt status before starting another.');}
  }catch{if(account.current===owner&&version===recoveryVersion.current){setPendingGeneration(old=>old?.id===id?{id,status:'uncertain'}:old);setGenerationMessage('Could not confirm this attempt. Check its status or My Gallery before starting another.');}}
 }
 useEffect(()=>{
  recoveryVersion.current++;setPendingGeneration(null);setGenerationMessage('');setHumanToken('');
  if(auth.user){try{const id=sessionStorage.getItem('forma-generation:'+auth.user.id);if(id&&/^[0-9a-f-]{36}$/i.test(id))setPendingGeneration({id,status:'running'});}catch{}}
  return()=>{recoveryVersion.current++;};
 },[auth.user?.id]);
 const [unlocks,setUnlocks]=useState<number|null>(null),[paymentMode,setPaymentMode]=useState<'test'|'live'|null>(null);
 const [allowance,setAllowance]=useState<number|null>(null),[allowanceError,setAllowanceError]=useState('');
 const allowanceRequest=useRef(0),account=useRef(auth.user?.id);account.current=auth.user?.id;
 async function refreshAllowance(){const owner=account.current,version=++allowanceRequest.current;if(!owner)return;try{const data=await getGenerationAllowance();if(account.current===owner&&version===allowanceRequest.current){setAllowance(data.remaining);setUnlocks(data.unlocks);setPaymentMode(data.mode);setAllowanceError('');}}catch{if(account.current===owner&&version===allowanceRequest.current){setAllowance(null);setUnlocks(null);setPaymentMode(null);setAllowanceError('Could not load your generation allowance.');}}}
 useEffect(()=>{setAllowance(null);setUnlocks(null);setPaymentMode(null);setAllowanceError('');void refreshAllowance();return()=>{allowanceRequest.current++;};},[auth.user?.id]);
 const [purchasing,setPurchasing]=useState(false),[paymentMessage,setPaymentMessage]=useState('');
 const [step,setStep]=useState(0),[photos,setPhotos]=useState<UploadPhoto[]>([]),[style,setStyle]=useState<Style>('casual'),[results,setResults]=useState<GeneratedPhoto[]>([]),[busy,setBusy]=useState(false),[reading,setReading]=useState(false),[errors,setErrors]=useState<string[]>([]),[drag,setDrag]=useState(false),[zoom,setZoom]=useState<GeneratedPhoto|null>(null),[consent,setConsent]=useState(false);
 const input=useRef<HTMLInputElement>(null),dialog=useRef<HTMLDialogElement>(null),heading=useRef<HTMLHeadingElement>(null),urls=useRef(new Set<string>()),processing=useRef(false),generating=useRef(false);
 useEffect(()=>()=>{urls.current.forEach(url=>URL.revokeObjectURL(url));},[]);
 useEffect(()=>{heading.current?.focus();},[step]);
 useEffect(()=>{if(zoom)dialog.current?.showModal();else dialog.current?.close();},[zoom]);
 useEffect(()=>{
  const params=new URLSearchParams(window.location.search);const id=params.get('portrait');if(!auth.user||!id)return;
  let cancelled=false,tries=0;let timer:ReturnType<typeof setInterval>|undefined;
  const refresh=async()=>{try{const photo=await loadPortrait(id);if(cancelled)return;setResults([photo]);void refreshAllowance();setStyle(photo.style);setStep(2);if(photo.paid){setPaymentMessage('Payment confirmed. Your original is ready.');clearInterval(timer);}else if(params.get('checkout')==='success')setPaymentMessage('Waiting for verified payment confirmation. You can refresh the purchase status below.');else if(params.get('checkout')==='cancelled')setPaymentMessage('Checkout cancelled. Your watermarked preview is still available.');}catch(error){if(!cancelled)setErrors([error instanceof Error?error.message:'Could not restore your portrait.']);}};
  void refresh();if(params.get('checkout')==='success')timer=setInterval(()=>{if(++tries>=10)clearInterval(timer);void refresh();},3000);
  return()=>{cancelled=true;clearInterval(timer);};
 },[auth.user?.id]);
 async function purchase(photo:GeneratedPhoto){setPurchasing(true);setErrors([]);try{await buyPortrait(photo.id);}catch(error){setErrors([error instanceof Error?error.message:'Could not start checkout.']);}finally{setPurchasing(false);}}
 async function redeem(photo:GeneratedPhoto){const owner=account.current;setPurchasing(true);setErrors([]);try{await unlockPortrait(photo.id);const next=await loadPortrait(photo.id);if(account.current!==owner)return;setResults([next]);setZoom(null);setPaymentMessage('Original unlocked with a credit.');}catch(e){if(account.current===owner)setErrors([e instanceof Error?e.message:'Could not unlock portrait.']);}finally{setPurchasing(false);void refreshAllowance();}}
 async function download(photo:GeneratedPhoto){setPurchasing(true);setErrors([]);try{await downloadOriginal(photo.id);}catch(error){setErrors([error instanceof Error?error.message:'Could not download the original.']);}finally{setPurchasing(false);}}
 async function refreshPayment(photo:GeneratedPhoto){try{const next=await loadPortrait(photo.id);setResults([next]);setZoom(null);setPaymentMessage(next.paid?'Payment confirmed. Your original is ready.':'Payment is not confirmed yet. If you paid, wait briefly and refresh again.');}catch(error){setErrors([error instanceof Error?error.message:'Could not check payment.']);}finally{void refreshAllowance();}}
 async function addFiles(files:File[]){
  if(processing.current||generating.current)return;processing.current=true;setReading(true);const accepted:UploadPhoto[]=[],messages:string[]=[];
  try{for(const file of files){const problem=fileError(file);if(problem){messages.push(problem);continue;}if(photos.length+accepted.length>=5){messages.push('You can upload exactly 5 photos. Extra photos were not added.');continue;}
   const url=URL.createObjectURL(file);try{await decodeImage(url);urls.current.add(url);accepted.push({id:crypto.randomUUID(),file,url});}catch{URL.revokeObjectURL(url);messages.push(`${file.name}: this image could not be read. Please choose another.`);}}
   setPhotos(previous=>[...previous,...accepted]);setErrors([...new Set(messages)]);
  }finally{processing.current=false;setReading(false);if(input.current)input.current.value='';}
 }
 function remove(id:string){setPhotos(previous=>previous.filter(photo=>{if(photo.id!==id)return true;URL.revokeObjectURL(photo.url);urls.current.delete(photo.url);return false;}));setErrors([]);}
 function reset(){urls.current.forEach(url=>URL.revokeObjectURL(url));urls.current.clear();setPhotos([]);setResults([]);setErrors([]);setStyle('casual');setConsent(false);setStep(0);setZoom(null);setPaymentMessage('');window.history.replaceState(null,'',window.location.pathname);}
 async function generate(){
  if(generating.current||!consent||!auth.user||allowance===null||allowance===0||pendingGeneration||(humanVerificationRequired&&!humanToken))return;
  const requestId=crypto.randomUUID(),owner=auth.user.id;
  generating.current=true;setBusy(true);setErrors([]);setGenerationMessage('');setPendingGeneration({id:requestId,status:'running'});savePending(requestId,owner);
  try{
   const generated=await generatePhotos(photos.map(photo=>photo.file),style,{requestId,turnstileToken:humanToken});
   if(account.current!==owner)return;
   savePending(null,owner);setPendingGeneration(null);setResults(generated);if(generated[0])window.history.replaceState(null,'','?portrait='+encodeURIComponent(generated[0].id));setStep(2);
  }catch(error){
   if(account.current!==owner)return;
   setErrors([error instanceof Error?error.message:'Something went wrong. Please try again.']);
   if(error instanceof GenerationRequestError&&['generation_uncertain','generation_in_progress'].includes(error.code))setPendingGeneration({id:requestId,status:error.code==='generation_in_progress'?'running':'uncertain'});
   else{savePending(null,owner);setPendingGeneration(null);}
  }finally{generating.current=false;setBusy(false);setHumanToken('');setVerificationReset(value=>value+1);void refreshAllowance();}
 }

 useEffect(()=>{
  if(!pendingGeneration||busy)return;
  const id=pendingGeneration.id;void checkGeneration(id);
  if(pendingGeneration.status!=='running')return;
  const timer=setInterval(()=>void checkGeneration(id),5000);
  return()=>{clearInterval(timer);recoveryVersion.current++;};
 },[pendingGeneration?.id,pendingGeneration?.status,busy]);
 const currentStyle=styles.find(item=>item.id===style)!;
 return <><Header auth={auth} current="create" disabled={busy||reading||purchasing} onSignedOut={reset}/>
 <main><nav className="steps" aria-label="Progress">{['Upload photos','Choose style','View results'].map((label,i)=><div key={label} className={`step ${step===i?'active':''} ${step>i?'done':''}`} aria-current={step===i?'step':undefined}><span className="step-number">{step>i?<Check size={14}/>:i+1}</span><span>{label}</span>{i<2&&<span className="step-line"/>}</div>)}</nav>
 {auth.user&&<CreditWallet key={auth.user.id} remaining={allowance} unlocks={unlocks} paymentMode={paymentMode} onRefresh={refreshAllowance} disabled={busy||purchasing}/>}
 {auth.user&&allowanceError&&<p role="alert">{allowanceError} <button className="text-button" onClick={()=>void refreshAllowance()}>Retry allowance check</button></p>}
 {(pendingGeneration||generationMessage)&&<div className="generation-recovery"><p role="status">{generationMessage||'Your generation request has been saved. You can check its status here.'}</p>{pendingGeneration&&!busy&&<><button className="account-button" onClick={()=>void checkGeneration(pendingGeneration.id)}>Check generation status</button><a className="text-button" href="/gallery">Check My Gallery</a>{pendingGeneration.status==='uncertain'&&<button className="text-button" onClick={()=>{recoveryVersion.current++;savePending(null);setPendingGeneration(null);setGenerationMessage('The previous attempt will not be retried. Starting a new attempt will use another allowance slot if accepted.');}}>Continue with a new attempt</button>}</>}</div>}
 <div className="intro"><div className="eyebrow">YOUR NEXT CHAPTER, IN FOCUS</div><h1 ref={heading} tabIndex={-1}>{step===0?<>A great first impression.<br/><em>Starting with you.</em></>:step===1?<>Find your<br/><em>professional side.</em></>:<>Meet your next<br/><em>first impression.</em></>}</h1><p>{step===0?'Bring a few photos. We’ll show you what’s possible.':step===1?'A look that feels right for wherever you’re headed.':'A little confidence. A whole new perspective.'}</p></div>
 <div className="demo-notice"><Sparkles size={16}/><span><strong>5 photos. 1 professional portrait.</strong> Preview with a watermark, then purchase the original. Generated portraits are stored privately; portraits stay saved until you delete them from My Gallery.</span></div>
 {auth.error&&<div className="errors" role="alert">{auth.error}</div>}
 {!auth.configured&&<div className="auth-setup" role="status">Google sign-in is not configured yet. You can explore the upload flow; generation requires Supabase setup.</div>}
 {errors.length>0&&<div className="errors" role="alert">{errors.map(error=><p key={error}>{error}</p>)}</div>}
 {step===0&&<section className="workspace"><div className="upload-panel"><div className="section-heading"><div><span className="eyebrow">01 / THE STARTING POINT</span><h2>Let’s get to know your face.</h2></div><span className={`count ${canContinue(photos.length)?'complete':''}`}>{photos.length} / 5 photos</span></div>
 <input ref={input} id="photo-input" className="sr-only" tabIndex={-1} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={event=>void addFiles(Array.from(event.target.files??[]))}/>
 <button className={`dropzone ${drag?'dragging':''}`} disabled={reading} onClick={()=>input.current?.click()} onDragOver={event=>{event.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={event=>{event.preventDefault();setDrag(false);void addFiles(Array.from(event.dataTransfer.files));}}><span className="upload-icon">{reading?<LoaderCircle className="spin"/>:<Upload/>}</span><strong>{reading?'Checking your photos…':'Drop your photos here'}</strong><span>or <span className="text-link">browse files</span> to get started</span><small>Exactly 5 photos · JPG, PNG or WebP · Up to 10 MB each</small></button>
 {photos.length>0&&<div className="thumbnails">{photos.map(photo=><div className="thumbnail" key={photo.id}><img src={photo.url} alt={photo.file.name}/><button disabled={reading} aria-label={`Remove ${photo.file.name}`} onClick={()=>remove(photo.id)}><X size={13}/></button></div>)}{photos.length<5&&<button className="add-photo" disabled={reading} onClick={()=>input.current?.click()} aria-label="Add more photos"><Plus/></button>}</div>}
 <div className="panel-bottom"><span className="hint" aria-live="polite">{canContinue(photos.length)?<><Check size={16}/> You’re ready for your close-up.</>:<>Add {Math.max(0,5-photos.length)} more {5-photos.length===1?'photo':'photos'} to continue</>}</span><button className="primary" disabled={!canContinue(photos.length)||reading} onClick={()=>{setErrors([]);setStep(1);}}>Choose your style <ArrowRight size={17}/></button></div><p className="privacy"><ShieldCheck size={14}/> When you generate, your 5 photos are sent securely through our server to the configured AI service (OpenAI, or OpenRouter and its model provider).</p></div>
 <aside className="guide"><div className="guide-photo"><img src="/photos/casual-1.jpg" alt="Sample portrait in soft natural light"/><span><span className="tiny-dot"/> A little inspiration</span></div><div className="guide-body"><span className="eyebrow">GOOD PHOTOS, GREAT POSSIBILITIES</span><h3>You, in your best light.</h3><ul><li><Check size={15}/>Clear, recent photos of just you</li><li><Check size={15}/>A mix of angles and expressions</li><li><Check size={15}/>Natural light and an uncovered face</li></ul><p>Skip sunglasses, group shots, and heavy filters. Everyday photos are perfect.</p></div></aside></section>}
 {step===1&&<section className="style-section"><div className="section-heading"><div><span className="eyebrow">02 / MAKE IT YOURS</span><h2>Choose your look.</h2></div><span className="hint">1 AI portrait per generation</span></div><div className="style-grid" role="radiogroup" aria-label="Portrait style">{styles.map(item=><button key={item.id} role="radio" aria-checked={style===item.id} disabled={busy} onClick={()=>setStyle(item.id)} className={`style-card ${style===item.id?'selected':''}`}><div className="style-image"><img src={`/photos/${item.id}-1.jpg`} alt={`${item.title} sample portrait`}/><span className="style-tag">{item.tag}</span><span className="radio-mark">{style===item.id&&<Check size={14}/>}</span></div><div className="style-copy"><h3>{item.title}</h3><p>{item.description}</p></div></button>)}</div>{!auth.user&&<div className="auth-prompt"><strong>Your next impression starts with a sign-in.</strong><p>Continue with Google to create your free Forma account or sign in. Your selected photos stay in this tab.</p><button className="primary" disabled={auth.loading||auth.signingIn} onClick={()=>void auth.signIn()}>{auth.signingIn?'Waiting for Google…':'Continue with Google'}</button></div>}{auth.user&&humanVerificationRequired&&(turnstileSiteKey?<Turnstile siteKey={turnstileSiteKey} resetKey={verificationReset} onToken={setHumanToken}/>:<p role="alert">Human verification is unavailable. Please try again later.</p>)}<label className="consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/><span>I have permission to use these photos and agree to send them to the configured AI service (OpenAI, or OpenRouter and its model provider) to generate a portrait. API usage is billed to the configured account.</span></label><div className="panel-bottom"><button className="text-button" disabled={busy} onClick={()=>setStep(0)}><ArrowLeft size={16}/> Back to photos</button><button className="primary" disabled={busy||!consent||auth.loading||!auth.user||allowance===null||allowance===0||Boolean(pendingGeneration)||(humanVerificationRequired&&!humanToken)} onClick={()=>void generate()}>{busy?<><LoaderCircle size={17} className="spin"/> Generating your portrait…</>:<><Sparkles size={17}/> Generate portrait</>}</button></div>{busy&&<p className="generation-status" role="status">Creating your AI portrait. This may take a few minutes. Please keep this page open.</p>}</section>}
 {step===2&&<section className="results-section"><div className="section-heading"><div><span className="eyebrow">03 / A FRESH PERSPECTIVE</span><h2>Your {currentStyle.title.toLowerCase()} gallery.</h2></div><span className="count">1 AI portrait</span></div><a className="text-button" href="/gallery">View my gallery</a><div className="results-grid">{results.map((photo,i)=><article key={photo.id} className="result-card"><button className="result-image" onClick={()=>setZoom(photo)} aria-label={`Enlarge portrait ${i+1}`}><img src={photo.previewUrl} alt={`${currentStyle.title} AI portrait ${i+1}`}/><span className="expand"><Expand size={17}/></span><span className="sample-label">{photo.paid?'PURCHASED ORIGINAL':'WATERMARKED PREVIEW'}</span></button><div className="result-caption"><span>Portrait 0{i+1}</span><span className="preview-badge">{photo.paid?'PURCHASED':'WATERMARKED PREVIEW'}</span></div></article>)}</div><div className="purchase-panel"><strong>Keep the portrait you love.</strong><p>{paymentMode==='test'?'Test checkout':'Secure checkout'} · Unlock with a credit or a verified single-photo payment. One watermark-free original costs {portraitPrice.label} USD.</p>{results.map(photo=><div className="purchase-actions" key={photo.id}>{photo.paid?<button className="primary" disabled={purchasing} onClick={()=>void download(photo)}><Download size={17}/> Download original</button>:<button className="primary" disabled={purchasing} onClick={()=>void purchase(photo)}>{purchasing?'Opening checkout…':'Buy original — '+portraitPrice.label+' USD'}</button>}{!photo.paid&&<button className="account-button" disabled={purchasing||unlocks===null||unlocks===0} onClick={()=>void redeem(photo)}>Use 1 unlock credit</button>}<button className="text-button" disabled={purchasing} onClick={()=>void refreshPayment(photo)}>Refresh purchase status</button></div>)}{results.filter(photo=>photo.paid).map(photo=><PortraitSharing key={photo.id} id={photo.id} disabled={purchasing}/>)}{paymentMessage&&<p role="status">{paymentMessage}</p>}</div><div className="panel-bottom"><button className="text-button" disabled={photos.length!==5||purchasing} onClick={()=>{setResults([]);setStep(1);}}><ArrowLeft size={16}/> Try another style</button><button className="primary" disabled={purchasing} onClick={reset}>Start over <Plus size={17}/></button></div><p className="privacy">{results[0]?.paid?'Your purchased original is shown without a watermark. Download or share your portrait above.':'This preview has a permanent watermark. Review your likeness before purchasing; originals are kept in private storage.'}</p></section>}
 <div className="trust-strip"><span><ShieldCheck size={17}/>Private by design</span><span><Camera size={17}/>Private portrait storage</span><span><Sparkles size={17}/>AI professional portraits</span></div></main>
 <footer><a className="brand" href="/">forma.</a><span>A little more you. A little more professional.</span><span>LOCAL APP · SUPABASE AUTH</span></footer>
 <dialog ref={dialog} onCancel={()=>setZoom(null)} onClick={event=>{if(event.target===event.currentTarget)setZoom(null);}} onClose={()=>setZoom(null)}><button className="dialog-close" aria-label="Close preview" onClick={()=>setZoom(null)} autoFocus><X/></button>{zoom&&<><img src={zoom.previewUrl} alt="Enlarged AI professional portrait"/><div className="dialog-bottom"><span>Watermarked preview · Original available after purchase</span></div></>}</dialog></>;
}

