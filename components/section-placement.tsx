"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Check, Folder, X } from "lucide-react";
import type { Album, AlbumSection, MediaItem } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";

type Props = {
  album: Album; sections: AlbumSection[]; files: MediaItem[]; close: () => void;
  refresh: () => Promise<void>; clearSelection: () => void;
  feedback: { setMessage: (message: string) => void; setUndo: (undo: (() => () => Promise<unknown>) | null) => void };
};

// A single placement surface serves file actions and bulk selection, with album-local revision-safe Undo.
export function SectionPlacement({ album, sections, files, close, refresh, clearSelection, feedback }: Props) {
  const { requestJson } = useLibraryApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [destination, setDestination] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  const choices = [{ id: "", name: "Unsectioned", count: undefined }, ...sections];
  const unchanged = destination !== null && files.every(file => (file.sectionId || "") === destination);

  // Retain the draft on failure, and record Undo before refresh so a transient read failure cannot lose it.
  async function moveFilesToSection() {
    if (destination === null || busy || unchanged) return;
    setBusy(true); setFailure("");
    try {
      const result = await requestJson<{ previous: { id: string; sectionId: string | null; expectedRevision: number }[] }>("library/sections", {
        method: "POST", body: JSON.stringify({ albumId: album.id, files: files.map(file => ({ id: file.id, expectedRevision: file.revision ?? 0, sectionId: destination || null })) }),
      });
      feedback.setUndo(() => () => requestJson("library/sections", { method: "POST", body: JSON.stringify({ albumId: album.id, files: result.previous }) }));
      feedback.setMessage(`${files.length} ${files.length === 1 ? "file moved" : "files moved"} to ${choices.find(section => section.id === destination)?.name || "Unsectioned"}.`);
      clearSelection(); close(); await refresh();
    } catch (error) { setFailure(error instanceof Error ? error.message : "Couldn't move these files. Please try again."); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} className="modal section-placement" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); if (!busy) close(); }} onClose={() => { if (!busy) close(); }}>
    <div className="modal-heading"><h2 id={headingId}>Move to section</h2><button className="icon-button" aria-label="Close section dialog" disabled={busy} onClick={close}><X size={20} /></button></div>
    <p className="placement-summary"><strong>{files.length === 1 ? files[0].name : `${files.length} selected files`}</strong><span>{album.name}</span></p>
    <div className="placement-choices" role="group" aria-label="Destination section">{choices.map(section => <button key={section.id} className="placement-choice" aria-pressed={destination === section.id} disabled={busy} onClick={() => setDestination(section.id)}><Folder size={18} /><span>{section.name}</span>{section.count !== undefined && <small>{section.count}</small>}{destination === section.id && <Check size={18} />}</button>)}</div>
    {!sections.length && <p className="small-muted">Create a section from the album&apos;s Sections menu first.</p>}
    <p className="small-muted">Only placement in this album changes.</p>
    {failure && <div role="alert" className="error-banner">{failure}<button className="text-button" disabled={busy} onClick={() => { setBusy(true); void refresh().then(() => { clearSelection(); close(); }).catch(() => { setFailure("Could not refresh files. Please try again."); setBusy(false); }); }}>Refresh files</button></div>}
    <button className="button primary placement-submit" disabled={busy || destination === null || unchanged} onClick={() => void moveFilesToSection()}>{busy ? "Moving..." : unchanged ? "Already in this section" : files.length === 1 ? "Move file" : "Move files"}<ArrowRight size={16} /></button>
  </dialog>;
}
