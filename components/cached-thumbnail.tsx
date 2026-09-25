"use client";
/* eslint-disable @next/next/no-img-element -- Private workspace-scoped blob URLs are not public optimizer inputs. */
import { useEffect, useRef, useState } from "react";
import { useLibraryMemory } from "./library-memory";

// Fetch only near the viewport; remounts reuse a stable blob URL instead of downloading the image again.
export function CachedThumbnail({ src, onFailure, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; onFailure?: (failed: boolean) => void }) {
  const memory = useLibraryMemory();
  const image = useRef<HTMLImageElement>(null);
  const [resolved, setResolved] = useState<{ source: string; url: string } | null>(() => {
    const cached = memory?.thumbnail(src); return cached ? { source: src, url: cached } : null;
  });
  
  useEffect(() => {
    if (!memory) return;
    let active = true;
    const element = image.current;
    const load = () => { void memory.loadThumbnail(src).then(url => { if (active) setResolved({ source: src, url }); }).catch(error => { if (active && error?.name !== "AbortError") onFailure?.(true); }); };
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); } }, { rootMargin: "240px" });
    if (element) observer.observe(element);
    return () => { active = false; observer.disconnect(); };
  }, [memory, src, onFailure]);
  const cached = resolved?.source === src ? resolved.url : undefined;
  return <img {...props} alt={props.alt ?? ""} ref={image} src={memory ? cached || "data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2732%27 height=%2732%27/%3E" : src} />;
}
