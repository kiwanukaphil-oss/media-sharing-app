"use client";
import {useEffect,useId,useRef,useState} from "react";
import {CopyCheck,X} from "lucide-react";
import {useLibraryApi} from "./library-scope";
import {WorkspaceSelect} from "./workspace-select";
import {formatBytes,type Album,type MediaItem} from "@/lib/contracts";
import {verifyDuplicatePair,duplicateVerificationLimit,type DuplicateFile} from "@/lib/verify-duplicate";
type Matches={source:DuplicateFile;candidates:DuplicateFile[];hasMore:boolean};

// Duplicate assistance never deletes or merges originals. It offers an explicit, independently
// verified existing original for a same-audience album reference, retaining all prior relationships.
export function DuplicateReview({source,albums,canOrganise,refresh}:{source:MediaItem;albums:Album[];canOrganise:boolean;refresh:()=>Promise<void>}){
  const {requestJson}=useLibraryApi(),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null),title=useId(),controller=useRef<AbortController|null>(null);
  const [open,setOpen]=useState(false),[matches,setMatches]=useState<Matches|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [verified,setVerified]=useState<string[]>([]),[verifying,setVerifying]=useState(false),[progress,setProgress]=useState(0),[albumId,setAlbumId]=useState('');
  const [undo,setUndo]=useState<{id:string;expectedRevision:number;albumId:string}|null>(null);
  const readMatches=(signal?:AbortSignal)=>requestJson<Matches>('duplicate-candidates',{method:'POST',signal,body:JSON.stringify({id:source.id,expectedRevision:source.revision??0})});
  useEffect(()=>()=>controller.current?.abort(),[]);
  // Opening or changing the selected source starts a new private review. Polling clears stale
  // names after revoked access; any change invalidates the previous byte-verification indication.
  useEffect(()=>{
    if(!open)return;dialog.current?.showModal();const abort=new AbortController();let generation=0;
    const update=async()=>{const current=++generation;try{const result=await requestJson<Matches>('duplicate-candidates',{method:'POST',signal:abort.signal,body:JSON.stringify({id:source.id,expectedRevision:source.revision??0})});if(current===generation&&!abort.signal.aborted){setMatches(previous=>{if(JSON.stringify(previous)!==JSON.stringify(result))setVerified([]);return result;});setError('');}}
      catch(failure){if(current===generation&&!abort.signal.aborted){setMatches(null);setVerified([]);controller.current?.abort();setError(failure instanceof Error?failure.message:'This comparison is unavailable.');}}};
    void update();const timer=setInterval(()=>{if(document.visibilityState==='visible')void update();},15000);
    return()=>{abort.abort();clearInterval(timer);};
  },[open,requestJson,source.id,source.revision]);
  // Verification reads both complete originals and repeats the scoped lookup before displaying
  // an exact match. A cancelled read cannot leave a reusable verification indication behind.
  async function verify(candidate:DuplicateFile){
    if(!matches)return;const abort=new AbortController();controller.current=abort;setVerifying(true);setBusy(true);setError('');setNotice('');setProgress(0);
    try{await verifyDuplicatePair(matches.source,candidate,{signal:abort.signal,
      read:async file=>{const {url}=await requestJson<{url:string}>(`media/${file.id}/link`,{signal:abort.signal});return fetch(url,{signal:abort.signal});},
      revalidate:async()=>{const current=await readMatches(abort.signal);if(JSON.stringify(current.source)!==JSON.stringify(matches.source)||!current.candidates.some(file=>JSON.stringify(file)===JSON.stringify(candidate)))throw new Error('The comparison changed. Refresh and verify again.');},onProgress:setProgress});
      setVerified(previous=>[...new Set([...previous,candidate.id])]);setNotice('Both originals verified: identical bytes. Neither file was changed.');
    }catch(failure){setVerified(previous=>previous.filter(id=>id!==candidate.id));setError(abort.signal.aborted?'Verification cancelled.':failure instanceof Error?failure.message:'Verification failed.');}
    finally{controller.current=null;setVerifying(false);setBusy(false);}
  }
  // Reuse adds only a normal same-scope album reference. Existing server revision/role checks and
  // no-op detection remain authoritative; Undo removes only the reference created by this action.
  async function reuse(candidate:DuplicateFile){
    setBusy(true);setProgress(0);setError('');setNotice('');setUndo(null);
    try{const current=await readMatches();if(!current.candidates.some(file=>JSON.stringify(file)===JSON.stringify(candidate)))throw new Error('The file changed. Refresh and verify again.');
      const result=await requestJson<{changed:{id:string}[];files:{id:string;revision:number}[]}>('library/organise',{method:'POST',body:JSON.stringify({action:'add',albumId,files:[{id:candidate.id,expectedRevision:candidate.revision}]})});
      const changed=result.changed.some(file=>file.id===candidate.id),updated=result.files.find(file=>file.id===candidate.id);
      if(changed&&updated)setUndo({id:candidate.id,expectedRevision:updated.revision,albumId});setNotice(changed?'Existing original added to the album. Both files remain intact.':'This original is already in the album.');await refresh();
    }catch(failure){setError(failure instanceof Error?failure.message:'The original could not be added.');}finally{setBusy(false);}
  }
  async function undoReference(){
    if(!undo)return;setBusy(true);setProgress(0);setNotice('');setError('');
    try{await requestJson('library/organise',{method:'POST',body:JSON.stringify({action:'remove',albumId:undo.albumId,files:[{id:undo.id,expectedRevision:undo.expectedRevision}]})});setUndo(null);setNotice('Album reference removed. Original files are unchanged.');await refresh();}
    catch(failure){setError(failure instanceof Error?failure.message:'This reference changed and could not be undone.');}finally{setBusy(false);}
  }
  return <><button ref={opener} className="icon-button" aria-label="Find duplicate originals" title="Find duplicate originals" onClick={()=>{setMatches(null);setVerified([]);setNotice('');setError('');setOpen(true);}}><CopyCheck size={18}/></button>
    {open&&<dialog ref={dialog} className="modal library-dialog" aria-labelledby={title} onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>{setOpen(false);opener.current?.focus({preventScroll:true});}}>
      <div className="modal-heading"><h2 id={title}>Duplicate originals</h2><button className="icon-button" aria-label="Close duplicate review" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      <p className="small-muted">Matches stay within this file&apos;s library and audience. Recorded fingerprints suggest candidates; Verify checks both original files. Nothing is deleted or merged.</p>
      {!matches&&!error&&<p role="status">Finding matching originals...</p>}
      {matches&&<><p><strong>{matches.source.name}</strong> &middot; {formatBytes(matches.source.size)}</p>{!matches.candidates.length&&<p>No other matching originals in this audience.</p>}
        <div className="duplicate-candidates">{matches.candidates.map(candidate=><article key={candidate.id}><p>{candidate.name}</p><span className="small-muted">{verified.includes(candidate.id)?'Identical bytes verified':'Matching recorded fingerprint'}</span><div className="duplicate-actions"><button className="button secondary compact" disabled={busy||candidate.size>duplicateVerificationLimit} onClick={()=>void verify(candidate)}>Verify originals</button>{canOrganise&&verified.includes(candidate.id)&&<button className="button secondary compact" disabled={busy||!albumId} onClick={()=>void reuse(candidate)}>Add existing to album</button>}</div></article>)}</div>
        {matches.hasMore&&<p className="small-muted">Showing the first 50 matching originals.</p>}{matches.source.size>duplicateVerificationLimit&&<p className="small-muted">In-app verification is limited to 250 MiB per original. These matches remain unverified.</p>}
        {canOrganise&&<WorkspaceSelect label="Album for existing original" value={albumId} onChange={setAlbumId} disabled={busy} options={[{value:'',label:'Choose album'},...albums.filter(album=>!album.archivedAt&&(album.accessScopeId??null)===matches.source.accessScopeId).map(album=>({value:album.id,label:album.name}))]}/>}</>}
      {busy&&<p role="status">Working{progress?`: ${progress}%`: '...'}</p>}{notice&&!busy&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error-banner">{error}</p>}
      {busy&&verifying&&<button className="text-button" onClick={()=>controller.current?.abort()}>Cancel verification</button>}{undo&&!busy&&<button className="text-button" onClick={()=>void undoReference()}>Undo album addition</button>}
    </dialog>}
  </>;
}
