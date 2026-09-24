"use client";

import { formatBytes, type StorageUsage } from "@/lib/contracts";

type Usage = StorageUsage & { allScopeBilling?: boolean | number };

// Remaining capacity is meaningful only when this response exposes the whole billing scope.
function storageCapacity(storage: Usage) {
  const totalUsed = storage.pooled ? storage.poolUsed : storage.allScopeBilling === false || storage.allScopeBilling === 0 ? undefined : storage.used;
  const available = totalUsed === undefined ? undefined : Math.max(0, storage.limit - totalUsed);
  return { totalUsed, available };
}

export function StorageNavigationSummary({ storage }: { storage: Usage | null }) {
  if (!storage) return <small>Loading usage...</small>;
  const { totalUsed, available } = storageCapacity(storage);
  return <span className="storage-nav-facts"><span>{formatBytes(totalUsed ?? storage.used)} used{totalUsed === undefined ? " here" : ""}</span><span>{available === undefined ? "Availability unavailable" : `${formatBytes(available)} available`}</span></span>;
}

// Storage is a billing snapshot: reservations and Trash are subsets of usage, not extra charges.
export function StorageSummary({ storage, spaceName, onOpenTrash, onCancelUpload }: { storage: Usage; spaceName: string; onOpenTrash: () => void; onCancelUpload: (id: string, name: string) => void }) {
  const { totalUsed, available } = storageCapacity(storage);
  const percentage = totalUsed === undefined || storage.limit <= 0 ? undefined : Math.min(100, totalUsed / storage.limit * 100);
  const scopeLabel = storage.pooled ? "Personal + shared libraries" : "Library storage";
  return <div className="storage-dashboard">
    <div className="storage-scope">{scopeLabel}</div>
    <dl className="storage-capacity"><div className="storage-available"><dt>Available</dt><dd>{available === undefined ? <span className="storage-unknown">Unavailable</span> : formatBytes(available)}</dd></div><div><dt>Total capacity</dt><dd>{formatBytes(storage.limit)}</dd></div></dl>
    {totalUsed !== undefined ? <><progress className="storage-usage-bar" max={Math.max(1, storage.limit)} value={Math.min(totalUsed, Math.max(1, storage.limit))} aria-label={storage.pooled ? "Combined storage used" : "This library storage used"} /><div className="storage-usage-caption"><span>{formatBytes(totalUsed)} used</span><span>{percentage === undefined ? "" : percentage > 0 && percentage < 0.1 ? "<0.1%" : `${percentage.toFixed(1)}%`}</span></div></> : <p className="storage-access-note">{storage.pooled ? "Combined usage is not available for this account." : "Usage is limited to your accessible files."}</p>}
    <section className="storage-library-facts" aria-label="Current library storage"><div className="storage-section-heading"><h3>This library</h3><span>{spaceName}</span></div><dl><div><dt>Usage <small>Includes previews, Trash and reservations</small></dt><dd>{formatBytes(storage.used)}</dd></div><div><dt>In Trash</dt><dd>{formatBytes(storage.trash || 0)}</dd></div><div><dt>Reserved for uploads</dt><dd>{formatBytes(storage.reserved || 0)}</dd></div></dl><button className="text-button" onClick={onOpenTrash}>Open Trash<span aria-hidden="true"> &rarr;</span></button></section>
    <section className="storage-upload-section" aria-label="Unfinished uploads"><div className="storage-section-heading"><h3>Unfinished uploads</h3><span>{storage.uploads.length}</span></div>{storage.uploads.length ? <ul className="storage-upload-list">{storage.uploads.map(upload => <li key={upload.id}><div><strong>{upload.name}</strong><small>{formatBytes(upload.size)} &middot; {upload.deviceName}</small></div>{Boolean(upload.canCancel) && <button className="text-button danger" onClick={() => onCancelUpload(upload.id, upload.name)}>{upload.publication ? "Cancel publication" : "Cancel upload"}</button>}</li>)}</ul> : <p className="storage-empty">No pending uploads</p>}</section>
  </div>;
}
