"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Info, Share2, X, ZoomIn, ZoomOut } from "lucide-react";
import { formatBytes, type MediaItem } from "@/lib/contracts";

type Props = {
  item: MediaItem;
  items: MediaItem[];
  saving: boolean;
  onNavigate: (item: MediaItem) => void;
  onClose: () => void;
  onSave: () => void;
  onPublish?: () => void;
  preview: ReactNode;
  thumbnail: (item: MediaItem) => ReactNode;
  children: ReactNode;
};

// Keep the original-file actions intact while giving images and videos a dedicated viewing surface.
export function MediaViewer({ item, items, saving, onNavigate, onClose, onSave, onPublish, preview, thumbnail, children }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const detailsId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoomed = zoomedId === item.id;
  const canZoom = /^image\/(jpeg|png|webp|gif|avif)$/.test(item.mime);
  const index = items.findIndex(candidate => candidate.id === item.id);
  const sequence = index < 0 ? [item] : items;
  const position = index < 0 ? 0 : index;

  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    stage.current?.scrollTo(0, 0);
    dialog.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [item.id]);

  function navigateBy(offset: number) {
    const next = sequence[position + offset];
    if (next) { setZoomedId(null); onNavigate(next); }
  }

  return <dialog ref={dialog} className="media-viewer" aria-labelledby={titleId} onClose={onClose} onKeyDown={event => {
    // Player and form controls retain their native keyboard behaviour.
    if ((event.target as HTMLElement).closest("video, input, select, textarea")) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); navigateBy(event.key === "ArrowLeft" ? -1 : 1); }
  }}>
    <div className="viewer-shell">
      <header className="viewer-header">
        <button autoFocus className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={21} /></button>
        <div className="viewer-file"><h2 id={titleId}>{item.name}</h2><p>{item.category === "final" ? "Final cut" : "Original"} · {formatBytes(item.size)} · {item.deviceName}</p></div>
        <div className="viewer-controls">
          {onPublish && <button className="icon-button" aria-label="Publish shared copy" title="Publish shared copy" onClick={onPublish}><Share2 size={20} /></button>}
          {canZoom && <button className="icon-button" aria-label={zoomed ? "Zoom out" : "Zoom in"} aria-pressed={zoomed} onClick={() => setZoomedId(zoomed ? null : item.id)}>{zoomed ? <ZoomOut size={20} /> : <ZoomIn size={20} />}</button>}
          <button className="icon-button" aria-label="File details" aria-expanded={detailsOpen} aria-controls={detailsId} onClick={() => setDetailsOpen(!detailsOpen)}><Info size={20} /></button>
          <button className="button viewer-save" aria-label="Save original to device" disabled={saving} onClick={onSave}><ArrowDownToLine size={18} /><span>{saving ? "Saving original…" : "Save original to device"}</span></button>
        </div>
      </header>
      <div className="viewer-body">
        <div className="viewer-canvas">
          <button className="icon-button viewer-previous" aria-label="Previous file" disabled={position === 0} onClick={() => navigateBy(-1)}><ArrowLeft size={21} /></button>
          <div ref={stage} className={`viewer-stage${zoomed ? " is-zoomed" : ""}`} tabIndex={zoomed ? 0 : undefined} aria-label={zoomed ? "Zoomed image; scroll to explore" : undefined}>{preview}</div>
          <button className="icon-button viewer-next" aria-label="Next file" disabled={position === sequence.length - 1} onClick={() => navigateBy(1)}><ArrowRight size={21} /></button>
        </div>
        <aside id={detailsId} className="viewer-details" hidden={!detailsOpen}><h3>File details</h3>{children}</aside>
      </div>
      <footer className="viewer-footer">
        <span className="viewer-position" role="status">{position + 1} of {sequence.length} loaded files</span>
        <div className="viewer-filmstrip" aria-label="Browse loaded files">{sequence.map(candidate => <button key={candidate.id} aria-label={`View ${candidate.name}`} aria-current={candidate.id === item.id ? "true" : undefined} onClick={() => { setZoomedId(null); onNavigate(candidate); }}>{thumbnail(candidate)}</button>)}</div>
        <span className="viewer-keyboard-hint">← → to browse <span>Esc to close</span></span>
      </footer>
    </div>
  </dialog>;
}
