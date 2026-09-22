"use client";

import { ArrowUpRight, Folder, RefreshCw } from "lucide-react";
import type { Album } from "@/lib/contracts";

// Only current-library, server-authorised albums are supplied. Activity is the newest visible upload or album creation,
// not a promise of personal browsing history; archived albums remain available through Browse filters.
export function LibraryOverview({ albums, interrupted, openAlbum, reviewTransfers }: {
  albums: Album[]; interrupted: number; openAlbum: (id: string) => void; reviewTransfers: () => void;
}) {
  const recent = albums.filter(album => !album.archivedAt && !album.deletedAt)
    .sort((left,right) => (right.latestUploadAt ?? right.createdAt) - (left.latestUploadAt ?? left.createdAt) || left.id.localeCompare(right.id)).slice(0,3);
  if (!recent.length && !interrupted) return null;
  return <section className="library-overview" aria-label="Current library overview">
    {interrupted > 0 && <button className="interrupted-shortcut" onClick={reviewTransfers}><RefreshCw size={17} /><span>{interrupted} interrupted {interrupted === 1 ? "transfer" : "transfers"}<small>Review and resume in this library</small></span><ArrowUpRight size={17} /></button>}
    {recent.length > 0 && <><h2>Recent albums</h2><div className="recent-albums">{recent.map(album => <button key={album.id} className="recent-album" aria-label={`Open recent album ${album.name}`} onClick={() => openAlbum(album.id)}><Folder size={20} strokeWidth={1.5} /><span><strong>{album.name}</strong><small>{album.count} {album.count === 1 ? "file" : "files"}</small></span><ArrowUpRight size={15} /></button>)}</div></>}
  </section>;
}
