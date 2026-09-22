"use client";

import {useEffect,useId,useMemo,useRef,useState} from "react";
import {ArrowRight,Copy,LoaderCircle,X} from "lucide-react";
import {createLibraryApi} from "@/lib/api-client";
import {formatBytes,type Album,type AlbumSection,type MediaItem} from "@/lib/contracts";
import {WorkspaceSelect} from "./workspace-select";

type Scope={id:string;name:string};
type Roster={members:{id:string;name:string;role:string}[]};
type Catalog={grants:{scopeId:string;membershipId:string}[]};
type CopyIntent={id:string;sourceId:string;sourceRevision:number;sourceScopeId:string|null;destinationScopeId:string|null;albumId?:string|null;sectionId?:string|null;phase?:string};

// Review a named audience before making an independent original. Recover exact server intent after
// a lost response and lock that destination until cancellation; navigation never silently redirects it.
export default function ScopeCopyDialog({item,spaceId,onClose}:{item:MediaItem;spaceId:string;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null),heading=useId(),api=useMemo(()=>createLibraryApi(spaceId),[spaceId]);
  const [scopes,setScopes]=useState<Scope[]>([]),[roster,setRoster]=useState<Roster>({members:[]}),[catalog,setCatalog]=useState<Catalog>({grants:[]});
  const [loaded,setLoaded]=useState(false),[destination,setDestination]=useState(""),[albumId,setAlbumId]=useState(""),[sectionId,setSectionId]=useState("");
  const [albums,setAlbums]=useState<Album[]>([]),[sections,setSections]=useState<AlbumSection[]>([]),[destinationLoaded,setDestinationLoaded]=useState(false);
  const [intent,setIntent]=useState<CopyIntent|null>(null),[completed,setCompleted]=useState(false),[busy,setBusy]=useState<"copy"|"cancel"|null>(null),[error,setError]=useState("");
  const sourceScope=item.accessScopeId??null;
  const destinations=[{id:"general",name:"General library"},...scopes].filter(scope=>scope.id!==(sourceScope??"general"));
  const destinationName=destinations.find(scope=>scope.id===destination)?.name??"Unavailable audience";
  const sourceName=sourceScope===null?"General library":scopes.find(scope=>scope.id===sourceScope)?.name??"Restricted audience";
  const people=destination==="general"?roster.members:roster.members.filter(member=>catalog.grants.some(grant=>grant.scopeId===destination&&grant.membershipId===member.id));
  useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
  // Loading all review inputs together prevents a stale audience preview from enabling a new copy.
  useEffect(()=>{
    const controller=new AbortController(),options={signal:controller.signal};
    void Promise.all([api.requestJson<{scopes:Scope[]}>("access-scopes",options),api.requestJson<Roster>("people",options),
      api.requestJson<Catalog>("access-scopes?administration=1",options),api.requestJson<{publication:CopyIntent|null}>(`scope-copies?sourceId=${item.id}`,options)])
      .then(([available,members,administration,recovery])=>{
        if(controller.signal.aborted)return;
        setScopes(available.scopes);setRoster(members);setCatalog(administration);
        if(recovery.publication){const previous=recovery.publication;setIntent(previous);setDestination(previous.destinationScopeId??"general");setAlbumId(previous.albumId??"");setSectionId(previous.sectionId??"");setCompleted(previous.phase==="ready");}
        setLoaded(true);
      }).catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[api,item.id]);
  useEffect(()=>{
    if(!destination)return;
    const controller=new AbortController();
    void api.requestJson<{albums:Album[]}>(`albums${destination==="general"?"":"?scope="+destination}`,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted){setAlbums(result.albums.filter(album=>!album.archivedAt&&!album.deletedAt));setDestinationLoaded(true);}})
      .catch(failure=>{if(!controller.signal.aborted){setDestinationLoaded(false);setError(failure.message);}});
    return()=>controller.abort();
  },[api,destination]);
  useEffect(()=>{
    if(!albumId)return;
    const controller=new AbortController();
    void api.requestJson<{sections:AlbumSection[]}>(`sections?album=${albumId}`,{signal:controller.signal})
      .then(result=>{if(!controller.signal.aborted)setSections(result.sections);})
      .catch(failure=>{if(!controller.signal.aborted)setError(failure.message);});
    return()=>controller.abort();
  },[api,albumId]);
  useEffect(()=>{
    if(!busy)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue="";};
    window.addEventListener("beforeunload",warn);return()=>window.removeEventListener("beforeunload",warn);
  },[busy]);
  // Stable operation IDs make a network retry recover the original result, never create a second copy.
  async function copyOriginal(){
    const captured=intent??{id:crypto.randomUUID(),sourceId:item.id,sourceRevision:item.revision??0,sourceScopeId:sourceScope,
      destinationScopeId:destination==="general"?null:destination,albumId:albumId||null,sectionId:sectionId||null};
    setIntent(captured);setBusy("copy");setError("");
    try{await api.requestJson("scope-copies",{method:"POST",body:JSON.stringify({...captured,albumId:captured.albumId||undefined,sectionId:captured.sectionId||undefined,confirmed:true})});setCompleted(true);}
    catch(failure){setError(failure instanceof Error?failure.message:"Copy could not be verified. Retry or cancel it.");}
    finally{setBusy(null);}
  }
  async function cancelCopy(){
    if(!intent){onClose();return;}
    setBusy("cancel");setError("");
    try{await api.requestJson(`uploads/${intent.id}`,{method:"DELETE"});onClose();}
    catch(failure){setError(failure instanceof Error?failure.message:"Cancellation failed. Refresh Storage to review the unfinished copy.");}
    finally{setBusy(null);}
  }
  const allowed=loaded&&destinationLoaded&&destinations.some(scope=>scope.id===destination)&&!busy&&intent?.phase!=="cancelling";
  return <dialog ref={dialog} className="modal publication-dialog" aria-labelledby={heading} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClose={()=>{if(!busy)onClose();}}>
    <div className="modal-heading"><h2 id={heading}>{completed?"Copy verified":"Copy to another audience"}</h2><button className="icon-button" aria-label="Close audience copy" disabled={Boolean(busy)} onClick={onClose}><X size={20}/></button></div>
    <p className="publication-filename">{item.name}</p><p className="small-muted">{formatBytes(item.size)} &middot; {sourceName} &middot; Original quality</p>
    {error&&<p className="error-banner" role="alert">{error}</p>}
    {!loaded?<p role="status">{error?"Close and reopen to review current access.":"Checking audiences and previous copies."}</p>:completed?<>
      <p className="modal-intro">This original has a verified, independent copy in {destinationName}. The source remains in {sourceName}.</p>
      <div className="publication-success-actions"><a className="button primary" href={`/?space=${spaceId}${destination!=="general"?"&scope="+destination:""}${albumId?"&album="+albumId:""}${sectionId?"&section="+sectionId:""}`}>Open destination <ArrowRight size={16}/></a>
        <button className="text-button" onClick={()=>{setIntent(null);setCompleted(false);setError("");}}>Create another copy</button></div>
    </>:<>
      <div className="publication-destinations"><WorkspaceSelect label="Destination audience" value={destination} disabled={Boolean(busy||intent)} options={[{value:"",label:"Choose an audience"},...destinations.map(scope=>({value:scope.id,label:scope.name}))]}
        onChange={value=>{setDestination(value);setDestinationLoaded(false);setAlbumId("");setSectionId("");setAlbums([]);setSections([]);setError("");}}/>
        {destination&&<WorkspaceSelect label="Destination album" value={albumId} disabled={Boolean(busy||intent)||!destinationLoaded} options={[{value:"",label:"Unorganised"},...albums.map(album=>({value:album.id,label:album.name}))]} onChange={value=>{setAlbumId(value);setSectionId("");setSections([]);}}/>}
        {albumId&&<WorkspaceSelect label="Destination section" value={sectionId} disabled={Boolean(busy||intent)} options={[{value:"",label:"Unsectioned"},...sections.map(section=>({value:section.id,label:section.name}))]} onChange={setSectionId}/>}</div>
      {destination&&<div className="publication-audience"><strong>Who can see this copy</strong><p>{people.map(person=>person.name).join(", ")||"No current named members"}{destination==="general"?", plus paired devices and future library members.":". Owners can change this audience later."}</p>
        <p>{sourceScope===null?"The general original remains shared. A restricted copy cannot recall existing access or downloads.":"The restricted original stays in its current audience. This copy has its own access and storage."}</p>
        <p>Original bytes include any embedded location or other metadata. Changes or deletion of either copy do not change the other.</p></div>}
      {intent&&!busy&&<p className="small-muted">This copy keeps its reviewed destination. Retry, or cancel it before choosing another.</p>}
      {busy&&<p role="status" className="publication-progress"><LoaderCircle size={18} className="spin"/>{busy==="copy"?"Copying and verifying the original. Keep this tab open.":"Cancelling the unfinished copy."}</p>}
      <div className="confirmation-actions"><button className="button secondary" disabled={Boolean(busy)} onClick={()=>void cancelCopy()}>{intent?"Cancel copy":"Cancel"}</button><button className="button primary" disabled={!allowed} onClick={()=>void copyOriginal()}><Copy size={16}/>{busy?"Working...":intent?"Retry copy":"Create copy"}</button></div>
    </>}
  </dialog>;
}
