"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Bookmark, Plus, X } from "lucide-react";
import { libraryViewStateSchema, readSavedLibraryViews, type LibraryViewState, type SavedLibraryView } from "@/lib/saved-library-views";

// The parent keys this component by verified library/actor identity. Views live only in this tab's
// storage, contain filters rather than cached results, and never supply space or permission parameters.
export function SavedLibraryViews({ storageKey, current, apply }: {
  storageKey: string; current: unknown; apply: (view: LibraryViewState) => void;
}) {
  const [views,setViews] = useState<SavedLibraryView[]>([]);
  const [open,setOpen] = useState(false);
  const [name,setName] = useState("");
  const [failure,setFailure] = useState("");
  const [ready,setReady] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Read scoped browser preferences after hydration.
      setViews(readSavedLibraryViews(sessionStorage.getItem(storageKey)));
    } catch { setFailure("Tab storage is unavailable. Views cannot be saved here."); }
    setReady(true);
  }, [storageKey]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    const opener = trigger.current;
    element?.showModal();
    return () => { element?.close(); opener?.focus(); };
  }, [open]);
  function storeViews(next: SavedLibraryView[]) {
    try { sessionStorage.setItem(storageKey,JSON.stringify(next)); setViews(next); setFailure(""); return true; }
    catch { setFailure("Couldn't save this change. Allow tab storage and try again."); return false; }
  }
  // Validate the complete filter state and write storage before reporting success; denied storage
  // cannot produce an apparently saved view that disappears after reload.
  function saveCurrentView(event: React.FormEvent) {
    event.preventDefault();
    if (!name.trim() || views.length >= 8) return;
    const parsed = libraryViewStateSchema.safeParse(current);
    if (!parsed.success) { setFailure("Choose valid filters before saving this view."); return; }
    if (views.some(view => view.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) {
      setFailure("A view already uses this name. Choose another name."); return;
    }
    if (storeViews([...views,{id:crypto.randomUUID(),name:name.trim(),view:parsed.data}])) setName("");
  }
  return <><button ref={trigger} className="icon-button saved-views-trigger" aria-label="Saved views" title="Saved views" disabled={!ready} onClick={() => setOpen(true)}><Bookmark size={17} /></button>
    {open && <dialog ref={dialog} className="modal saved-views-dialog" aria-labelledby={titleId} onCancel={event => { event.preventDefault(); setOpen(false); }} onClose={() => setOpen(false)}>
      <div className="modal-heading"><h2 id={titleId}>Saved views</h2><button className="icon-button" aria-label="Close saved views" onClick={() => setOpen(false)}><X size={19} /></button></div>
      <p className="small-muted">Filters for this library, saved in this tab until you close it. Files and access stay unchanged.</p>
      {failure && <p role="alert" className="error-banner">{failure}</p>}
      <ul className="saved-view-list">{views.map(view => <li key={view.id}><button className="saved-view-open" onClick={() => { apply(view.view); setOpen(false); }}><Bookmark size={16} /><span>{view.name}</span></button><button className="icon-button" aria-label={`Remove saved view ${view.name}`} onClick={() => storeViews(views.filter(item => item.id !== view.id))}><X size={16} /></button></li>)}</ul>
      {!views.length && <p className="small-muted saved-view-empty">Keep a useful search or filter combination close at hand.</p>}
      <form onSubmit={saveCurrentView} className="saved-view-form"><label htmlFor={`${titleId}-name`}>Save the current view</label><div><input id={`${titleId}-name`} value={name} maxLength={60} placeholder="e.g. My videos this month" onChange={event => setName(event.target.value)} /><button className="button primary compact" type="submit" disabled={!name.trim() || views.length >= 8}><Plus size={16} />Save</button></div><p className="small-muted">{views.length}/8 views in this library</p></form>
    </dialog>}
  </>;
}
