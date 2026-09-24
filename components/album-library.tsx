"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Folder, Grid2X2, Inbox, List, Palette, Pin, Plus, Search, X } from "lucide-react";
import type { Album, AlbumSection } from "@/lib/contracts";
import { WorkspaceSelect } from "./workspace-select";
import { useLibraryApi } from "./library-scope";

const coverColours = [
  { name: "Clay", background: "#b9654c", ink: "#fff0d9", shape: "#d78e69" },
  { name: "Olive", background: "#d4d8b9", ink: "#414d38", shape: "#b2bd91" },
  { name: "Blue", background: "#b8cbd1", ink: "#354b58", shape: "#8bafb9" },
  { name: "Sand", background: "#e3d4b4", ink: "#665535", shape: "#c6b185" },
  { name: "Plum", background: "#c7bdce", ink: "#504158", shape: "#a190ae" },
  { name: "Forest", background: "#637b6c", ink: "#f0efd9", shape: "#91a48b" },
];
type Appearance = Record<string, { colour?: number; pinned?: boolean }>;
type Props = {
  albums: Album[]; sections: AlbumSection[]; spaceName: string; canOrganise: boolean;
  appearance: Appearance; onAppearance: (id: string, patch: Appearance[string]) => void;
  onOpen: (id: string) => void; onCreated: (id: string, message: string) => Promise<void>;
  onUnorganised: () => void; failure: string; retry: () => void;
};

// Only IDs and display preferences are cached, scoped to the current authorised space and actor.
export function useAlbumAppearance(storageKey: string) {
  const [stored, setStored] = useState<{ key: string; value: Appearance }>({ key: "", value: {} });
  const appearance = stored.key === storageKey ? stored.value : {};
  useEffect(() => {
    let value: Appearance = {};
    try {
      const candidate: unknown = JSON.parse(localStorage.getItem(storageKey) || "{}");
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        for (const [id, entry] of Object.entries(candidate).slice(0, 2000)) {
          if (!entry || typeof entry !== "object") continue;
          value[id] = { pinned: entry.pinned === true, colour: Number.isInteger(entry.colour) && entry.colour >= 0 && entry.colour < coverColours.length ? entry.colour : undefined };
        }
      }
    } catch { value = {}; }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read optional browser preferences after hydration.
    setStored({ key: storageKey, value });
  }, [storageKey]);
  function updateAppearance(id: string, patch: Appearance[string]) {
    setStored(current => {
      const value = { ...(current.key === storageKey ? current.value : {}), [id]: { ...(current.key === storageKey ? current.value[id] : {}), ...patch } };
      try { localStorage.setItem(storageKey, JSON.stringify(value)); } catch { /* Storage restrictions keep preferences usable for this visit. */ }
      return { key: storageKey, value };
    });
  }
  return { appearance, updateAppearance };
}

