"use client";

import {useCallback,useEffect,useRef,useState} from "react";
import Link from "next/link";
import {ArrowUpFromLine,Check,Pause,ShieldCheck} from "lucide-react";
import CollectionInvitation from "@/components/collection-invitation";
import {requestJson} from "@/lib/api-client";
import {formatBytes} from "@/lib/contracts";
import {hashOriginal,sendPart} from "@/lib/transfers";

type Receipt={id:string;name:string;size:number;sha256:string;phase:string};
type Collection={paused?:boolean;request:{id:string;title:string;receivingLibrary:string;expiresAt:number;maxFileBytes:number;remainingBytes:number;remainingFiles:number};receipts:Receipt[];account:{personId:string;verifiedEmail:string}};
type Part={partNumber:number;etag:string};

// This focused surface never resolves a library membership. Server receipts are the recovery source;
// bounded tab-local ETags merely avoid resending parts and never confer authority or store originals.
export default function CollectPage(){
  const [session,setSession]=useState<{sessionId:string}|null>(null),[signedIn,setSignedIn]=useState(false),[checked,setChecked]=useState(false);
  const [requestId,setRequestId]=useState(""),[collection,setCollection]=useState<Collection|null>(null),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState(""),[revision,setRevision]=useState(0);
  const controller=useRef<AbortController|null>(null),input=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    const abort=new AbortController();
    const id=new URLSearchParams(location.search).get("request")||"";
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read the browser URL after mount.
    setRequestId(/^[a-f0-9-]{36}$/.test(id)?id:"");
    void requestJson<{account:{sessionId:string}|null}>("auth/session",{signal:abort.signal}).then(result=>{
      if(abort.signal.aborted)return;setSession(result.account);setSignedIn(Boolean(result.account));setChecked(true);
    }).catch(failure=>{if(!abort.signal.aborted){setError(failure.message);setChecked(true);}});
    return()=>{abort.abort();controller.current?.abort();};
  },[]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    try{const result=await requestJson<Collection>(`intake/requests/${requestId}`,{signal});if(!signal?.aborted){setCollection(result);}return result;}
    catch(failure){if(!signal?.aborted){setCollection(null);setError(failure instanceof Error?failure.message:"This request is unavailable.");}throw failure;}
  },[requestId]);
  useEffect(()=>{
    if(!signedIn||!requestId)return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize authoritative receipts after awaited network reads.
    const abort=new AbortController();void refresh(abort.signal).catch(()=>{});
    const timer=setInterval(()=>{if(!busy&&document.visibilityState==="visible")void refresh(abort.signal).catch(()=>{});},15000);
    return()=>{abort.abort();clearInterval(timer);};
  },[signedIn,requestId,revision,refresh,busy]);

  // Re-read current allowance, hash the selected original, and reuse only an exact unfinished receipt.
  // Every part and completion is separately authorised; pause preserves reservation rather than deleting bytes.
  async function sendOriginal(file:File){
    if(!collection||busy)return;
    const abort=new AbortController();controller.current=abort;setBusy(true);setError("");
    let storageKey="";
    try{
      const current=await refresh(abort.signal);
      if(current.paused)throw new Error("Uploads are temporarily paused. Your existing reservations are retained.");
      if(file.size<=0||file.size>current.request.maxFileBytes)throw new Error(`Choose a non-empty original up to ${formatBytes(current.request.maxFileBytes)}.`);
      const hash=await hashOriginal(file,abort.signal,value=>setProgress(`Checking ${file.name}: ${value}%`));
      const previous=current.receipts.find(receipt=>receipt.sha256===hash&&receipt.size===file.size&&receipt.name===file.name&&["reserved","starting","uploading"].includes(receipt.phase));
      if(!previous&&(current.request.remainingFiles<1||file.size>current.request.remainingBytes))throw new Error("This request has insufficient remaining allowance. Contact the organiser.");
      const intentKey=`relay-intake-intent:${current.account.personId}:${requestId}:${hash}:${encodeURIComponent(file.name)}`;
      let savedId="";
      try{savedId=sessionStorage.getItem(intentKey)||"";}catch{/* Current receipts still provide server recovery. */}
      const id=previous?.id||(/^[a-f0-9-]{36}$/.test(savedId)?savedId:crypto.randomUUID());
      // Persist intent before reservation: a lost response must not silently reserve a second file.
      try{sessionStorage.setItem(intentKey,id);}catch{throw new Error("Allow tab storage before uploading so interrupted requests can be retried safely.");}
      storageKey=`relay-intake:${current.account.personId}:${requestId}:${id}`;
      let parts:Part[]=[];
      try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||"[]") as Part[];if(Array.isArray(saved)&&saved.length<=16&&saved.every(part=>Number.isInteger(part.partNumber)&&part.partNumber>0&&part.partNumber<=16&&typeof part.etag==="string"&&part.etag.length<=200))parts=saved;}catch{/* Server receipts still recover the exact upload if tab storage is unavailable. */}
      const upload=await requestJson<{id:string;partSize:number;status:string}>("intake/uploads",{method:"POST",signal:abort.signal,body:JSON.stringify({id,requestId,name:file.name,mime:file.type||"application/octet-stream",size:file.size,sha256:hash})});
      if(!["received","accepted"].includes(upload.status)){
        for(let offset=0,number=1;offset<file.size;offset+=upload.partSize,number++){
          abort.signal.throwIfAborted();if(parts.some(part=>part.partNumber===number))continue;
          const capability=await requestJson<{url:string}>(`intake/uploads/${id}/part`,{method:"POST",signal:abort.signal,body:JSON.stringify({number})});
          const etag=await sendPart(capability.url,file.slice(offset,offset+upload.partSize),abort.signal,sent=>setProgress(`Sending ${file.name}: ${Math.round((offset+sent)/file.size*100)}%`));
          parts.push({partNumber:number,etag});
          try{sessionStorage.setItem(storageKey,JSON.stringify(parts));}catch{/* Reselecting resends parts safely when storage is unavailable. */}
        }
        setProgress("Confirming receipt...");
        await requestJson(`intake/uploads/${id}/complete`,{method:"POST",signal:abort.signal,body:JSON.stringify({parts})});
      }
      try{sessionStorage.removeItem(storageKey);}catch{/* Receipt is authoritative. */}
      try{sessionStorage.removeItem(intentKey);}catch{/* Receipt is authoritative. */}
      setProgress(`${file.name} received for review.`);await refresh(abort.signal);
    }catch(failure){setError(abort.signal.aborted?"Paused. Choose the same original to continue; its reservation is retained.":failure instanceof Error?failure.message:"Upload interrupted. Choose the same original to retry.");}
    finally{setBusy(false);controller.current=null;if(input.current)input.current.value="";}
  }
  return <main className="account-page collection-page min-h-screen">
    <Link href="/account" className="text-sm text-[var(--muted)]">Your account</Link>
    <header className="mt-12 mb-8"><ShieldCheck size={30}/><h1 className="mt-5 text-3xl font-semibold tracking-tight">{collection?.request.title||"Send your originals"}</h1><p className="mt-3 text-[var(--muted)]">A private handoff to the organiser, with a receipt for every file.</p></header>
    {!requestId&&<CollectionInvitation sessionId={session?.sessionId}/>}
    {error&&<div role="alert" className="error-banner">{error}{!busy&&<button className="text-button" onClick={()=>{setError("");setRevision(value=>value+1);}}>Refresh request</button>}</div>}
    {!checked&&<p role="status">Checking your account...</p>}
    {checked&&!signedIn&&<section className="rounded-2xl border border-[var(--line)] p-6"><p>Sign in with the email invited by the organiser.</p><Link className="account-primary-action inline-flex mt-5 rounded-xl px-5 py-3" href="/account">Continue to sign in</Link>{requestId&&<p className="mt-3 text-sm">Return to this page after signing in.</p>}</section>}
    {collection&&<>
      <section className="rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6"><h2 className="font-semibold">For {collection.request.receivingLibrary}</h2><p className="mt-2 text-sm break-words">Sending as {collection.account.verifiedEmail}</p><p className="mt-4 text-sm">{collection.request.remainingFiles} files and {formatBytes(collection.request.remainingBytes)} remaining. Up to {formatBytes(collection.request.maxFileBytes)} per file.</p><p className="mt-2 text-sm">Ends {new Date(collection.request.expiresAt).toLocaleString()}.</p><p className="mt-4 text-sm leading-6 text-[var(--muted)]">The organiser verifies each original before adding it to their library audience. Embedded location and other metadata travel with the original.</p>
      {collection.paused&&<p role="status" className="mt-4 text-sm">Uploads are temporarily paused. Your receipts and reserved files are retained; try again later.</p>}
      <label className={`account-primary-action inline-flex items-center gap-2 mt-6 rounded-xl px-5 py-3 ${busy?"opacity-50":"cursor-pointer"}`}><ArrowUpFromLine size={18}/>Choose an original<input ref={input} type="file" className="sr-only" disabled={busy||collection.paused} onChange={event=>{const file=event.target.files?.[0];if(file)void sendOriginal(file);}}/></label>
      {busy&&<button className="text-button ml-3" onClick={()=>controller.current?.abort()}><Pause size={16}/>Pause</button>}
      <p className="mt-3 text-xs text-[var(--muted)]">Keep this tab open while sending. To continue an interrupted upload, choose the same original again.</p>
      {progress&&<p className="mt-4 text-sm" role="status">{progress}</p>}</section>
      <section className="mt-8"><h2 className="text-lg font-semibold">Your receipts</h2>{!collection.receipts.length?<p className="mt-3 text-sm text-[var(--muted)]">Your first receipt will appear here.</p>:collection.receipts.map(receipt=><div key={receipt.id} className="intake-file"><div><strong>{receipt.name||"Original"}</strong><p>{formatBytes(receipt.size)} &middot; {receipt.phase==="accepted"?"Verified and accepted":receipt.phase==="received"?"Received, awaiting organiser review":receipt.phase==="rejected"?"Declined by the organiser; retained outside the library":"Unfinished: choose the same original to continue"}</p></div>{receipt.phase==="accepted"&&<Check size={18} aria-label="Accepted"/>}</div>)}</section>
    </>}
  </main>;
}
