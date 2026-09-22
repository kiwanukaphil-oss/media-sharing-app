"use client";

import { useEffect, useId, useRef, useState } from "react";
import { History, RefreshCw, X } from "lucide-react";
import { useLibraryApi } from "./library-scope";

type Event = { id: string; action: string; affectedCount: number; createdAt: number; actor: string; changedSince: number };
type ActivityPage = { events: Event[]; next: string | null };
const labels: Record<string, string> = {
  "album.create": "Created an album", "album.update": "Updated an album", "album.archive": "Archived an album",
  "album.remove": "Removed an album", "section.update": "Updated a section", "section.order": "Reordered sections",
  "section.template": "Applied a section template", "file.rename": "Renamed files", "file.date": "Corrected a capture date",
  "file.add": "Added files to an album", "file.remove": "Removed files from an album", "file.trash": "Moved files to Trash",
  "file.restore": "Restored files", "file.section": "Moved files between sections", "file.arrive": "Added an original",
  "file.delete": "Permanently deleted a file",
};

// Scope is inherited from the mounted library. Poll only visible tabs, keep notifications generic,
// and clear displayed history after access failure. Read state lasts only for this mounted view.
export function LibraryActivity() {
  const { requestJson } = useLibraryApi();
  const [open, setOpen] = useState(false), [unread, setUnread] = useState(false);
  const [page, setPage] = useState<ActivityPage>({ events: [], next: null });
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const latest = useRef<string | null | undefined>(undefined), dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    let active = true;
    async function checkRecentActivity() {
      if (document.visibilityState !== "visible") return;
      try {
        const recent = await requestJson<ActivityPage>("activity");
        if (!active) return;
        const id = recent.events[0]?.id || null;
        if (latest.current !== undefined && latest.current !== id) setUnread(true);
        latest.current = id;
      } catch { if (active) { setUnread(false); setPage({ events: [], next: null }); setError("Activity is unavailable. Refresh to check your access."); } }
    }
    void checkRecentActivity();
    const timer = window.setInterval(() => void checkRecentActivity(), 60000);
    return () => { active = false; window.clearInterval(timer); };
  }, [requestJson]);
  useEffect(() => { if (open) dialog.current?.showModal(); }, [open]);

  // Replace or append a bounded page only after a successful response. Failed refreshes clear stale
  // content rather than implying the person still has permission to browse cached history.
  async function loadActivity(before?: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await requestJson<ActivityPage>(`activity${before ? `?before=${encodeURIComponent(before)}` : ""}`);
      setPage(previous => ({ events: before ? [...previous.events, ...result.events] : result.events, next: result.next }));
      if (!before) { latest.current = result.events[0]?.id || null; setUnread(false); }
    } catch (failure) { setPage({ events: [], next: null }); setError(failure instanceof Error ? failure.message : "Activity could not be loaded."); }
    finally { setBusy(false); }
  }
  return <>
    <button className="icon-button activity-open" aria-label={unread ? "Library activity, new updates" : "Library activity"} title="Library activity" onClick={() => { setOpen(true); void loadActivity(); }}>
      <History size={18} />{unread && <span className="activity-unread" />}
    </button>
    <span className="sr-only" role="status">{unread ? "New library activity is available." : ""}</span>
    {open && <dialog ref={dialog} className="modal activity-modal" aria-labelledby={titleId} onClose={() => setOpen(false)}>
      <div className="modal-heading"><div><p className="eyebrow">THIS LIBRARY</p><h2 id={titleId}>Activity</h2></div><button className="icon-button" aria-label="Close activity" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p className="small-muted">Changes recorded since activity was enabled. Personal favourites stay private.</p>
      <button className="button secondary compact" disabled={busy} onClick={() => void loadActivity()}><RefreshCw size={15} />Refresh</button>
      {error && <p role="alert" className="error-banner">{error}</p>}
      {!page.events.length && !error && <p className="activity-empty">{busy ? "Loading activity…" : "No recorded changes yet."}</p>}
      <ol className="activity-list">{page.events.map(event => <li key={event.id}>
        <div className="activity-event-title"><strong>{labels[event.action] || "Updated the library"}</strong><time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</time></div>
        <p>{event.actor}{event.affectedCount > 1 ? ` · ${event.affectedCount} items` : ""}</p>
        <small>{event.action === "file.delete" ? "Permanent · Cannot be undone" : event.changedSince ? "Changed since · Review the current state before editing" : event.action === "file.arrive" ? "Original available · No download receipt implied" : "Reversible organisation · Use current library controls"}</small>
      </li>)}</ol>
      {page.next && <button className="button secondary" disabled={busy} onClick={() => void loadActivity(page.next!)}>{busy ? "Loading…" : "Earlier activity"}</button>}
    </dialog>}
  </>;
}
