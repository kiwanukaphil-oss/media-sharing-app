"use client";

import { useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { FolderMinus, FolderPlus, Pencil, SlidersHorizontal, Trash2, Undo2, X } from "lucide-react";
import { AlbumSections } from "./album-sections";
import { WorkspaceSelect } from "./workspace-select";
import { useLibraryApi } from "./library-scope";
import { numberedFilename, splitFilename, validFilename } from "@/lib/library-names";
import type { Album, AlbumSection, MediaItem, RenameEntry } from "@/lib/contracts";

export type LibraryQuery = { album: string; section: string; dateMode: string; from: string; to: string; sort: string; batch: string; type: string; uploader: string };
export const emptyLibraryQuery: LibraryQuery = { album: "", section: "", dateMode: "uploaded", from: "", to: "", sort: "newest", batch: "", type: "", uploader: "" };
type Props = {
  albums: Album[]; sections: AlbumSection[]; query: LibraryQuery; onQuery: (query: LibraryQuery) => void; canOrganise: boolean;
  selected: MediaItem[]; loadedCount: number; onSelectLoaded: () => void; onClearSelection: () => void;
  refresh: () => Promise<void>; renameItems: MediaItem[]; onRename: (items: MediaItem[]) => void;
  dateItem: MediaItem | null; onDate: (item: MediaItem | null) => void;
  children: React.ReactNode;
  viewControls: React.ReactNode;
  feedback: { message: string; setMessage: Dispatch<SetStateAction<string>>; undo: (() => Promise<unknown>) | null; setUndo: Dispatch<SetStateAction<(() => Promise<unknown>) | null>> };
};

// Native dialogs provide focus containment and return focus to the invoking control.
function LibraryDialog({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  return <dialog ref={ref} className="modal library-dialog" aria-labelledby={id} onClose={close} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="modal-heading"><h2 id={id}>{title}</h2><button type="button" className="icon-button" aria-label="Close dialog" onClick={close}><X size={20} /></button></div>{children}
  </dialog>;
}

// Organisation controls keep mutations explicit, undoable, and independent of file transfer state.
export function LibraryTools(props: Props) {
  const { requestJson } = useLibraryApi();
  const { albums, query, onQuery, canOrganise, selected, refresh, renameItems, onRename, dateItem, onDate } = props;
  const [albumEditor, setAlbumEditor] = useState<Album | "new" | null>(null);
  const [targetAlbum, setTargetAlbum] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const { message, setMessage, undo, setUndo } = props.feedback;
  const [albumPickerOpen, setAlbumPickerOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterPanelId = useId();
  const activeFilterCount = Number(Boolean(query.from || query.to)) + Number(Boolean(query.batch)) + Number(query.dateMode === "captured") + Number(Boolean(query.type)) + Number(Boolean(query.uploader));
  const activeAlbum = albums.find(album => album.id === query.album);
  const activeAlbums = albums.filter(album => !album.archivedAt);

  // Keep an undo available even if refreshing the view fails after a successful server mutation.
  async function performMutation(action: () => Promise<void>) {
    setBusy(true); setFailure("");
    try { await action(); await refresh(); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Couldn't update the library."); }
    finally { setBusy(false); }
  }

  // Reverse only memberships actually changed, preserving files already present in the destination album.
  async function organiseSelection(action: "add" | "remove" | "trash" | "restore") {
    const albumId = action === "remove" ? query.album : targetAlbum;
    const result = await requestJson<{ changed: { id: string; sectionId?: string | null }[]; files: { id: string; revision: number }[] }>("library/organise", {
      method: "POST", body: JSON.stringify({ action, albumId: albumId || undefined, files: selected.map(file => ({ id: file.id, expectedRevision: file.revision ?? 0 })) }),
    });
    const changed = new Set(result.changed.map(file => file.id));
    const inverse = { add: "remove", remove: "add", trash: "restore", restore: "trash" }[action];
    const files = result.files.filter(file => changed.has(file.id)).map(file => ({ id: file.id, expectedRevision: file.revision, ...(action === "remove" ? { sectionId: result.changed.find(changed => changed.id === file.id)?.sectionId ?? null } : {}) }));
    setUndo(files.length ? () => () => requestJson("library/organise", { method: "POST", body: JSON.stringify({ action: inverse, albumId: albumId || undefined, files }) }) : null);
    setMessage(`${files.length} ${files.length === 1 ? "file" : "files"} ${action === "add" ? "added to album" : action === "remove" ? "removed from album" : action === "trash" ? "moved to Trash" : "restored"}.`);
    setAlbumPickerOpen(false);
    props.onClearSelection();
  }

  async function saveAlbum(name: string, description: string) {
    if (albumEditor === "new") {
      const result = await requestJson<{ id: string }>("albums", { method: "POST", body: JSON.stringify({ name, description }) });
      onQuery({ ...query, album: result.id, section: "" }); setMessage("Album created. Drop files here to add them."); setUndo(null);
    } else if (albumEditor) await updateAlbum(albumEditor, { name, description });
    setAlbumEditor(null);
  }

  // Album removal keeps media and memberships; immediate Undo replaces a blocking confirmation.
  async function updateAlbum(album: Album, patch: Partial<{ name: string; description: string; archived: boolean; deleted: boolean }>) {
    const previous = { name: album.name, description: album.description, archived: Boolean(album.archivedAt), deleted: false };
    await requestJson(`albums/${album.id}`, { method: "PUT", body: JSON.stringify({ ...previous, ...patch, expectedRevision: album.revision }) });
    setUndo(() => () => requestJson(`albums/${album.id}`, { method: "PUT", body: JSON.stringify({ ...previous, expectedRevision: album.revision + 1 }) }));
    setMessage(patch.deleted ? "Album removed. Its files remain in your library." : "Album updated.");
    if (patch.deleted) onQuery({ ...query, album: "", section: "" });
  }

  async function saveRenames(files: RenameEntry[]) {
    const previous = renameItems.map(file => ({ id: file.id, name: file.name, expectedRevision: (file.revision ?? 0) + 1 }));
    await requestJson("library/rename", { method: "POST", body: JSON.stringify({ files }) });
    setUndo(() => () => requestJson("library/rename", { method: "POST", body: JSON.stringify({ files: previous }) }));
    setMessage(`${files.length} ${files.length === 1 ? "file renamed" : "files renamed"}. Future downloads use the new names.`);
    onRename([]); props.onClearSelection();
  }

  async function saveCaptureDate(value: string | null) {
    if (!dateItem) return;
    const previous = dateItem;
    await requestJson("library/capture-date", { method: "POST", body: JSON.stringify({ id: previous.id, capturedAt: value, expectedRevision: previous.revision ?? 0 }) });
    setUndo(() => () => requestJson("library/capture-date", { method: "POST", body: JSON.stringify({ id: previous.id, capturedAt: previous.capturedAt ?? null, expectedRevision: (previous.revision ?? 0) + 1 }) }));
    setMessage("Capture date updated. Original file metadata is unchanged."); onDate(null);
  }

  return <section className="library-tools" aria-label="Library organisation">
    <div className="library-command-row">
      {props.children}
      <button className="button secondary compact filter-toggle" aria-expanded={filtersOpen} aria-controls={filterPanelId} onClick={() => setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16} />Filters{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}</button>
      <div className="library-sort"><WorkspaceSelect label="Sort" value={query.sort} onChange={sort => onQuery({ ...query, sort })} options={[{ value: "newest", label: "Newest first" }, { value: "oldest", label: "Oldest first" }]} /></div>
      {props.viewControls}
      {canOrganise && <button className="button compact new-album-button" aria-label="New album" title="New album" disabled={busy} onClick={() => { setFailure(""); setAlbumEditor("new"); }}><FolderPlus size={17} /><span>New album</span></button>}
    </div>
    <div id={filterPanelId} className="library-filter-panel" hidden={!filtersOpen}>
    <div className="library-location">
      <div className="filter-field"><span>Browse</span><WorkspaceSelect label="Browse library" value={query.album} onChange={album => onQuery({ ...query, album, section: "" })} options={[{ value: "", label: "All files" }, { value: "unorganised", label: "Unorganised" }, ...albums.map(album => ({ value: album.id, label: `${album.name} (${album.count})`, group: album.archivedAt ? "Archived albums" : "Albums" }))]} /></div>
    </div>
    <div className="library-filters">
      <div className="filter-field"><span>File type</span><WorkspaceSelect label="File type" value={query.type} onChange={type => onQuery({ ...query, type })} options={[{ value: "", label: "All types" }, { value: "photo", label: "Photos" }, { value: "video", label: "Videos" }, { value: "other", label: "Other files" }]} /></div>
      <div className="filter-field"><span>Added by</span><WorkspaceSelect label="Added by" value={query.uploader} onChange={uploader => onQuery({ ...query, uploader })} options={[{ value: "", label: "Anyone" }, { value: "me", label: "Me" }]} /></div>
      <div className="filter-field"><span>Dates</span><WorkspaceSelect label="Dates" value={query.dateMode} onChange={dateMode => onQuery({ ...query, dateMode })} options={[{ value: "uploaded", label: "Date uploaded (UTC)" }, { value: "captured", label: "Date taken" }]} /></div>
      <label>From<input type="date" data-empty={!query.from} value={query.from} max={query.to || undefined} onChange={event => onQuery({ ...query, from: event.target.value })} /></label>
      <label>To<input type="date" data-empty={!query.to} value={query.to} min={query.from || undefined} onChange={event => onQuery({ ...query, to: event.target.value })} /></label>
      {(query.from || query.to || query.batch) && <button className="text-button" onClick={() => onQuery({ ...query, from: "", to: "", batch: "" })}>Clear date / batch filters</button>}
    </div>
    {query.dateMode === "captured" && <p className="library-context">Camera date where available; otherwise date uploaded (UTC). Missing dates are labelled on each file.</p>}
    </div>
    {(activeAlbum || query.album === "unorganised") && <div className="album-context-row"><p className="library-context">{activeAlbum ? `${activeAlbum.description || "Everyone in this space can view and save these files."}${activeAlbum.archivedAt ? " · Archived — unarchive to upload here." : " · Uploads here go directly into this album."}` : "Files that are not in an album yet. Adding them to an album keeps them in All files."}</p>{canOrganise && activeAlbum && <button className="button compact" disabled={busy} onClick={() => { setFailure(""); setAlbumEditor(activeAlbum); }}><Pencil size={15} />Manage album</button>}</div>}
    {activeAlbum && <AlbumSections album={activeAlbum} sections={props.sections.filter(section => section.albumId === activeAlbum.id)} query={query} onQuery={onQuery} selected={selected} canOrganise={canOrganise} refresh={refresh} clearSelection={props.onClearSelection} feedback={props.feedback} />}
    {activeFilterCount > 0 && <div className="active-library-filters" aria-label="Active filters">
      {query.type && <button className="filter-chip" onClick={() => onQuery({ ...query, type: "" })}>{({ photo: "Photos", video: "Videos", other: "Other files" } as Record<string, string>)[query.type] || "File type"}<X size={13} /></button>}
      {query.uploader && <button className="filter-chip" onClick={() => onQuery({ ...query, uploader: "" })}>Added by me<X size={13} /></button>}
      {query.dateMode === "captured" && <button className="filter-chip" onClick={() => onQuery({ ...query, dateMode: "uploaded" })}>Date taken<X size={13} /></button>}
      {(query.from || query.to) && <button className="filter-chip" onClick={() => onQuery({ ...query, from: "", to: "" })}>{query.from || "Any start"} – {query.to || "Any end"}<X size={13} /></button>}
      {query.batch && <button className="filter-chip" onClick={() => onQuery({ ...query, batch: "" })}>Upload batch<X size={13} /></button>}
      <button className="text-button" onClick={() => onQuery({ ...query, dateMode: "uploaded", from: "", to: "", batch: "", type: "", uploader: "" })}>Clear all filters</button>
    </div>}
    {canOrganise && <div className={`selection-toolbar${selected.length ? " has-selection" : ""}`} aria-label="Bulk file actions">
      {!!selected.length && <><strong aria-live="polite">{selected.length} selected</strong>
        <button className="icon-button" title="Add to album" aria-label="Add to album" disabled={busy || selected.some(file => file.archivedAt)} onClick={() => { setTargetAlbum(""); setAlbumPickerOpen(true); }}><FolderPlus size={19} /></button>
        {activeAlbum && <button className="icon-button" title="Remove from album" aria-label="Remove from album" disabled={busy} onClick={() => void performMutation(() => organiseSelection("remove"))}><FolderMinus size={19} /></button>}
        {!selected.some(file => file.archivedAt) && <button className="icon-button" title="Rename selected" aria-label="Rename selected" disabled={busy} onClick={() => { setFailure(""); onRename(selected); }}><Pencil size={18} /></button>}
        <button className="icon-button bulk-trash" title={selected.every(file => file.archivedAt) ? "Restore selected" : "Move selected to Trash"} aria-label={selected.every(file => file.archivedAt) ? "Restore selected" : "Move selected to Trash"} disabled={busy} onClick={() => void performMutation(() => organiseSelection(selected.every(file => file.archivedAt) ? "restore" : "trash"))}>{selected.every(file => file.archivedAt) ? <Undo2 size={19} /> : <Trash2 size={19} />}</button>
        <button className="icon-button clear-selection" title="Clear selection" aria-label="Clear selection" disabled={busy} onClick={props.onClearSelection}><X size={18} /></button>
      </>}
    </div>}
    {message && <div className="library-feedback" role="status"><span>{message}</span>{undo && <button className="text-button" disabled={busy} onClick={() => void performMutation(async () => { await undo(); setUndo(null); setMessage("Change undone."); })}><Undo2 size={16} />Undo</button>}<button className="icon-button" aria-label="Dismiss feedback" title="Dismiss" disabled={busy} onClick={() => { setMessage(""); setUndo(null); }}><X size={15} /></button></div>}
    {albumPickerOpen && <LibraryDialog title="Add to album" close={() => { if (!busy) setAlbumPickerOpen(false); }}><div className="library-form"><p>{selected.length} {selected.length === 1 ? "file" : "files"}. Originals stay in All files.</p><WorkspaceSelect label="Destination album" value={targetAlbum} onChange={setTargetAlbum} options={[{ value: "", label: "Choose album…" }, ...activeAlbums.map(album => ({ value: album.id, label: album.name }))]} disabled={busy} />{!activeAlbums.length && <p>Create an album first, then add your selection.</p>}{failure && <p role="alert" className="error-banner">{failure}</p>}<button className="button primary" disabled={busy || !targetAlbum || !selected.length} onClick={() => void performMutation(() => organiseSelection("add"))}>Add to album</button></div></LibraryDialog>}
    {failure && !albumEditor && !renameItems.length && !dateItem && <p className="error-banner" role="alert">{failure}</p>}
    {albumEditor && <LibraryDialog title={albumEditor === "new" ? "New album" : "Manage album"} close={() => { if (!busy) setAlbumEditor(null); }}>
      <AlbumForm album={albumEditor === "new" ? null : albumEditor} busy={busy} failure={failure} save={(name, description) => void performMutation(() => saveAlbum(name, description))} />
      {albumEditor !== "new" && <div className="album-management"><button className="button secondary" disabled={busy} onClick={() => void performMutation(async () => { await updateAlbum(albumEditor, { archived: !albumEditor.archivedAt }); setAlbumEditor(null); })}>{albumEditor.archivedAt ? "Unarchive album" : "Archive album"}</button>
        <button className="text-button danger" disabled={busy} onClick={() => void performMutation(async () => { await updateAlbum(albumEditor, { deleted: true }); setAlbumEditor(null); })}>Remove album</button></div>}
    </LibraryDialog>}
    {!!renameItems.length && <LibraryDialog title={renameItems.length === 1 ? "Rename file" : `Rename ${renameItems.length} files`} close={() => { if (!busy) onRename([]); }}><RenameForm items={renameItems} busy={busy} failure={failure} save={files => void performMutation(() => saveRenames(files))} /></LibraryDialog>}
    {dateItem && <LibraryDialog title="Correct capture date" close={() => { if (!busy) onDate(null); }}><form className="library-form" onSubmit={event => { event.preventDefault(); const value = String(new FormData(event.currentTarget).get("capturedAt") || ""); void performMutation(() => saveCaptureDate(value ? value.length === 16 ? `${value}:00` : value : null)); }}>
      <p>Use the date and time shown by the camera. Leave blank if unknown. The original file is not modified.</p><label>Date taken<input name="capturedAt" type="datetime-local" step="1" defaultValue={dateItem.capturedAt || ""} /></label>
      {failure && <p role="alert" className="error-banner">{failure}</p>}<button className="button primary" disabled={busy}>Save capture date</button></form></LibraryDialog>}
  </section>;
}

// Forms remain editable after a failed request, preserving the user's intended album details.
function AlbumForm({ album, busy, failure, save }: { album: Album | null; busy: boolean; failure: string; save: (name: string, description: string) => void }) {
  return <form className="library-form" onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); save(String(data.get("name")), String(data.get("description"))); }}>
    <label>Album name<input name="name" required maxLength={100} defaultValue={album?.name || ""} autoFocus placeholder="e.g. September product shoot" /></label>
    <label>Description<textarea name="description" maxLength={1000} defaultValue={album?.description || ""} placeholder="What belongs here?" /></label>
    <p>Albums organise files within this shared space. Everyone paired to the space can see them.</p>
    {failure && <p role="alert" className="error-banner">{failure}</p>}<button className="button primary" disabled={busy}>{busy ? "Saving…" : album ? "Save album" : "Create album"}</button>
  </form>;
}

// Preview every new filename before applying a single atomic rename; extensions stay read-only.
function RenameForm({ items, busy, failure, save }: { items: MediaItem[]; busy: boolean; failure: string; save: (files: RenameEntry[]) => void }) {
  const [stem, setStem] = useState(items.length === 1 ? splitFilename(items[0].name).stem : "");
  const [numbered, setNumbered] = useState(items.length > 1);
  const [start, setStart] = useState(1);
  const files = items.map((item, index) => ({ id: item.id, name: numbered ? numberedFilename(stem, start + index, splitFilename(item.name).extension) : `${stem.trim()}${splitFilename(item.name).extension}`, expectedRevision: item.revision ?? 0 }));
  const valid = Boolean(stem.trim()) && Number.isInteger(start) && start > 0 && files.every(file => validFilename(file.name));
  return <form className="library-form" onSubmit={event => { event.preventDefault(); if (valid) save(files); }}>
    <label>{items.length === 1 ? "File name" : "Name prefix"}<input autoFocus required value={stem} maxLength={220} onChange={event => setStem(event.target.value)} /></label>
    <label className="check-label"><input type="checkbox" checked={numbered} disabled={items.length > 1} onChange={event => setNumbered(event.target.checked)} />Add sequence numbers</label>
    {numbered && <label>Starting number<input type="number" min={1} max={999999} value={start} onChange={event => setStart(Number(event.target.value))} /></label>}
    <p>Extensions stay unchanged. Names update in every album and future downloads. Uploaded names remain searchable.</p>
    <div className="rename-preview"><table><caption>Rename preview</caption><thead><tr><th>Current name</th><th>New name</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.id}><td>{item.name}</td><td>{files[index].name}</td></tr>)}</tbody></table></div>
    {failure && <p className="error-banner" role="alert">{failure} You can enable sequence numbers or change the starting number above.</p>}
    {!valid && stem && <p role="alert">Use a valid filename without path separators or reserved characters.</p>}
    <button className="button primary" disabled={busy || !valid}>{busy ? "Renaming…" : "Apply rename"}</button>
  </form>;
}
