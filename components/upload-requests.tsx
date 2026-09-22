"use client";

import {useCallback,useEffect,useId,useMemo,useRef,useState} from "react";
import {Check,Copy,Inbox,LoaderCircle,Plus,RefreshCw,ShieldCheck,X} from "lucide-react";
import {createLibraryApi} from "@/lib/api-client";
import {formatBytes,type Album,type AlbumSection} from "@/lib/contracts";
import {WorkspaceSelect} from "./workspace-select";
import {useActionConfirmation} from "./action-confirmation";

type RequestEntry={id:string;title:string;recipientEmail:string;albumId:string;sectionId:string|null;accessScopeId:string|null;expiresAt:number;revokedAt:number|null;state:string;revision:number;maxFiles:number;maxFileBytes:number;maxBytes:number};
type Submission={id:string;name:string;size:number;phase:string;verifiedAt:number|null};
type Draft={id:string;token:string;title:string;recipientEmail:string;albumId:string;sectionId:string|null;accessScopeId:string|null;expiresAt:number;maxFiles:number;maxFileBytes:number;maxBytes:number;confirmed:true};
const MiB=1024*1024;

// Keep recipient intake separate from membership. The owner reviews a captured destination/allowance,
// sees a copyable link only after activation, and independently accepts each received original.
export default function UploadRequests({spaceId,spaceName,restricted,onClose}:{spaceId:string;spaceName:string;restricted:boolean;onClose:()=>void}) {
  const api=useMemo(()=>createLibraryApi(spaceId),[spaceId]),dialog=useRef<HTMLDialogElement>(null),heading=useId();
  const {confirm,confirmation}=useActionConfirmation();
  const loadVersion=useRef(0),serverClock=useRef<{time:number;readAt:number}|null>(null);
  const [requests,setRequests]=useState<RequestEntry[]>([]),[selected,setSelected]=useState(""),[submissions,setSubmissions]=useState<Submission[]>([]);
  const [paused,setPaused]=useState(false),[creating,setCreating]=useState(false),[scopes,setScopes]=useState<{id:string;name:string}[]>([]),[audience,setAudience]=useState("general");
  const [albums,setAlbums]=useState<Album[]>([]),[sections,setSections]=useState<AlbumSection[]>([]),[albumId,setAlbumId]=useState(""),[sectionId,setSectionId]=useState("");
  const [title,setTitle]=useState(""),[email,setEmail]=useState(""),[hours,setHours]=useState("24"),[maxFiles,setMaxFiles]=useState(20),[totalBytes,setTotalBytes]=useState(1024*MiB),[fileBytes,setFileBytes]=useState(250*MiB);
  const [intent,setIntent]=useState<Draft|null>(null),[createdLink,setCreatedLink]=useState(""),[copied,setCopied]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[loaded,setLoaded]=useState(false);
  const current=requests.find(request=>request.id===selected),audienceName=audience==="general"?"General library":scopes.find(scope=>scope.id===audience)?.name??"Unavailable audience";
  const load=useCallback(async()=>{
    const version=++loadVersion.current;
    try{
      const list=await api.requestJson<{requests:RequestEntry[];serverTime:number;paused?:boolean}>("upload-requests");
      if(version!==loadVersion.current)return;
      if(Number.isSafeInteger(list.serverTime))serverClock.current={time:list.serverTime,readAt:performance.now()};
      setRequests(list.requests);setPaused(Boolean(list.paused));
      if(selected){const detail=await api.requestJson<{submissions:Submission[]}>(`upload-requests/${selected}`);if(version!==loadVersion.current)return;setSubmissions(detail.submissions);}
      setLoaded(true);
    }catch(failure){if(version!==loadVersion.current)return;setRequests([]);setSubmissions([]);setError(failure instanceof Error?failure.message:"Requests could not be loaded.");}
  },[api,selected]);
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- Await server reads; cleanup intentionally advances the current request generation, not a DOM ref.
  useEffect(()=>{void load();const timer=setInterval(()=>{if(document.visibilityState==="visible")void load();},10000);return()=>{clearInterval(timer);loadVersion.current++;};},[load]);
  useEffect(()=>{
    if(!restricted)return;
    const controller=new AbortController();void api.requestJson<{scopes:{id:string;name:string}[]}>("access-scopes",{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setScopes(result.scopes);}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[api,restricted]);
  useEffect(()=>{
    const controller=new AbortController();void api.requestJson<{albums:Album[]}>(`albums${audience==="general"?"" :"?scope="+audience}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setAlbums(result.albums.filter(album=>!album.deletedAt&&!album.archivedAt));}).catch(failure=>{if(!controller.signal.aborted){setAlbums([]);setError(failure.message);}});
    return()=>controller.abort();
  },[api,audience]);
  useEffect(()=>{
    if(!albumId)return;
    const controller=new AbortController();void api.requestJson<{sections:AlbumSection[]}>(`sections?album=${albumId}`,{signal:controller.signal}).then(result=>{if(!controller.signal.aborted)setSections(result.sections);}).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[api,albumId]);

  // Capture exact reviewed limits and a stable cryptographic invitation before the first network call.
  // A failed response keeps the same intent; retry cannot reserve another allowance or redirect it.
  async function createRequest(){
    const draft=intent??{id:crypto.randomUUID(),token:Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,"0")).join(""),title:title.trim(),recipientEmail:email.trim(),albumId,sectionId:sectionId||null,accessScopeId:audience==="general"?null:audience,expiresAt:Math.floor((serverClock.current?serverClock.current.time+performance.now()-serverClock.current.readAt:Date.now()-60000)+Number(hours)*3600000),maxFiles,maxFileBytes:fileBytes,maxBytes:totalBytes,confirmed:true as const};
    if(!intent&&!await confirm({title:"Create upload request?",description:`${draft.recipientEmail} can send up to ${draft.maxFiles} files (${formatBytes(draft.maxFileBytes)} each, ${formatBytes(draft.maxBytes)} total) before ${new Date(draft.expiresAt).toLocaleString()}. You will review originals before they enter ${audienceName} / ${albums.find(album=>album.id===albumId)?.name}. The recipient sees "${draft.title}" and ${spaceName}, with no library access.`,action:"Create request"}))return;
    setIntent(draft);setBusy(true);setError("");
    try{await api.requestJson("upload-requests",{method:"POST",body:JSON.stringify(draft)});setCreatedLink(`${window.location.origin}/collect#request=${draft.token}`);setSelected(draft.id);await load();}
    catch(failure){setError(failure instanceof Error?failure.message:"Request creation failed. Retry the same request.");}
    finally{setBusy(false);}
  }
  async function closeRequest(request:RequestEntry){
    if(!await confirm({title:"Close upload request?",description:`${request.recipientEmail} will no longer be able to start or finish uploads to ${request.title}. Received files stay available for your review; only unused allowance is released.`,action:"Close request"}))return;
    setBusy(true);setError("");
    try{await api.requestJson(`upload-requests/${request.id}`,{method:"DELETE",body:JSON.stringify({expectedRevision:request.revision})});await load();}
    catch(failure){setError(failure instanceof Error?failure.message:"The request changed. Refresh and try again.");}
    finally{setBusy(false);}
  }
  async function acceptOriginal(file:Submission){
    if(!await confirm({title:"Accept this original?",description:`Verify ${file.name} (${formatBytes(file.size)}) and add it to this request's reviewed album audience. Original files may include embedded location or other metadata.`,action:"Verify and accept"}))return;
    setBusy(true);setError("");
    try{await api.requestJson(`upload-requests/${selected}/accept`,{method:"POST",body:JSON.stringify({fileId:file.id,confirmed:true})});await load();}
    catch(failure){setError(failure instanceof Error?failure.message:"This original could not be verified. It remains outside the library.");}
    finally{setBusy(false);}
  }
  // Decline retains originals and capacity; restore returns to review without publishing anything.
  async function changeReview(file:Submission,restore:boolean){
    if(!restore&&!await confirm({title:"Decline this original?",description:`${file.name} will stay outside the library. Its bytes and storage reservation are retained; you can restore it to review. The recipient will see that it was declined.`,action:"Decline original"}))return;
    setBusy(true);setError("");
    try{await api.requestJson(`upload-requests/${selected}/${restore?"restore":"decline"}`,{method:"POST",body:JSON.stringify({fileId:file.id,confirmed:true})});await load();}
    catch(failure){setError(failure instanceof Error?failure.message:"The review could not be updated.");}
    finally{setBusy(false);}
  }
  const locked=busy||Boolean(intent);
  return <><dialog ref={dialog} className="modal intake-manager" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClose={()=>{if(!busy)onClose();}}>
    <div className="modal-heading"><h2 id={heading}>Upload requests</h2><button className="icon-button" aria-label="Close upload requests" disabled={busy} onClick={onClose}><X size={20}/></button></div>
    <p className="modal-intro">Collect originals without opening your library. You choose the audience and review what arrives.</p>
    {paused&&<p role="status" className="small-muted">New requests and uploads are temporarily paused. You can still review received files or close requests.</p>}
    {error&&<p className="error-banner" role="alert">{error}</p>}
    {!creating?<><div className="intake-toolbar"><button className="button primary" disabled={busy||paused} onClick={()=>{setCreating(true);setIntent(null);setCreatedLink("");setCopied(false);setError("");}}><Plus size={16}/>New request</button><button className="icon-button" aria-label="Refresh upload requests" disabled={busy} onClick={()=>void load()}><RefreshCw size={17}/></button></div>
      {!loaded?<p role="status">Loading requests...</p>:!requests.length?<div className="intake-empty"><Inbox size={28}/><p>No requests yet.</p><span>A focused place for clients or friends to send their originals.</span></div>:<WorkspaceSelect label="Upload request" value={selected} options={[{value:"",label:"Choose a request"},...requests.map(request=>({value:request.id,label:`${request.title}${request.revokedAt||request.state==="closed"?" (closed)":""}`}))]} onChange={id=>{setSelected(id);setSubmissions([]);setError("");}}/>}
      {current&&<section className="intake-review"><div className="intake-summary"><div><strong>{current.title}</strong><p>{current.recipientEmail}</p><p>{current.maxFiles} files &middot; {formatBytes(current.maxBytes)} total &middot; Ends {new Date(current.expiresAt).toLocaleString()}</p></div>{current.state!=="closed"&&<button className="text-button" disabled={busy} onClick={()=>void closeRequest(current)}>Close request</button>}</div>
        <h3>Received originals</h3>{!submissions.length?<p className="small-muted">No files received yet.</p>:submissions.map(file=><div className="intake-file" key={file.id}><div><strong>{file.name||"Unavailable submission"}</strong><p>{formatBytes(file.size)} &middot; {file.phase==="accepted"?"Verified and accepted":file.phase==="received"?"Received for review":file.phase==="rejected"?"Declined: bytes retained":"Upload unfinished"}</p></div>{["received","rejected"].includes(file.phase)&&<a className="text-button" href={api.apiUrl(`upload-requests/${selected}/original?file=${file.id}`)} target="_blank" rel="noopener noreferrer">Verify and download</a>}{file.phase==="received"?<><button className="button secondary compact" disabled={busy} onClick={()=>void acceptOriginal(file)}><ShieldCheck size={16}/>Verify and accept</button><button className="text-button" disabled={busy} onClick={()=>void changeReview(file,false)}>Decline</button></>:file.phase==="rejected"?<button className="text-button" disabled={busy} onClick={()=>void changeReview(file,true)}>Restore to review</button>:file.phase==="accepted"?<Check size={18} aria-label="Accepted"/>:null}</div>)}</section>}
    </>:createdLink?<section className="intake-link"><ShieldCheck size={28}/><h3>Ready to collect.</h3><p>Only {intent?.recipientEmail} can accept this request. Copy the link before leaving this screen.</p><label>Request link<input readOnly value={createdLink}/></label><button className="button primary" onClick={()=>{void navigator.clipboard.writeText(createdLink).then(()=>setCopied(true)).catch(()=>setError("Copy the link from the field above."));}}><Copy size={16}/>{copied?"Copied":"Copy request link"}</button><button className="text-button" onClick={()=>{setCreating(false);void load();}}>Review submissions</button></section>:<form className="intake-form" onSubmit={event=>{event.preventDefault();void createRequest();}}>
      <label>Title the recipient sees<input required maxLength={120} value={title} disabled={locked} onChange={event=>setTitle(event.target.value)} placeholder="Send your event photos"/></label>
      <label>Recipient email<input required type="email" maxLength={320} value={email} disabled={locked} onChange={event=>setEmail(event.target.value)} autoComplete="off" placeholder="name@example.com"/></label>
      <label>Library audience<WorkspaceSelect label="Collection audience" value={audience} disabled={locked} options={[{value:"general",label:"General library"},...scopes.map(scope=>({value:scope.id,label:scope.name}))]} onChange={value=>{setAudience(value);setAlbumId("");setSectionId("");setAlbums([]);setSections([]);}}/></label>
      <label>Destination album<WorkspaceSelect label="Collection album" value={albumId} disabled={locked} options={[{value:"",label:albums.length?"Choose an album":"Create an album in this audience first"},...albums.map(album=>({value:album.id,label:album.name}))]} onChange={value=>{setAlbumId(value);setSectionId("");setSections([]);}}/></label>
      {albumId&&<label>Section<WorkspaceSelect label="Collection section" value={sectionId} disabled={locked} options={[{value:"",label:"Unsectioned"},...sections.map(section=>({value:section.id,label:section.name}))]} onChange={setSectionId}/></label>}
      <div className="intake-limits"><label>Request duration<WorkspaceSelect label="Request duration" value={hours} disabled={locked} options={[{value:"1",label:"1 hour"},{value:"24",label:"24 hours"},{value:"72",label:"3 days"},{value:"168",label:"7 days"}]} onChange={setHours}/></label><label>Maximum files<input type="number" min={1} max={100} required disabled={locked} value={maxFiles} onChange={event=>setMaxFiles(Number(event.target.value))}/></label>
      <label>Total allowance<WorkspaceSelect label="Total allowance" value={String(totalBytes)} disabled={locked} options={[64,256,1024].map(size=>({value:String(size*MiB),label:formatBytes(size*MiB)}))} onChange={value=>{setTotalBytes(Number(value));setFileBytes(current=>Math.min(current,Number(value)));}}/></label><label>Per file<WorkspaceSelect label="Per-file limit" value={String(fileBytes)} disabled={locked} options={[32,64,250].filter(size=>size*MiB<=totalBytes).map(size=>({value:String(size*MiB),label:formatBytes(size*MiB)}))} onChange={value=>setFileBytes(Number(value))}/></label></div>
      <p className="small-muted">This allowance is reserved from your library storage. The recipient sees the title and receiving library, but no private album names or existing files.</p>
      {intent&&<p className="small-muted">Retry keeps this exact request and allowance. Close a saved draft in the request list before replacing it.</p>}
      <div className="confirmation-actions"><button type="button" className="button secondary" disabled={busy} onClick={()=>{setCreating(false);setIntent(null);void load();}}>Back</button><button className="button primary" disabled={busy||paused||!albumId||!title.trim()||!email.trim()} type="submit">{busy?<><LoaderCircle size={16} className="spin"/>Creating...</>:intent?"Retry request":"Review request"}</button></div>
    </form>}
    {busy&&!creating&&<p className="publication-progress" role="status"><LoaderCircle size={17} className="spin"/>Checking the original and current access. Keep this tab open.</p>}
  </dialog>{confirmation}</>;
}
