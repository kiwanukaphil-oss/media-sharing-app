"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, ArrowUp, FolderInput, Image as ImageIcon, LayoutTemplate, Pencil, Plus, Trash2, X } from "lucide-react";
import type { Album, AlbumSection, MediaItem, FeedPage } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";
import type { LibraryQuery } from "./library-tools";
import { WorkspaceSelect } from "./workspace-select";

type Props = {
  album: Album; sections: AlbumSection[]; query: LibraryQuery; onQuery: (query: LibraryQuery) => void;
  selected: MediaItem[]; canOrganise: boolean; canMoveSelection?: boolean; refresh: () => Promise<void>; clearSelection: () => void;
  feedback: { setMessage: (message: string) => void; setUndo: (undo: (() => () => Promise<unknown>) | null) => void };
};

// Sections are album-local placement controls, not access settings or creative approval states.
export function AlbumSections({ album, sections, query, onQuery, selected, canOrganise, canMoveSelection, refresh, clearSelection, feedback }: Props) {
  const { requestJson, apiUrl } = useLibraryApi();
  const [editor, setEditor] = useState<AlbumSection | "new" | "move" | "template" | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [templatePreview, setTemplatePreview] = useState<FeedPage | null>(null);
  const [mapExisting, setMapExisting] = useState(false);
  const [destination, setDestination] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const active = sections.find(section => section.id === query.section);
  const canEdit = canOrganise && !album.archivedAt;
  useEffect(() => { const current = dialog.current; if (editor) current?.showModal(); return () => current?.close(); }, [editor]);

  // Record successful mutation feedback before refresh, so network failures do not discard Undo.
  async function mutateSection(action: () => Promise<void>) {
    setBusy(true); setFailure("");
    try { await action(); setEditor(null); await refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Couldn't update sections."); }
    finally { setBusy(false); }
  }

  // Album revisions serialize management edits; soft removal retains placement for safe restoration.
  async function saveSection(section: AlbumSection | null, name: string, position: number, deleted = false, coverMediaId: string | null | undefined = section?.coverMediaId) {
    const previous = section && { albumId: album.id, name: section.name, position: section.position, deleted: false, coverMediaId: section.coverMediaId || null };
    const result = await requestJson<{ id: string; revision: number }>(section ? `sections/${section.id}` : "sections", {
      method: section ? "PUT" : "POST", body: JSON.stringify({ albumId: album.id, name, position, deleted, coverMediaId, expectedRevision: album.revision }),
    });
    feedback.setUndo(previous ? () => () => requestJson(`sections/${section!.id}`, { method: "PUT", body: JSON.stringify({ ...previous, expectedRevision: result.revision }) }) : null);
    feedback.setMessage(deleted ? "Section removed. Files are now Unsectioned." : section ? "Section updated." : "Section created.");
    if (deleted && query.section === section?.id) onQuery({ ...query, section: "unsectioned" });
    if (!section) onQuery({ ...query, section: result.id });
  }

  // Preserve each file's previous placement, allowing one Undo for a mixed-section selection.
  async function moveSelection() {
    const result = await requestJson<{ previous: { id: string; sectionId: string | null; expectedRevision: number }[] }>("library/sections", {
      method: "POST", body: JSON.stringify({ albumId: album.id, files: selected.map(file => ({ id: file.id, expectedRevision: file.revision ?? 0, sectionId: destination || null })) }),
    });
    feedback.setUndo(() => () => requestJson("library/sections", { method: "POST", body: JSON.stringify({ albumId: album.id, files: result.previous }) }));
    feedback.setMessage(`${selected.length} ${selected.length === 1 ? "file moved" : "files moved"} to ${sections.find(section => section.id === destination)?.name || "Unsectioned"}.`);
    clearSelection();
  }

  // Reorder a snapshot of all sections; the server rejects simultaneous edits instead of losing them.
  async function changeSectionOrder(section: AlbumSection, direction: number) {
    const ids = sections.map(item => item.id), previous = [...ids];
    const index = ids.indexOf(section.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    const result = await requestJson<{ revision: number }>("sections/order", { method: "POST", body: JSON.stringify({ albumId: album.id, expectedRevision: album.revision, ids }) });
    feedback.setUndo(() => () => requestJson("sections/order", { method: "POST", body: JSON.stringify({ albumId: album.id, expectedRevision: result.revision, ids: previous }) }));
    feedback.setMessage("Section order updated.");
  }

  async function previewTemplate() {
    setFailure(""); setBusy(true); setTemplatePreview(null); setMapExisting(false); setEditor("template");
    try { const preview = await requestJson<FeedPage>(`feed?album=${album.id}&limit=100`); setTemplatePreview(preview); setMapExisting(preview.total <= 100); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Couldn't load template preview."); }
    finally { setBusy(false); }
  }

  // The preview explicitly names the files to classify; template creation does not change global categories.
  async function createTemplate() {
    const files = mapExisting ? templatePreview!.items.map(file => ({ id: file.id, expectedRevision: file.revision ?? 0 })) : [];
    const result = await requestJson<{ files: { id: string; revision: number }[] }>("sections/template", { method: "POST", body: JSON.stringify({ albumId: album.id, expectedRevision: album.revision, files }) });
    feedback.setUndo(result.files.length ? () => () => requestJson("library/sections", { method: "POST", body: JSON.stringify({ albumId: album.id, files: result.files.map(file => ({ id: file.id, expectedRevision: file.revision, sectionId: null })) }) }) : null);
    feedback.setMessage(result.files.length ? "Template created. Undo returns mapped files to Unsectioned and keeps the new sections." : "Originals and Final cuts sections created.");
  }

  return <section className="album-sections" aria-label="Album sections">
    <div className="section-navigation">
      {/* Authenticated section covers must not pass through a public image cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {active?.coverMediaId && <img className="section-cover" src={apiUrl(`media/${active.coverMediaId}/thumbnail`)} alt="" width={36} height={36} />}
      <WorkspaceSelect label="Album section" value={query.section} onChange={section => onQuery({ ...query, section })} options={[
        { value: "", label: `All in this album (${album.count})` },
        { value: "unsectioned", label: `Unsectioned (${Math.max(0, album.count - sections.reduce((sum, section) => sum + section.count, 0))})` },
        ...sections.map(section => ({ value: section.id, label: `${section.name} (${section.count})` })),
      ]} />
      {canEdit && <button className="button compact" onClick={() => { setFailure(""); setEditor("new"); }}><Plus size={16} />New section</button>}
      {canEdit && !sections.length && <button className="button compact" disabled={busy} onClick={() => void previewTemplate()}><LayoutTemplate size={16} />Use template</button>}
      {canEdit && active && <button className="icon-button" aria-label="Manage section" title="Manage section" onClick={() => { setFailure(""); setEditor(active); }}><Pencil size={16} /></button>}
      {(canEdit || (canMoveSelection && !album.archivedAt)) && selected.length > 0 && !selected.some(file => file.archivedAt) && <button className="button compact" onClick={() => { setFailure(""); setDestination(""); setEditor("move"); }}><FolderInput size={16} />Move to section</button>}
    </div>
    <p className="section-explanation">Sections organise this album. Everyone in this space can still see its files.</p>
    {failure && !editor && <p className="error-banner" role="alert">{failure}</p>}
    {editor && <dialog ref={dialog} className="modal library-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!busy) setEditor(null); }} onClose={() => { if (!busy) setEditor(null); }}>
      <div className="modal-heading"><h2 id={titleId}>{editor === "new" ? "New section" : editor === "move" ? "Move to section" : editor === "template" ? "Album template" : "Manage section"}</h2><button className="icon-button" aria-label="Close section dialog" disabled={busy} onClick={() => setEditor(null)}><X size={20} /></button></div>
      {editor === "template" ? <div className="library-form"><p>Create two editable sections: <strong>Originals</strong> and <strong>Final cuts</strong>. Your existing global categories stay unchanged.</p>{templatePreview ? <><p>{templatePreview.total} existing files in this album.</p><label className="check-label"><input type="checkbox" checked={mapExisting} disabled={templatePreview.total > 100} onChange={event => setMapExisting(event.target.checked)} />Place existing files using their current categories</label>{templatePreview.total > 100 && <p>For albums over 100 files, create the sections first, then move files in selected batches.</p>}{mapExisting && <div className="template-file-preview"><p>{templatePreview.items.filter(file => file.category === "original").length} to Originals ? {templatePreview.items.filter(file => file.category === "final").length} to Final cuts</p><ul>{templatePreview.items.map(file => <li key={file.id}>{file.name} ? {file.category === "original" ? "Originals" : "Final cuts"}</li>)}</ul></div>}<button className="button primary" disabled={busy} onClick={() => void mutateSection(createTemplate)}>Create template sections</button></> : <p role="status">{busy ? "Loading preview?" : "Preview unavailable. Close and try again."}</p>}</div> : editor === "move" ? <div className="library-form"><p>{selected.length} selected. Placement in other albums stays the same.</p><WorkspaceSelect label="Destination section" value={destination} onChange={setDestination} options={[{ value: "", label: "Unsectioned" }, ...sections.map(section => ({ value: section.id, label: section.name }))]} /><button className="button primary" disabled={busy} onClick={() => void mutateSection(moveSelection)}>Move files</button></div> : <form className="library-form" onSubmit={event => { event.preventDefault(); const name = String(new FormData(event.currentTarget).get("name") || ""); void mutateSection(() => saveSection(editor === "new" ? null : editor, name, editor === "new" ? Math.max(0, ...sections.map(section => section.position)) + 10 : editor.position)); }}>
        <label>Section name<input name="name" autoFocus required maxLength={100} defaultValue={editor === "new" ? "" : editor.name} placeholder="e.g. Ceremony, Shortlist, Deliverables" /></label>
        <button className="button primary" disabled={busy}>{editor === "new" ? "Create section" : "Save section"}</button>
        {editor !== "new" && <div className="section-management"><button type="button" className="button compact" disabled={busy || sections[0]?.id === editor.id} onClick={() => void mutateSection(() => changeSectionOrder(editor, -1))}><ArrowUp size={15} />Earlier</button><button type="button" className="button compact" disabled={busy || sections.at(-1)?.id === editor.id} onClick={() => void mutateSection(() => changeSectionOrder(editor, 1))}><ArrowDown size={15} />Later</button><button type="button" className="text-button danger" disabled={busy} onClick={() => void mutateSection(() => saveSection(editor, editor.name, editor.position, true))}><Trash2 size={15} />Remove section</button>{selected.length === 1 && selected[0].hasPreview && <button type="button" className="button compact" disabled={busy} onClick={() => void mutateSection(() => saveSection(editor, editor.name, editor.position, false, selected[0].id))}><ImageIcon size={15} />Use selected file as cover</button>}{editor.coverMediaId && <button type="button" className="text-button" disabled={busy} onClick={() => void mutateSection(() => saveSection(editor, editor.name, editor.position, false, null))}>Clear cover</button>}</div>}
      </form>}
      {failure && <p className="error-banner" role="alert">{failure}</p>}
    </dialog>}
  </section>;
}
