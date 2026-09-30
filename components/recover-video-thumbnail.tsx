"use client";
/* eslint-disable @next/next/no-img-element -- Generated private video posters use short-lived local blob URLs. */
import { useEffect, useRef, useState } from "react";
import { FileVideo, LoaderCircle } from "lucide-react";
import { createVideoPoster } from "@/lib/previews";
import type { MediaItem } from "@/lib/contracts";
import { useLibraryApi } from "./library-scope";
import { useLibraryMemory } from "./library-memory";

let posterQueue: Promise<unknown> = Promise.resolve();

// Recover missing posters lazily, one decoder at a time, without downloading originals into JS memory.
export function RecoverVideoThumbnail({ item, canSave }: { item: MediaItem; canSave: boolean }) {
  const { apiUrl } = useLibraryApi();
  const memory = useLibraryMemory();
  const container = useRef<HTMLSpanElement>(null);
  const [poster, setPoster] = useState<string>();
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    const stop = () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
    const unsubscribe = memory?.subscribe(reason => { if (reason === "access") { stop(); setPoster(undefined); setBusy(false); } });
    window.addEventListener("pagehide", stop);
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      posterQueue = posterQueue.catch(() => {}).then(async () => {
        if (controller.signal.aborted) return;
        const timeout = setTimeout(() => controller.abort(), 20000);
        try {
          const blob = await createVideoPoster(apiUrl(`media/${item.id}/preview`), controller.signal);
          if (!blob || blob.size > 250000 || controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob); setPoster(objectUrl);
          // Only existing file editors persist the recovered JPEG; server authority remains decisive.
          if (canSave) {
            const saved = await fetch(apiUrl(`media/${item.id}/thumbnail`), { method: "PUT", signal: controller.signal, headers: { "Content-Type": "image/jpeg" }, body: blob });
            if (saved.ok && (await saved.json() as { ready?: boolean }).ready) memory?.invalidate("lists");
          }
        } catch { /* Unsupported codecs keep an honest fallback without affecting the original. */ }
        finally { clearTimeout(timeout); setBusy(false); }
      });
    }, { rootMargin: "100px" });
    if (container.current) observer.observe(container.current);
    return () => { observer.disconnect(); unsubscribe?.(); window.removeEventListener("pagehide", stop); stop(); };
  }, [apiUrl, item.id, canSave, memory]);
  return <span ref={container} className={poster ? "preview-image-frame is-loaded" : "file-preview video-preview"}>
    {poster ? <img src={poster} alt={item.name} className="media-image" /> : <><FileVideo size={38} strokeWidth={1.2} /><span>{item.name.split(".").pop()?.toUpperCase() || "VIDEO"}</span><small>{busy ? <><LoaderCircle size={14} className="spin" /> Creating thumbnail...</> : "Thumbnail unavailable. Open video to play."}</small></>}
  </span>;
}
