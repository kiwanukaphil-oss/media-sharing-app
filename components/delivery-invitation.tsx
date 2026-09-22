"use client";
import {useEffect,useState} from "react";
import {requestJson} from "@/lib/api-client";
import {formatBytes} from "@/lib/contracts";
const storageKey="relay-pending-delivery";
type Preview={id:string;title:string;senderName:string;expiresAt:number;fileCount:number;totalBytes:number};

// Preserve a secret locator only in this tab through sign-in; the fragment never reaches the server.
// Explicit acceptance binds this account to the delivery without joining the sender's source library.
export default function DeliveryInvitation({sessionId}:{sessionId?:string}){
  const [token,setToken]=useState(""),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    try{
      const fragment=/^#delivery=([a-f0-9]{64})$/.exec(location.hash)?.[1];
      if(fragment){sessionStorage.setItem(storageKey,fragment);history.replaceState(null,"",location.pathname+location.search);}
      const pending=sessionStorage.getItem(storageKey)||"";if(!/^[a-f0-9]{64}$/.test(pending))return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate browser tab state only after mount.
      setToken(pending);setPreview(null);setError("");
      if(sessionId)void requestJson<Preview>("delivery/preview",{method:"POST",body:JSON.stringify({token:pending}),signal:controller.signal})
        .then(value=>{if(!controller.signal.aborted)setPreview(value);}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    }catch{setError("Sign in first, then reopen your delivery link. This browser could not preserve it during sign-in.");}
    return()=>controller.abort();
  },[sessionId]);
  // Discard the secret only after successful acceptance; a lost response remains safely retryable.
  async function accept(){
    setBusy(true);setError("");
    try{
      const result=await requestJson<{id:string}>("delivery/accept",{method:"POST",body:JSON.stringify({token})});
      sessionStorage.removeItem(storageKey);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Open only the explicitly accepted delivery with fresh state.
      location.assign(`/delivery?id=${encodeURIComponent(result.id)}`);
    }catch(failure){setError(failure instanceof Error?failure.message:"This delivery could not be opened.");setBusy(false);}
  }
  if(!token&&!error)return null;
  return <section className="delivery-invitation rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 mb-8">
    <h2 className="text-lg font-semibold">{preview?.title||"Your delivery invitation"}</h2>
    {error&&<p role="alert" className="error-banner">{error}</p>}
    {!sessionId&&<p className="mt-3 text-sm leading-6">Sign in below with the invited email to review this delivery. You will not join the sender&apos;s library.</p>}
    {preview&&<><p className="mt-3">From {preview.senderName}</p><p className="mt-3 text-sm leading-6">{preview.fileCount} originals &middot; {formatBytes(preview.totalBytes)} &middot; Available until {new Date(preview.expiresAt).toLocaleString()}.</p><p className="mt-3 text-sm leading-6">Open and save this reviewed selection. Access can end if the sender withdraws it or a source becomes unavailable.</p><button className="account-primary-action mt-5 min-h-11 rounded-xl px-4" disabled={busy} onClick={()=>void accept()}>{busy?"Opening delivery...":"Accept and open delivery"}</button></>}
    <button className="mt-3 min-h-11 px-4 text-sm" disabled={busy} onClick={()=>{try{sessionStorage.removeItem(storageKey);}catch{/* No tab storage was available. */}setToken("");setPreview(null);setError("");}}>Dismiss invitation</button>
  </section>;
}
