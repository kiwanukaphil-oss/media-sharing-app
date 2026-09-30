"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Download, X } from "lucide-react";
import { formatBytes, type MediaItem } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";

// A native attachment download avoids multiple-download prompts and assembling a ZIP in phone memory.
export function BulkDownload({ files }: { files: MediaItem[] }) {
  const { requestJson, apiUrl } = useLibraryApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
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
  return <><button className="button secondary compact" disabled={!files.length || files.some(file => file.archivedAt)} onClick={() => { setSelection([...files]); setReady(false); setError(""); setStatus("Checking selected files..."); }}><Download size={18} />Save selected to device</button>
    {selection.length > 0 && <dialog ref={dialog} className="modal library-dialog" aria-labelledby={title} onClose={() => setSelection([])}>
      <div className="modal-heading"><h2 id={title}>Save selected to device</h2><button className="icon-button" aria-label="Close bulk download" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p>{selection.length} files · {formatBytes(selection.reduce((sum, file) => sum + file.size, 0))}</p>
      <p>Download the original files together in one ZIP. On iPhone, open the download in Files and tap the ZIP to unpack it. Photos and videos can then be saved to Photos using Share.</p>
      <p className="small-muted">Up to 100 files and 2 GiB per ZIP. Originals keep their quality and embedded metadata. Progress and cancellation appear in your browser’s downloads.</p>
      {status && <p role="status">{status}</p>}{error && <p role="alert" className="error-banner">{error}</p>}
      {ready && <a className="button primary" href={apiUrl(path)} download="relay-originals.zip" onClick={() => setStatus("Download requested. Check your browser’s downloads for progress.")}>Download ZIP</a>}
      {error && <details><summary>Save files individually</summary><ul>{selection.map(file => <li key={file.id}><a href={apiUrl(`media/${file.id}/download`)} download={file.name}>{file.name}</a></li>)}</ul></details>}
    </dialog>}
  </>;
}
