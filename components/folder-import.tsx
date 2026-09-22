"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FolderInput, X } from "lucide-react";
import { planFolderImport, type FolderImportPlan } from "@/lib/folder-import";
import { formatBytes } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";

export type MappedImportFile = { file: File; transferId: string; accessScopeId: string | null; audienceName?: string; albumId: string; albumName: string; sectionId?: string; sectionName?: string };
type Preview = { accessScopeId: string | null; audienceName?: string; id: string; files: File[]; transferIds: string[]; plan: FolderImportPlan; sections: { id: string; key: string; name: string; count: number }[] };

// Folder APIs are optional. Preview all grouping changes before creating a new album; preserve bytes
// and duplicate filenames as independent originals, then reuse the existing persistent transfer queue.
export function FolderImport({ disabled, spaceName, accessScopeId = null, audienceName, queue }: { disabled: boolean; spaceName: string; accessScopeId?: string | null; audienceName?: string; queue: (files: MappedImportFile[]) => Promise<void> }) {
  const { requestJson } = useLibraryApi();
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  const [preview, setPreview] = useState<Preview | null>(null), [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false), [created, setCreated] = useState(false), [queued, setQueued] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Feature detection happens only in the browser.
    setSupported("webkitdirectory" in document.createElement("input"));
  }, []);
  useEffect(() => { if (preview) dialog.current?.showModal(); }, [preview]);
  function previewFolder(files: File[]) {
    setError(""); setCreated(false); setQueued(false);
    try {
      const plan = planFolderImport(files);
      setPreview({ accessScopeId, audienceName, id: crypto.randomUUID(), files, transferIds: files.map(() => crypto.randomUUID()), plan,
        sections: plan.sections.map(section => ({ ...section, id: crypto.randomUUID() })) });
    } catch (failure) { setError(failure instanceof Error ? failure.message : "This folder could not be previewed."); }
  }
  // Stable layout and transfer IDs survive a failed response/retry within this preview. Already queued
  // entries are skipped by the workspace; never announce upload completion merely for queueing files.
  async function startFolderImport() {
    if (!preview) return;
    setBusy(true); setError("");
    try {
      const layout = await requestJson<{ album: { id: string; name: string }; sections: { id: string; name: string }[] }>("import-layout", {
        method: "POST", body: JSON.stringify({ id: preview.id, accessScopeId: preview.accessScopeId, name: preview.plan.albumName, sections: preview.sections.map(({ id, name }) => ({ id, name })) }),
      });
      setCreated(true);
      await queue(preview.plan.files.map(entry => {
        const section = preview.sections.find(candidate => candidate.key === entry.sectionKey);
        return { accessScopeId: preview.accessScopeId, audienceName: preview.audienceName, file: preview.files[entry.index], transferId: preview.transferIds[entry.index], albumId: layout.album.id, albumName: layout.album.name,
          sectionId: section?.id, sectionName: section?.name };
      }));
      setQueued(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The import could not be queued. Retry this preview."); }
    finally { setBusy(false); }
  }
  const namesValid = preview && preview.plan.albumName.trim() && preview.sections.every(section => section.name.trim()) &&
    new Set(preview.sections.map(section => section.name.trim().toLowerCase())).size === preview.sections.length;
  return <>
    <button className="button secondary" disabled={disabled} onClick={() => input.current?.click()}><FolderInput size={17} />{supported ? "Import folder" : "Import files"}</button>
    <input ref={input} type="file" multiple {...(supported ? { webkitdirectory: "" } : {})} className="visually-hidden" tabIndex={-1}
      aria-label={supported ? "Choose folder to import" : "Choose files to import"} onChange={event => { if (event.target.files) previewFolder(Array.from(event.target.files)); event.target.value = ""; }} />
    {error && !preview && <p role="alert" className="error-banner">{error}</p>}
    {preview && <dialog ref={dialog} className="modal library-dialog folder-import-dialog" aria-labelledby={titleId} onClose={() => setPreview(null)} onCancel={event => { if (busy) event.preventDefault(); }}>
      <div className="modal-heading"><h2 id={titleId}>Review folder import</h2><button className="icon-button" aria-label="Close folder import" disabled={busy} onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p>{preview.files.length} files · {formatBytes(preview.plan.totalBytes)} · {spaceName}</p>
      <p className="small-muted">Creates a new album in this library. Sections inherit its audience; folder names do not make content private. Files keep their original bytes and names.</p>
      {!supported && <p className="small-muted">This browser does not supply folder structure. Selected files will go directly into the new album.</p>}
      <label className="folder-import-name">New album name<input maxLength={100} disabled={busy || created} value={preview.plan.albumName} onChange={event => setPreview({ ...preview, plan: { ...preview.plan, albumName: event.target.value } })} /></label>
      <div className="folder-import-mapping"><table><caption>Folder mapping</caption><thead><tr><th>Folder</th><th>Section</th><th>Files</th></tr></thead><tbody>
        {preview.sections.map((section, index) => <tr key={section.id}><td>{section.key}</td><td><input aria-label={`Section for ${section.key}`} maxLength={100} disabled={busy || created} value={section.name}
          onChange={event => setPreview({ ...preview, sections: preview.sections.map((value, position) => position === index ? { ...value, name: event.target.value } : value) })} /></td><td>{section.count}</td></tr>)}
        {preview.plan.files.some(entry => !entry.sectionKey) && <tr><td>Top level</td><td>Unsectioned</td><td>{preview.plan.files.filter(entry => !entry.sectionKey).length}</td></tr>}
      </tbody></table></div>
      {preview.plan.flattened && <p className="small-muted">Nested folders become section labels at one level. Review or shorten the labels above.</p>}
      {!!preview.plan.duplicateNames && <p className="small-muted">{preview.plan.duplicateNames} repeated filenames. Each file remains a separate original; nothing is overwritten or automatically merged.</p>}
      {!namesValid && <p role="alert">Use an album name and distinct, non-empty section names.</p>}
      {error && <p role="alert" className="error-banner">{error}</p>}
      {queued ? <p role="status">Files queued. Follow upload progress in Transfers; queued does not mean uploaded.</p> : <button className="button primary" disabled={busy || !namesValid} onClick={() => void startFolderImport()}>{busy ? "Preparing import…" : created ? "Retry remaining files" : "Create album and queue files"}</button>}
    </dialog>}
  </>;
}
