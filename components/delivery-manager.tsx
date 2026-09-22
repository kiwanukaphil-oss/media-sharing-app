"use client";
import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import {Copy,PackageCheck,RefreshCw,ShieldCheck,X} from "lucide-react";
import {createLibraryApi} from "@/lib/api-client";
import {formatBytes,type MediaItem} from "@/lib/contracts";
import {WorkspaceSelect} from "./workspace-select";
import {useActionConfirmation} from "./action-confirmation";

type Entry={id:string;title:string;senderName:string;accessScopeId:string|null;audienceName:string|null;fileCount:number;totalBytes:number;expiresAt:number;state:string;revision:number;canIssue:boolean};
type Detail={deliveries:Entry[];items:{id:string;name:string;size:number}[];recipients:{id:string;email:string;acceptedAt:number|null}[]};
type Draft={id:string;title:string;senderName:string;accessScopeId:string|null;files:{id:string;revision:number}[];recipients:{id:string;email:string;token:string}[];expiresAt:number;confirmed:true;confirmAudienceExpansion:true};

// Drafting captures an exact selection before a separate recipient/audience review. Stable secrets
// survive interrupted responses in this dialog; only deliberate issuance creates external access.
export default function DeliveryManager({spaceId,spaceName,personal,files,create,onClose}:{spaceId:string;spaceName:string;personal:boolean;files:MediaItem[];create:boolean;onClose:()=>void}){
  const api=useMemo(()=>createLibraryApi(spaceId),[spaceId]),dialog=useRef<HTMLDialogElement>(null),heading=useId(),generation=useRef(0);
  const clock=useRef<{time:number;readAt:number}|null>(null),{confirm,confirmation}=useActionConfirmation();
  const [captured]=useState(files),[mode,setMode]=useState(create?"compose":"list"),[entries,setEntries]=useState<Entry[]>([]),[selected,setSelected]=useState("");
  const [detail,setDetail]=useState<Detail|null>(null),[title,setTitle]=useState(""),[senderName,setSenderName]=useState(spaceName),[emails,setEmails]=useState(""),[days,setDays]=useState("7");
  const [intent,setIntent]=useState<Draft|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(""),[copied,setCopied]=useState("");
  const entry=detail?.deliveries[0]?.id===selected?detail.deliveries[0]:null;
  const currentSelection=captured.length>0&&captured.every(item=>files.some(current=>current.id===item.id&&current.sha256===item.sha256&&current.size===item.size&&(current.revision??0)===(item.revision??0)));
  const sameAudience=new Set(captured.map(item=>item.accessScopeId??null)).size===1;
  // Discard stale list/detail responses so changing selection cannot relabel an older request.
  const refresh=useCallback(async(target=selected)=>{
    const version=++generation.current;
    try{
      const result=await api.requestJson<{deliveries:Entry[];serverTime:number}>("deliveries");if(version!==generation.current)return;
      setEntries(result.deliveries);if(Number.isSafeInteger(result.serverTime))clock.current={time:result.serverTime,readAt:performance.now()};
      if(target){const next=await api.requestJson<Detail>(`deliveries/${target}`);if(version!==generation.current)return;setDetail(next);}
    }catch(failure){if(version!==generation.current)return;setEntries([]);setDetail(null);setError(failure instanceof Error?failure.message:"Deliveries could not be loaded.");}
  },[api,selected]);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- Synchronize awaited server state; cleanup advances the current generation counter.
  useEffect(()=>{void refresh();const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},10000);return()=>{clearInterval(timer);generation.current++;};},[refresh]);

  // Persist a private draft first. The next screen shows server-captured filenames, sender label,
  // audience and recipients before any grants are issued; errors keep one exact retry intent.
  async function reviewDraft(){
    if(!intent&&(!currentSelection||!sameAudience)){setError("Choose up to 100 current originals from one audience, then review again.");return;}
    const recipients=[...new Set(emails.split(/[,;\n]+/).map(email=>email.trim().toLowerCase()).filter(Boolean))];
    if(!intent&&(recipients.length<1||recipients.length>20)){setError("Choose between one and twenty recipient emails.");return;}
    const draft=intent??{id:crypto.randomUUID(),title:title.trim(),senderName:senderName.trim(),accessScopeId:captured[0].accessScopeId??null,
      files:captured.map(item=>({id:item.id,revision:item.revision??0})),recipients:recipients.map(email=>({id:crypto.randomUUID(),email,token:Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,"0")).join("")})),
      expiresAt:Math.floor((clock.current?clock.current.time+performance.now()-clock.current.readAt:Date.now()-60000)+Number(days)*86400000),confirmed:true as const,confirmAudienceExpansion:true as const};
    setIntent(draft);setBusy(true);setError("");
    try{await api.requestJson("deliveries",{method:"POST",body:JSON.stringify(draft)});setSelected(draft.id);setMode("review");await refresh(draft.id);}
    catch(failure){setError(failure instanceof Error?failure.message:"The draft could not be prepared. Retry this exact selection.");}
    finally{setBusy(false);}
  }
  // Issuance is the audience-expanding step. Re-review suspended deliveries; do not treat restoring
  // their sources as authority to silently renew access for earlier external recipients.
  async function publish(){
    if(!entry||!detail)return;
    const audience=entry.audienceName||(personal?"your personal space":"the general library");
    if(!await confirm({title:entry.state==="suspended"?"Reactivate this delivery?":"Share this delivery?",description:`${entry.fileCount} originals from ${audience} will be available to ${detail.recipients.map(recipient=>recipient.email).join(", ")} until ${new Date(entry.expiresAt).toLocaleString()}. Recipients see the captured filenames and sender label, not your working library. Copies they save cannot be recalled.`,action:entry.state==="suspended"?"Reactivate delivery":"Publish delivery"}))return;
    setBusy(true);setError("");
    try{await api.requestJson(`deliveries/${entry.id}/issue`,{method:"POST",body:JSON.stringify({expectedRevision:entry.revision,confirmed:true,confirmAudienceExpansion:true})});await refresh(entry.id);}
    catch(failure){setError(failure instanceof Error?failure.message:"This delivery changed. Refresh and review it again.");}
    finally{setBusy(false);}
  }
  async function revoke(){
    if(!entry||!await confirm({title:"Revoke this delivery?",description:"Stop new access for every recipient. Previously saved copies remain on their devices, and a download already admitted may finish.",action:"Revoke delivery"}))return;
    setBusy(true);setError("");
    try{await api.requestJson(`deliveries/${entry.id}`,{method:"DELETE",body:JSON.stringify({expectedRevision:entry.revision,confirmed:true})});await refresh(entry.id);}
    catch(failure){setError(failure instanceof Error?failure.message:"This delivery could not be revoked.");}
    finally{setBusy(false);}
  }
  const locked=busy||Boolean(intent);
  return <><dialog ref={dialog} className="modal intake-manager delivery-manager" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClose={()=>{if(!busy)onClose();}}>
    <div className="modal-heading"><h2 id={heading}>{mode==="compose"?"Create a delivery":"Deliveries"}</h2><button className="icon-button" aria-label="Close deliveries" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <p className="modal-intro">A reviewed selection for named recipients. Your working library stays separate.</p>
    {error&&<p className="error-banner" role="alert">{error}</p>}
    {mode==="compose"?<form className="intake-form" onSubmit={event=>{event.preventDefault();void reviewDraft();}}>
      {!currentSelection&&<p className="error-banner">The selection changed. Close this window and select the current originals again.</p>}
      {!sameAudience&&<p className="error-banner">Choose files from one audience. Create separate deliveries for different audiences.</p>}
      {currentSelection&&<div className="delivery-selection"><strong>{captured.length} originals &middot; {formatBytes(captured.reduce((sum,item)=>sum+item.size,0))}</strong><ul>{captured.map(item=><li key={item.id}>{item.name}</li>)}</ul></div>}
      <label>Delivery title<input required maxLength={120} value={title} disabled={locked} onChange={event=>setTitle(event.target.value)} placeholder="Your event originals"/></label>
      <label>From, shown to recipients<input required maxLength={120} value={senderName} disabled={locked} onChange={event=>setSenderName(event.target.value)}/></label>
      <label>Recipient emails<input required type="email" aria-label="Recipient emails" aria-describedby={`${heading}-emails`} multiple maxLength={7000} value={emails} disabled={locked} onChange={event=>setEmails(event.target.value)} placeholder="name@example.com, another@example.com"/><span id={`${heading}-emails`} className="small-muted">Up to 20 verified accounts, separated by commas. Each gets its own link.</span></label>
      <label>Available for<WorkspaceSelect label="Delivery duration" value={days} disabled={locked} onChange={setDays} options={[{value:"1",label:"1 day"},{value:"7",label:"7 days"},{value:"14",label:"14 days"},{value:"30",label:"30 days"}]}/></label>
      <p className="small-muted">You will review the captured names, source audience and recipients before publishing. Originals include their embedded metadata.</p>
      <button className="button primary" type="submit" disabled={busy||(!intent&&(!currentSelection||!sameAudience))}>{busy?"Preparing review...":intent?"Retry draft":"Review delivery"}</button>
    </form>:<>
      <div className="intake-toolbar"><WorkspaceSelect label="Delivery" value={selected} disabled={busy} onChange={value=>{setSelected(value);setDetail(null);setError("");}} options={[{value:"",label:entries.length?"Choose a delivery":"No deliveries yet"},...entries.map(item=>({value:item.id,label:`${item.title} (${item.state})`}))]}/><button className="icon-button" aria-label="Refresh deliveries" disabled={busy} onClick={()=>void refresh()}><RefreshCw size={17}/></button></div>
      {!selected&&<div className="intake-empty"><PackageCheck size={28}/><p>Select originals in your library, then choose Create delivery.</p></div>}
      {selected&&!entry&&!error&&<p role="status">Loading delivery review...</p>}
      {entry&&detail&&<section className="delivery-review"><div className="delivery-review-heading"><h3>{entry.title}</h3><span className="pill">{entry.state}</span></div><p>From {entry.senderName}</p><p className="small-muted">Source: {entry.audienceName||(personal?"Personal space":"General library")} &middot; {entry.fileCount} originals &middot; {formatBytes(entry.totalBytes)}</p><p className="small-muted">Ends {new Date(entry.expiresAt).toLocaleString()}</p>
        <h4>Captured originals</h4><ul className="delivery-review-files">{detail.items.map(item=><li key={item.id}><span>{item.name}</span><small>{formatBytes(item.size)}</small></li>)}</ul>
        <h4>Recipient access</h4><ul className="delivery-review-recipients">{detail.recipients.map(recipient=><li key={recipient.id}><span>{recipient.email}</span>{recipient.acceptedAt&&<small>Invitation accepted</small>}</li>)}</ul>
        {entry.state==="issued"&&intent?.id===entry.id&&<div className="delivery-links"><p className="small-muted">Copy these links before leaving. Relay does not send invitations automatically.</p>{intent.recipients.map(recipient=>{const url=`${window.location.origin}/delivery#delivery=${recipient.token}`;return <label key={recipient.id}>{recipient.email}<div><input aria-label={`Link for ${recipient.email}`} readOnly value={url}/><button className="icon-button" aria-label={`Copy link for ${recipient.email}`} onClick={()=>{void navigator.clipboard.writeText(url).then(()=>setCopied(recipient.id)).catch(()=>setError("Copy the link from its field."));}}><Copy size={17}/></button></div>{copied===recipient.id&&<small role="status">Copied</small>}</label>;})}</div>}
        {entry.state==="issued"&&intent?.id!==entry.id&&<p className="small-muted">Links were shown when this delivery was created. To replace a lost link, revoke this delivery and create a new reviewed selection.</p>}
        <div className="confirmation-actions">{entry.state!=="revoked"&&<button className="button secondary" disabled={busy} onClick={()=>void revoke()}>{entry.state==="draft"?"Discard draft":"Revoke delivery"}</button>}{["draft","suspended"].includes(entry.state)&&Boolean(entry.canIssue)&&<button className="button primary" disabled={busy} onClick={()=>void publish()}><ShieldCheck size={16}/>{entry.state==="suspended"?"Review reactivation":"Publish delivery"}</button>}</div>
      </section>}
    </>}
  </dialog>{confirmation}</>;
}
