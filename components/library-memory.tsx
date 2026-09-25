"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { LibraryMemory } from "@/lib/library-memory";

export const LibraryMemoryContext = createContext<LibraryMemory | null>(null);

// Changing workspace remounts this provider; page exit also releases private blobs and pending reads.
export function LibraryMemoryProvider({ children }: { children: React.ReactNode }) {
  const [memory] = useState(() => new LibraryMemory());
  useEffect(() => {
    const clear = () => memory.invalidate("access");
    window.addEventListener("pagehide", clear);
    return () => { window.removeEventListener("pagehide", clear); clear(); };
  }, [memory]);
  return <LibraryMemoryContext.Provider value={memory}>{children}</LibraryMemoryContext.Provider>;
}
export function useLibraryMemory() { return useContext(LibraryMemoryContext); }
