"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Download, FileArchive, LoaderCircle, X } from "lucide-react";
import { formatBytes, type MediaItem } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";

// A native attachment download avoids multiple-download prompts and assembling a ZIP in phone memory.
export function BulkDownload({ files }: { files: MediaItem[] }) {
  const { requestJson, apiUrl } = useLibraryApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [selection, setSelection] = useState<MediaItem[]>([]);
  const [status, setStatus] = useState(""), [error, setError] = useState(""), [ready, setReady] = useState(false);
  const ids = selection.map(file => file.id).join(",");
  const path = `bulk-download?ids=${encodeURIComponent(ids)}`;
  useEffect(() => {
    if (!selection.length) return;
    dialog.current?.showModal();
    const abort = new AbortController();
    void requestJson(`${path}&check=1`, { signal: abort.signal }).then(() => { if (!abort.signal.aborted) { setReady(true); setStatus(""); } }).catch(failure => { if (!abort.signal.aborted) { setStatus(""); setError(failure instanceof Error ? failure.message : "Could not prepare this download."); } });
    return () => abort.abort();
  }, [selection, path, requestJson]);
  return <><button ref={opener} className="icon-button" title="Save selected to device" aria-label="Save selected to device" disabled={!files.length || files.some(file => file.archivedAt)} onClick={() => { setSelection([...files]); setReady(false); setError(""); setStatus("Preparing..."); }}><Download size={19} /></button>
    {selection.length > 0 && <dialog ref={dialog} className="modal bulk-download-dialog" aria-labelledby={title} onClose={() => { setSelection([]); opener.current?.focus({ preventScroll: true }); }}>
      <div className="bulk-download-heading"><h2 id={title}>Download originals</h2><button className="bulk-download-close" aria-label="Close bulk download" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <div className="bulk-download-summary"><span className="bulk-download-symbol"><FileArchive size={24} strokeWidth={1.5} /></span><div><p className="bulk-download-count">{selection.length} {selection.length === 1 ? "file" : "files"}</p><p className="bulk-download-size">{formatBytes(selection.reduce((sum, file) => sum + file.size, 0))}</p></div><span className="bulk-download-format">ZIP</span></div>
      <div className="bulk-download-status" aria-live="polite">{ready && status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}</div>
      {error && <details className="bulk-download-alternatives"><summary>Save files individually</summary><ul>{selection.map(file => <li key={file.id}><a href={apiUrl(`media/${file.id}/download`)} download={file.name}>{file.name}</a></li>)}</ul></details>}
      <div className="bulk-download-footer"><button className="button bulk-download-cancel" onClick={() => dialog.current?.close()}>Cancel</button>
        {ready ? <a className="button primary" href={apiUrl(path)} download="relay-originals.zip" onClick={() => setStatus("Download requested.")}><Download size={17} />Download ZIP</a> : <button className="button primary" disabled>{!error && <LoaderCircle size={17} className="spin" />}{error ? "Unavailable" : "Preparing"}</button>}
      </div>
    </dialog>}
  </>;
}
