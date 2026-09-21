"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, LoaderCircle, X } from "lucide-react";
import { createLibraryApi } from "@/lib/api-client";
import { formatBytes, type Album, type AlbumSection, type MediaItem } from "@/lib/contracts";
import { WorkspaceSelect } from "./workspace-select";

type Destination = { id: string; name: string; kind?: string };
type Publication = { id: string; sourceId: string; sourceRevision: number; destinationSpaceId: string; albumId?: string | null; sectionId?: string | null; phase?: string };

// A publication captures its original and destination; retries retain that intent and its server-side reservation.
export default function PublicationDialog({ item, sourceSpaceId, libraries, onClose }: {
  item: MediaItem; sourceSpaceId: string; libraries: Destination[]; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const sourceApi = useMemo(() => createLibraryApi(sourceSpaceId), [sourceSpaceId]);
  const destinations = libraries.filter(library => library.kind === "shared");
  const [destinationId, setDestinationId] = useState(destinations[0]?.id || "");
  const [albumId, setAlbumId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [sections, setSections] = useState<AlbumSection[]>([]);
  const [intent, setIntent] = useState<Publication | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [destinationLoaded, setDestinationLoaded] = useState(false);
  const [operation, setOperation] = useState<"publishing" | "cancelling" | null>(null);
  const busy = operation !== null;
  const [published, setPublished] = useState(false);
  const [error, setError] = useState("");
  const destinationApi = useMemo(() => createLibraryApi(destinationId), [destinationId]);
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  // Recover both unfinished and completed intent so a lost response does not silently create a duplicate copy.
  useEffect(() => {
    const controller = new AbortController();
    void sourceApi.requestJson<{ publication: Publication | null }>(`publications?sourceId=${item.id}`, { signal: controller.signal }).then(result => {
      if (controller.signal.aborted) return;
      if (result.publication) { setIntent(result.publication); setPublished(result.publication.phase === "ready"); setDestinationId(result.publication.destinationSpaceId); setAlbumId(result.publication.albumId || ""); setSectionId(result.publication.sectionId || ""); }
      setLoaded(true);
    }).catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [item.id, sourceApi]);
  useEffect(() => {
    if (!destinationId) return;
    const controller = new AbortController();
    void destinationApi.requestJson<{ albums: Album[] }>("albums", { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) { setAlbums(result.albums.filter(album => !album.archivedAt && !album.deletedAt)); setDestinationLoaded(true); }
    }).catch(failure => { if (!controller.signal.aborted) { setDestinationLoaded(false); setError(failure.message); } });
    return () => controller.abort();
  }, [destinationId, destinationApi]);
  useEffect(() => {
    if (!albumId) return;
    const controller = new AbortController();
    void destinationApi.requestJson<{ sections: AlbumSection[] }>(`sections?album=${albumId}`, { signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setSections(result.sections); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure.message); });
    return () => controller.abort();
  }, [albumId, destinationApi]);
  useEffect(() => {
    if (!busy) return;
    const warnOnNavigation = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnOnNavigation);
    return () => window.removeEventListener("beforeunload", warnOnNavigation);
  }, [busy]);

  // The affirmative action is the privacy boundary. Network retries reuse the exact same operation identifier.
  async function publishCopy() {
    const captured = intent || { id: crypto.randomUUID(), sourceId: item.id, sourceRevision: item.revision || 0,
      destinationSpaceId: destinationId, albumId: albumId || null, sectionId: sectionId || null };
    setIntent(captured); setOperation("publishing"); setError("");
    try {
      await sourceApi.requestJson("publications", { method: "POST", body: JSON.stringify({ ...captured,
        albumId: captured.albumId || undefined, sectionId: captured.sectionId || undefined, confirmed: true }) });
      setPublished(true);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The copy could not be completed. Retry or cancel it."); }
    finally { setOperation(null); }
  }

  // A server-confirmed cancellation releases the reservation; closing a failed dialog merely leaves it resumable.
  async function cancelCopy() {
    if (!intent) { onClose(); return; }
    setOperation("cancelling"); setError("");
    try { await sourceApi.requestJson(`publications/${intent.id}`, { method: "DELETE" }); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Cancellation failed. Please retry."); }
    finally { setOperation(null); }
  }

  const destinationName = destinations.find(destination => destination.id === destinationId)?.name || "Unavailable library";
  return <dialog ref={dialog} className="modal publication-dialog" aria-labelledby={headingId}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClose={() => { if (!busy) onClose(); }}>
    <div className="modal-heading"><h2 id={headingId}>{published ? "Copy published" : "Publish a shared copy"}</h2><button className="icon-button" disabled={busy} aria-label="Close publication" onClick={onClose}><X size={20} /></button></div>
    <p className="publication-filename">{item.name}</p><p className="small-muted">{formatBytes(item.size)} &middot; Original quality</p>
    {error && <p role="alert" className="error-banner">{error}</p>}
    {published ? <><p className="modal-intro">A verified copy was published to {destinationName}. Your personal original stays in My space. The shared library manages its copy independently.</p><div className="publication-success-actions"><a className="button primary" href={`/?space=${encodeURIComponent(destinationId)}${albumId ? `&album=${encodeURIComponent(albumId)}` : ""}${sectionId ? `&section=${encodeURIComponent(sectionId)}` : ""}`}>Open shared library <ArrowRight size={16} /></a><button className="text-button" onClick={() => { setIntent(null); setPublished(false); setError(""); }}>Publish another copy</button></div></> : <>
      {!destinations.length && <p className="modal-intro">Connect or join a shared library before publishing a copy.</p>}
      {destinations.length > 0 && <div className="publication-destinations"><WorkspaceSelect label="Shared destination" value={destinationId} disabled={busy || Boolean(intent)} options={destinations.map(destination => ({ value: destination.id, label: destination.name }))}
        onChange={id => { setDestinationId(id); setAlbumId(""); setSectionId(""); setAlbums([]); setSections([]); setDestinationLoaded(false); setError(""); }} />
        <WorkspaceSelect label="Destination album" value={albumId} disabled={busy || Boolean(intent) || !destinationLoaded} options={[{ value: "", label: "Unorganised" }, ...albums.map(album => ({ value: album.id, label: album.name }))]}
          onChange={id => { setAlbumId(id); setSectionId(""); setSections([]); }} />
        {albumId && <WorkspaceSelect label="Destination section" value={sectionId} disabled={busy || Boolean(intent)} options={[{ value: "", label: "Unsectioned" }, ...sections.map(section => ({ value: section.id, label: section.name }))]} onChange={setSectionId} />}
      </div>}
      <div className="publication-audience"><strong>Who can see this copy</strong><p>Everyone with access to {destinationName}, including paired devices and people its owners invite later.</p><p>This is an independent original, including any embedded location or other metadata. Deleting it from My space will not remove the shared copy or anyone&apos;s downloads.</p></div>
      {intent && !busy && <p className="small-muted">This publication keeps its original destination. Retry it, or cancel before choosing another.</p>}
      {busy && <p role="status" className="publication-progress"><LoaderCircle size={18} className="spin" /> {operation === "cancelling" ? "Cancelling the copy and releasing its reserved storage." : "Copying and checking the original. Keep this tab open."}</p>}
      <div className="confirmation-actions"><button className="button secondary" disabled={busy} onClick={() => void cancelCopy()}>{intent ? "Cancel publication" : "Cancel"}</button><button className="button primary" disabled={busy || intent?.phase === "cancelling" || !loaded || !destinationLoaded || !destinationId || !destinations.some(destination => destination.id === destinationId)} onClick={() => void publishCopy()}>{busy ? operation === "cancelling" ? "Cancelling…" : "Publishing…" : intent ? "Retry publication" : "Publish copy"}</button></div>
    </>}
  </dialog>;
}
