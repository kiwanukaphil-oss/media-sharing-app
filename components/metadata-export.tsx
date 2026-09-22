"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileJson, X } from "lucide-react";
import type { MediaItem } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";

// Metadata is a small bounded download, not a browser-memory archive of original media. The dialog
// previews scope and privacy before the server rechecks every selected revision and current access.
export function MetadataExport({ files }: { files: MediaItem[] }) {
  const { requestJson } = useLibraryApi();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);
  // Success means a download was handed to the browser; it does not prove that a local save finished.
  async function downloadMetadata() {
    setBusy(true); setError(""); setNotice("");
    try {
      const manifest = await requestJson<{ format: string; formatVersion: number }>("metadata-export", { method: "POST", body: JSON.stringify({ files: files.map(file => ({ id: file.id, expectedRevision: file.revision ?? 0 })) }) });
      if (manifest.format !== "relay-metadata" || manifest.formatVersion !== 1) throw new Error("The metadata export could not be verified.");
      const url = URL.createObjectURL(new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = `relay-metadata-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice("Metadata download started. Original files are downloaded separately.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Metadata could not be exported."); }
    finally { setBusy(false); }
  }
  return <>
    <button className="icon-button" title="Export selected metadata" aria-label="Export selected metadata" onClick={() => { setError(""); setNotice(""); setOpen(true); }}><FileJson size={19} /></button>
    {open && <dialog ref={dialog} className="modal library-dialog" aria-labelledby={titleId} onClose={() => setOpen(false)}>
      <div className="modal-heading"><h2 id={titleId}>Export metadata</h2><button className="icon-button" aria-label="Close metadata export" disabled={busy} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p>{files.length} selected {files.length === 1 ? "file" : "files"} in this library. A JSON manifest preserves names, dates, checksums, albums and sections.</p>
      <p className="small-muted">This download contains metadata only. Original bytes and their embedded EXIF/location data are unchanged; download originals separately. Keep the manifest private if its filenames or album details are sensitive.</p>
      <p className="small-muted">Suggested paths use a separate directory for each file to avoid filename collisions. No account credentials, download links or other people’s favourites are included.</p>
      {error && <p role="alert" className="error-banner">{error}</p>}{notice && <p role="status">{notice}</p>}
      <button className="button primary" disabled={busy || !files.length} onClick={() => void downloadMetadata()}><FileJson size={17} />{busy ? "Preparing…" : "Download metadata"}</button>
    </dialog>}
  </>;
}
