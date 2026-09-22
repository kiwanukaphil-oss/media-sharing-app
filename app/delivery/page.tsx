"use client";
import {useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowDown,FileImage,FileVideo,File,PackageCheck,ShieldCheck,X} from "lucide-react";
import DeliveryInvitation from "@/components/delivery-invitation";
import {requestJson} from "@/lib/api-client";
import {formatBytes} from "@/lib/contracts";
import {saveVerifiedOriginal,supportsVerifiedSave} from "@/lib/downloads";

type Item={id:string;name:string;mime:string;size:number;sha256:string;capturedAt:string|null};
type Delivery={delivery:{id:string;title:string;senderName:string;expiresAt:number;fileCount:number;totalBytes:number};items:Item[]};

// Keep the delivery focused on the sender's captured selection. Refresh clears every filename on
// lost access; download status distinguishes a browser request from an explicitly verified save.
export default function DeliveryPage(){
  const [session,setSession]=useState<{sessionId:string}|null>(null),[checked,setChecked]=useState(false),[id,setId]=useState("");
  const [delivery,setDelivery]=useState<Delivery|null>(null),[error,setError]=useState(""),[notice,setNotice]=useState(""),[revision,setRevision]=useState(0);
  const [verified,setVerified]=useState(false),[saving,setSaving]=useState<string|null>(null),[progress,setProgress]=useState(0);
  const savingController=useRef<AbortController|null>(null);
  useEffect(()=>{
    const controller=new AbortController(),candidate=new URLSearchParams(location.search).get("id")||"";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser URL and picker capability are unavailable during SSR.
    setId(/^[a-f0-9-]{36}$/.test(candidate)?candidate:"");setVerified(supportsVerifiedSave());
    void requestJson<{account:{sessionId:string}|null}>("auth/session",{signal:controller.signal}).then(value=>{if(!controller.signal.aborted){setSession(value.account);setChecked(true);}})
      .catch(failure=>{if(!controller.signal.aborted){setError(failure.message);setChecked(true);}});
    return()=>{controller.abort();savingController.current?.abort();};
  },[]);
  useEffect(()=>{
    if(!session||!id)return;
    const controller=new AbortController();let current=0;
    const refresh=async()=>{
      const generation=++current;
      try{const value=await requestJson<Delivery>(`delivery/${id}`,{signal:controller.signal});if(!controller.signal.aborted&&generation===current){setDelivery(value);setError("");}}
      catch(failure){if(!controller.signal.aborted&&generation===current){setDelivery(null);savingController.current?.abort();setNotice("");setError(failure instanceof Error?failure.message:"This delivery is unavailable.");}}
    };
    void refresh();const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},15000);
    const foreground=()=>{if(document.visibilityState==="visible")void refresh();};document.addEventListener("visibilitychange",foreground);
    return()=>{controller.abort();clearInterval(timer);document.removeEventListener("visibilitychange",foreground);};
  },[session,id,revision]);
  // Open the native save picker within the click gesture and verify streamed bytes before commit.
  async function save(item:Item){
    if(saving)return;
    const controller=new AbortController();savingController.current=controller;setSaving(item.id);setProgress(0);setNotice("");
    try{await saveVerifiedOriginal(item,{linkPath:`delivery/${id}/${item.id}/link`,signal:controller.signal,onProgress:setProgress});setNotice(`${item.name} saved. Original file verified.`);}
    catch(failure){if(!(failure instanceof DOMException&&failure.name==="AbortError"))setNotice(failure instanceof Error?failure.message:"This original could not be saved.");}
    finally{setSaving(null);savingController.current=null;}
  }
  return <main className="account-page delivery-page min-h-screen">
    <Link href="/account" className="text-sm text-[var(--muted)]">Your account</Link>
    <header className="mt-12 mb-8"><div className="delivery-symbol"><PackageCheck size={28}/></div><p className="delivery-eyebrow">ORIGINALS, READY FOR YOU</p><h1 className="text-3xl font-semibold tracking-tight">{delivery?.delivery.title||"A delivery for you"}</h1>{delivery&&<p className="delivery-from">From {delivery.delivery.senderName}</p>}</header>
    {!id&&<DeliveryInvitation sessionId={session?.sessionId}/>}
    {error&&<div role="alert" className="error-banner">{error}{session&&id&&<button className="text-button" onClick={()=>setRevision(value=>value+1)}>Retry</button>}</div>}
    {!checked&&<p role="status">Checking your account...</p>}
    {checked&&!session&&<section className="rounded-2xl border border-[var(--line)] p-6"><p>Sign in with the email invited by the sender.</p><Link href="/account" className="account-primary-action inline-flex mt-5 rounded-xl px-5 py-3">Continue to sign in</Link>{id&&<p className="mt-3 text-sm">Return to this page after signing in.</p>}</section>}
    {delivery&&<><section className="delivery-summary"><div><strong>{delivery.delivery.fileCount} originals</strong><span>{formatBytes(delivery.delivery.totalBytes)}</span></div><p>Available until {new Date(delivery.delivery.expiresAt).toLocaleString()}</p></section>
      <p className="delivery-note"><ShieldCheck size={16}/><span>Original quality. Embedded location and other original metadata are preserved.</span></p>
      <div className="delivery-originals">{delivery.items.map(item=><article className="delivery-original" key={item.id}><div className="delivery-file-symbol">{item.mime.startsWith("image/")?<FileImage size={26}/>:item.mime.startsWith("video/")?<FileVideo size={26}/>:<File size={26}/>}</div><div className="delivery-file-details"><h2>{item.name}</h2><p>{formatBytes(item.size)} &middot; Original</p>{saving===item.id&&<p role="status">Saving and verifying: {progress}%</p>}</div>{verified?<button className="button secondary compact" disabled={Boolean(saving)} onClick={()=>void save(item)}><ArrowDown size={16}/>Save verified</button>:<a className="button secondary compact" href={`/api/delivery/${id}/${item.id}/download`} download={item.name} onClick={()=>setNotice("Download requested. Check your browser's downloads.")}><ArrowDown size={16}/>Save original</a>}</article>)}</div>
      {saving&&<button className="text-button" onClick={()=>savingController.current?.abort()}><X size={16}/>Cancel save</button>}
      {notice&&<p className="delivery-status" role="status">{notice}</p>}
      <footer className="delivery-footer">A reviewed selection, separate from the sender&apos;s working library. The sender can end new access; copies you already saved stay on your device.</footer>
    </>}
  </main>;
}
