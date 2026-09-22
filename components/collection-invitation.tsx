"use client";

import {useEffect,useState} from "react";
import {requestJson} from "@/lib/api-client";
import {formatBytes} from "@/lib/contracts";

const storageKey="relay-pending-collection";
type Preview={id:string;title:string;receivingLibrary:string;expiresAt:number;maxFiles:number;maxFileBytes:number;maxBytes:number};

// Keep the secret in this tab through hosted sign-in; only explicit acceptance binds the account.
// Neither preview nor acceptance joins the receiving library or discloses its existing originals.
export default function CollectionInvitation({sessionId}:{sessionId?:string}) {
  const [token,setToken]=useState(""),[preview,setPreview]=useState<Preview|null>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  useEffect(()=>{
    const controller=new AbortController();
    try {
      const fragment=/^#request=([a-f0-9]{64})$/.exec(location.hash)?.[1];
      if(fragment){sessionStorage.setItem(storageKey,fragment);history.replaceState(null,"",location.pathname+location.search);}
      const pending=sessionStorage.getItem(storageKey)||"";
      if(!/^[a-f0-9]{64}$/.test(pending))return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate tab storage only after browser mount.
      setToken(pending);setPreview(null);setError("");
      if(sessionId)void requestJson<Preview>("intake/preview",{method:"POST",body:JSON.stringify({token:pending}),signal:controller.signal})
        .then(result=>{if(!controller.signal.aborted)setPreview(result);})
        .catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    }catch{setError("Sign in first, then reopen your request link. This browser could not preserve it during sign-in.");}
    return()=>controller.abort();
  },[sessionId]);
  // Preserve the invitation on failure so an interrupted acceptance can be safely retried.
  async function acceptCollection(){
    setBusy(true);setError("");
    try{
      const result=await requestJson<Preview>("intake/accept",{method:"POST",body:JSON.stringify({token})});
      sessionStorage.removeItem(storageKey);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Open the accepted request with fresh account-scoped state.
      location.assign(`/collect?request=${encodeURIComponent(result.id)}`);
    }catch(failure){setError(failure instanceof Error?failure.message:"The request could not be accepted.");setBusy(false);}
  }
  if(!token&&!error)return null;
  return <section className="collection-invitation rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6 mb-8">
    <h2 className="text-lg font-semibold">{preview?.title||"Your upload request"}</h2>
    {error&&<p role="alert" className="error-banner">{error}</p>}
    {!sessionId&&<p className="mt-3 text-sm leading-6">Sign in with the email invited by the organiser, then review this request. You will not join their library.</p>}
    {preview&&<><p className="mt-3">Send originals to {preview.receivingLibrary}.</p><p className="mt-3 text-sm leading-6">Up to {preview.maxFiles} files, {formatBytes(preview.maxFileBytes)} per file and {formatBytes(preview.maxBytes)} total. Ends {new Date(preview.expiresAt).toLocaleString()}.</p><p className="mt-3 text-sm leading-6">The organiser reviews your originals before adding them to their chosen library audience. Originals may contain location or other embedded metadata. Shared contributions remain with the library if you leave.</p><button className="account-primary-action mt-5 min-h-11 rounded-xl px-4" disabled={busy} onClick={()=>void acceptCollection()}>{busy?"Opening request...":"Accept and choose files"}</button></>}
    <button className="mt-3 min-h-11 px-4 text-sm" disabled={busy} onClick={()=>{try{sessionStorage.removeItem(storageKey);}catch{/* No tab storage was available. */}setToken("");setPreview(null);setError("");}}>Dismiss request</button>
  </section>;
}
