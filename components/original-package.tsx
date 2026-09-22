"use client";
import {useEffect,useId,useRef,useState} from "react";
import {Download,X} from "lucide-react";
import {useLibraryApi} from "./library-scope";
import {portableFilePath} from "@/lib/portable-file-path";
import {formatBytes,type MediaItem} from "@/lib/contracts";
import {packageMemoryLimit,validatePackageManifest,writeOriginalPackage,type PackageManifest,type PackageSink} from "@/lib/original-package";

type PickerWindow=Window&{showSaveFilePicker?:(options:{suggestedName:string})=>Promise<FileSystemFileHandle>};
let packageInProgress=false;

// The foreground job streams directly to a chosen file where supported, with a strictly bounded
// fallback. Selection, access and metadata are rechecked before final commit; a retry starts fresh.
export function OriginalPackage({files,deliveryId}:{files:Pick<MediaItem,'id'|'name'|'size'|'sha256'|'revision'>[];deliveryId?:string}){
  const {requestJson}=useLibraryApi(),title=useId(),dialog=useRef<HTMLDialogElement>(null),controller=useRef<AbortController|null>(null);
  const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[notice,setNotice]=useState(''),[error,setError]=useState('');
  useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  // Delivery manifests expose only captured delivery labels, never source-library organisation.
  async function loadManifest(signal:AbortSignal):Promise<PackageManifest>{
    if(!deliveryId)return requestJson<PackageManifest>('metadata-export',{method:'POST',signal,body:JSON.stringify({files:files.map(file=>({id:file.id,expectedRevision:file.revision??0}))})});
    const value=await requestJson<{delivery:Record<string,unknown>;items:PackageManifest['files']}>(`delivery/${deliveryId}`,{signal});
    return {format:'relay-delivery-originals',formatVersion:1,delivery:value.delivery,files:value.items.map(file=>({...file,suggestedPath:portableFilePath(file.id,file.name)})),privacy:'Original embedded metadata, including location, is preserved. Source-library organisation is intentionally excluded.'};
  }
  // Obtain the native picker within the user's click gesture; no bytes are persisted in browser
  // storage. Object URLs for the small fallback are short-lived and never count as a verified save.
  async function savePackage(){
    if(packageInProgress){setError('Another package is running in this tab. Finish or cancel it first.');return;}
    packageInProgress=true;const abort=new AbortController();controller.current=abort;setBusy(true);setError('');setNotice('');setProgress(0);
    let sink:PackageSink|undefined;
    try{
      const picker=(window as PickerWindow).showSaveFilePicker;
      const handle=picker?await picker.call(window,{suggestedName:'relay-originals.zip'}):null;
      abort.signal.throwIfAborted();const manifest=await loadManifest(abort.signal);validatePackageManifest(manifest,handle?undefined:packageMemoryLimit);
      const chunks:Uint8Array<ArrayBuffer>[]=[];let buffered=0;
      if(handle){const writer=await handle.createWritable();sink={write:bytes=>writer.write(new Uint8Array(bytes).buffer),close:()=>writer.close(),abort:()=>writer.abort()};}
      else sink={write:async bytes=>{buffered+=bytes.length;if(buffered>packageMemoryLimit+5*1024**2)throw new Error('The package exceeded this browser\'s memory limit.');chunks.push(new Uint8Array(bytes));},abort:async()=>{chunks.length=0;},close:async()=>{}};
      const comparable=(value:PackageManifest)=>JSON.stringify({...value,exportedAt:undefined});
      await writeOriginalPackage(manifest,sink,{signal:abort.signal,
        read:async file=>{const {url}=await requestJson<{url:string}>(deliveryId?`delivery/${deliveryId}/${file.id}/link`:`media/${file.id}/link`,{signal:abort.signal});return fetch(url,{signal:abort.signal});},
        revalidate:async()=>{if(comparable(await loadManifest(abort.signal))!==comparable(manifest))throw new Error('The selection or your access changed. Refresh and retry the entire package.');},
        onProgress:(bytes,total)=>setProgress(Math.min(99,Math.round(bytes/total*100)))});
      setProgress(100);
      if(handle)setNotice('Package saved. Every original verified.');
      else{const url=URL.createObjectURL(new Blob(chunks,{type:'application/zip'})),anchor=document.createElement('a');anchor.href=url;anchor.download='relay-originals.zip';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),60000);setNotice('Package verified; download requested. Check your browser\'s downloads.');}
    }catch(failure){await sink?.abort().catch(()=>{});if(abort.signal.aborted||failure instanceof DOMException&&failure.name==='AbortError')setNotice('Package cancelled. No complete package was saved.');else setError(failure instanceof Error?failure.message:'The package could not be created.');}
    finally{packageInProgress=false;controller.current=null;setBusy(false);}
  }
  return <><button className="button secondary compact" onClick={()=>{setError('');setNotice('');setOpen(true);}}><Download size={16}/>Download originals</button>
    {open&&<dialog ref={dialog} className="modal library-dialog" aria-labelledby={title} onCancel={event=>{if(busy)event.preventDefault();}} onClose={()=>setOpen(false)}>
      <div className="modal-heading"><h2 id={title}>Download originals</h2><button className="icon-button" aria-label="Close original package" disabled={busy} onClick={()=>dialog.current?.close()}><X size={20}/></button></div>
      <p>{files.length} selected {files.length===1?'original':'originals'} &middot; {formatBytes(files.reduce((sum,file)=>sum+file.size,0))}</p>
      <div className="delivery-selection"><strong>Selected originals</strong><ul>{files.map(file=><li key={file.id}>{file.name}</li>)}</ul></div>
      <p className="small-muted">One ZIP with original files and a manifest of their names, dates and checksums{deliveryId?'.':', albums and sections.'} Original location and other embedded metadata are preserved.</p>
      <p className="small-muted">Keep this tab open. Up to 2 GiB with direct file saving, or 64 MiB in other browsers. A failed or cancelled package can be restarted; partial packages are never marked complete.</p>
      {busy&&<p role="status">Building and verifying package: {progress}%</p>}{notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="error-banner">{error}</p>}
      {busy?<button className="button secondary" onClick={()=>controller.current?.abort()}>Cancel package</button>:<button className="button primary" disabled={!files.length} onClick={()=>void savePackage()}>{error?'Retry package':'Create ZIP'}</button>}
    </dialog>}
  </>;
}