// Abstract covers deliberately never request media thumbnails, including existing album covers.
export function AlbumCover({ album, colour, compact = false }: { album: Pick<Album, "id" | "createdAt" | "name">; colour?: number; compact?: boolean }) {
  const index = colour ?? [...album.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % coverColours.length;
  const palette = coverColours[index];
  return <div className={`collection-cover cover-art-${index}${compact ? " compact-cover" : ""}`} style={{ "--cover": palette.background, "--cover-ink": palette.ink, "--cover-shape": palette.shape } as CSSProperties} aria-hidden="true">
    <span className="cover-kicker">RELAY COLLECTION</span><span className="cover-illustration" />
    <strong className="cover-name">{album.name}</strong><span className="cover-created">Created {new Date(album.createdAt).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}</span>
  </div>;
}

// The default surface contains album metadata only; all file views require deliberate navigation.
export function AlbumLibrary(props: Props) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("active");
  const [sort, setSort] = useState("recent");
  const [view, setView] = useState("grid");
  const [creating, setCreating] = useState(false);
  const [editingCover, setEditingCover] = useState<Album | null>(null);
  const active = props.albums.filter(album => !album.archivedAt && !album.deletedAt);
  const filtered = props.albums.filter(album => !album.deletedAt && (tab === "archived" ? !!album.archivedAt : !album.archivedAt) && (tab !== "pinned" || props.appearance[album.id]?.pinned) && `${album.name} ${album.description}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  filtered.sort((left, right) => sort === "name" ? left.name.localeCompare(right.name) : (right.latestUploadAt ?? right.createdAt) - (left.latestUploadAt ?? left.createdAt) || left.id.localeCompare(right.id));
  return <section className="album-library" aria-label="Album library">
    <div className="collection-heading"><div><p className="collection-eyebrow">YOUR LIFE, WELL COLLECTED</p><h1>A home for <em>every story.</em></h1><p>Choose an album. Pick up where you left off.</p></div>{props.canOrganise && <button className="button primary" onClick={() => setCreating(true)}><Plus size={17} />New album<ArrowUpRight size={16} /></button>}</div>
    <div className="collection-toolbar"><div className="collection-tabs" aria-label="Album collections">{[["active", "All albums", active.length], ["pinned", "Pinned", active.filter(album => props.appearance[album.id]?.pinned).length], ["archived", "Archived", props.albums.filter(album => album.archivedAt).length]].map(([value, label, count]) => <button key={value} aria-pressed={tab === value} onClick={() => setTab(String(value))}>{label}<span>{count}</span></button>)}</div><div className="collection-controls"><label className="search-field"><Search size={16} aria-hidden="true" /><input type="search" aria-label="Search albums" placeholder="Find an album…" value={search} onChange={event => setSearch(event.target.value)} /></label><WorkspaceSelect label="Sort albums" value={sort} onChange={setSort} options={[{ value: "recent", label: "Last activity" }, { value: "name", label: "Name A-Z" }]} /><div className="view-toggle" role="group" aria-label="Album view"><button aria-label="Album grid view" aria-pressed={view === "grid"} onClick={() => setView("grid")}><Grid2X2 size={16} /></button><button aria-label="Album list view" aria-pressed={view === "list"} onClick={() => setView("list")}><List size={17} /></button></div></div></div>
    {props.failure ? <div className="error-banner" role="alert"><span>Couldn&apos;t refresh albums. {props.failure}</span><button className="button secondary" onClick={props.retry}>Retry albums</button></div> : <>
    <div className="collection-result"><span role="status">{filtered.length} {filtered.length === 1 ? "album" : "albums"}{search ? " found" : " in your collection"}</span><span>Pins and cover colours are saved on this browser.</span></div>
    {filtered.length ? <div className={`collection-grid${view === "list" ? " collection-list" : ""}`}>{filtered.map(album => {
      const sectionCount = props.sections.filter(section => section.albumId === album.id).length;
      return <article className="collection-card" key={album.id}><button className="collection-open" aria-label={`Open album ${album.name}`} onClick={() => props.onOpen(album.id)}><AlbumCover album={album} colour={props.appearance[album.id]?.colour} /><h2><Folder size={17} /><span>{album.name}</span></h2><p>{album.count} {album.count === 1 ? "file" : "files"}<span>·</span>{sectionCount} {sectionCount === 1 ? "section" : "sections"}<span>·</span>{new Date(album.latestUploadAt ?? album.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p></button><div className="collection-card-actions"><button className="collection-edit" aria-label={`Edit cover for ${album.name}`} onClick={() => setEditingCover(album)}><Palette size={14} /><span>Edit cover</span></button><button className="collection-pin" aria-label={`${props.appearance[album.id]?.pinned ? "Unpin" : "Pin"} ${album.name}`} aria-pressed={!!props.appearance[album.id]?.pinned} onClick={() => props.onAppearance(album.id, { pinned: !props.appearance[album.id]?.pinned })}><Pin size={15} /></button></div></article>;
    })}{props.canOrganise && tab === "active" && !search && <button className="collection-new" onClick={() => setCreating(true)}><span><Plus size={23} /></span><strong>A new collection</strong><small>Make room for what&apos;s next</small></button>}</div> : <div className="collection-empty"><Folder size={34} /><h2>{search ? "No matching albums." : tab === "pinned" ? "Keep your favourites close." : tab === "archived" ? "No archived albums." : "Your first chapter starts here."}</h2><p>{search ? "Try a different name or clear your search." : tab === "pinned" ? "Pin an album to find it here." : tab === "archived" ? "Archived collections stay available here with their files." : props.canOrganise ? "Create an album, then add the photos and videos that belong together." : "Albums created by an owner or editor will appear here. Existing files remain in Unorganised or Browse files."}</p>{search ? <button className="button secondary" onClick={() => setSearch("")}>Clear album search</button> : tab === "active" && props.canOrganise ? <button className="button primary" onClick={() => setCreating(true)}><Plus size={17} />Create your first album</button> : null}</div>}
    </>}
    <div className="collection-inbox"><Inbox size={24} /><div><strong>Everything deserves a home.</strong><p>Find photos and videos that haven&apos;t been added to an album.</p></div><button className="text-button" onClick={props.onUnorganised}>Organise files<ArrowUpRight size={16} /></button></div>
    {editingCover && <EditAlbumCoverDialog album={editingCover} colour={props.appearance[editingCover.id]?.colour} onClose={() => setEditingCover(null)} onSave={colour => { props.onAppearance(editingCover.id, { colour }); setEditingCover(null); }} />}
    {creating && <CreateAlbumDialog spaceName={props.spaceName} onClose={() => setCreating(false)} onCreated={props.onCreated} onAppearance={props.onAppearance} />}
  </section>;
}

// Album creation is durable before optional sections; partial template failures never duplicate an album.
function CreateAlbumDialog({ spaceName, onClose, onCreated, onAppearance }: Pick<Props, "spaceName" | "onCreated" | "onAppearance"> & { onClose: () => void }) {
  const { requestJson } = useLibraryApi();
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [colour, setColour] = useState(0);
  const [template, setTemplate] = useState("blank");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  async function createCollection(event: React.FormEvent) {
    // A successful album stays navigable even if refreshing or creating a later section fails.
    event.preventDefault(); if (!name.trim() || busy) return;
    setBusy(true); setFailure("");
    let albumId: string | undefined;
    let message = "Album created. Add photos and videos when you’re ready.";
    try {
      const result = await requestJson<{ id: string }>("albums", { method: "POST", body: JSON.stringify({ name: name.trim(), description: description.trim() }) });
      albumId = result.id; onAppearance(albumId, { colour });
      const names = template === "story" ? ["Moments", "Details", "Films"] : template === "project" ? ["Sources", "Shortlist", "Finals"] : [];
      let revision = 0;
      for (const [position, sectionName] of names.entries()) {
        const section = await requestJson<{ revision: number }>("sections", { method: "POST", body: JSON.stringify({ albumId, name: sectionName, position, expectedRevision: revision }) });
        revision = section.revision;
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Please try again.";
      if (!albumId) { setFailure(reason); setBusy(false); return; }
      message = `Album created, but some template sections could not be added. ${reason} Use New section inside the album to finish.`;
    }
    try { await onCreated(albumId!, message); onClose(); }
    catch { setFailure("Album created. Refresh Albums to open it; do not create it again."); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} className="modal collection-dialog" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}><div className="modal-heading"><span className="collection-eyebrow">MAKE ROOM FOR SOMETHING</span><button className="icon-button" aria-label="Close new album" disabled={busy} onClick={onClose}><X size={20} /></button></div><h2 id={headingId}>Start a new album.</h2><p>A trip, a project, an ordinary Tuesday. Give it a home.</p><div className="collection-destination"><Folder size={18} />New album in <strong>{spaceName}</strong></div><form className="library-form" onSubmit={event => void createCollection(event)}><label>Album name<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. A weekend away" disabled={busy} /></label><label>Description <span className="collection-optional">Optional</span><textarea maxLength={1000} value={description} onChange={event => setDescription(event.target.value)} placeholder="A little context for this collection" disabled={busy} /></label><fieldset className="cover-options" disabled={busy}><legend>Cover colour <span>On this browser</span></legend>{coverColours.map((palette, index) => <label key={palette.name} style={{ "--swatch": palette.background } as CSSProperties}><input type="radio" name="cover-colour" aria-label={palette.name} checked={colour === index} onChange={() => setColour(index)} /><span /></label>)}</fieldset><div className="collection-template"><span>Start with</span><WorkspaceSelect label="Album template" value={template} onChange={setTemplate} disabled={busy} options={[{ value: "blank", label: "An empty album" }, { value: "story", label: "Story: Moments, Details, Films" }, { value: "project", label: "Project: Sources, Shortlist, Finals" }]} /></div><p className="small-muted">Albums and sections organise files within this space. They do not change who can access them.</p>{failure && <p className="error-banner" role="alert">{failure}</p>}<div className="collection-dialog-actions"><button type="button" className="button secondary" onClick={onClose} disabled={busy}>Cancel</button><button className="button primary" disabled={busy || !name.trim()}>{busy ? "Creating…" : "Create album"}<ArrowUpRight size={16} /></button></div></form></dialog>;
}

// Preview colour changes locally and save only on confirmation; cancellation leaves the cover intact.
function EditAlbumCoverDialog({ album, colour, onClose, onSave }: { album: Album; colour?: number; onClose: () => void; onSave: (colour: number) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [selectedColour, setSelectedColour] = useState(colour ?? [...album.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % coverColours.length);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return <dialog ref={dialog} className="modal collection-dialog cover-editor" aria-labelledby={headingId} onCancel={event => { event.preventDefault(); onClose(); }}>
    <div className="modal-heading"><span className="collection-eyebrow">MAKE IT YOURS</span><button className="icon-button" aria-label="Close cover editor" onClick={onClose}><X size={20} /></button></div>
    <h2 id={headingId}>Edit album cover</h2><p>Choose a colour for {album.name}. Saved on this browser.</p>
    <AlbumCover album={album} colour={selectedColour} />
    <fieldset className="cover-options"><legend>Cover colour</legend>{coverColours.map((palette, index) => <label key={palette.name} style={{ "--swatch": palette.background } as CSSProperties}><input type="radio" name="edit-cover-colour" aria-label={palette.name} checked={selectedColour === index} onChange={() => setSelectedColour(index)} /><span /></label>)}</fieldset>
    <div className="collection-dialog-actions"><button className="button secondary" onClick={onClose}>Cancel</button><button className="button primary" onClick={() => onSave(selectedColour)}>Save cover</button></div>
  </dialog>;
}
