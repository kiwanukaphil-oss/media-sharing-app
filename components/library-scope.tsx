"use client";

import { createContext, useContext, useMemo } from "react";
import { LibraryMemoryContext } from "./library-memory";
import { RequestError, createLibraryApi } from "@/lib/api-client";

export const LibraryScope = createContext<string | undefined>(undefined);

// Scope belongs to this mounted library, never a global variable shared by tabs or transfers.
export function useLibraryApi() {
  const accountSpaceId = useContext(LibraryScope);
  const memory = useContext(LibraryMemoryContext);
  const api = useMemo(() => {
    const scoped = createLibraryApi(accountSpaceId);
    return { ...scoped, requestJson: async <T,>(path: string, options?: RequestInit): Promise<T> => {
      try {
        const result = await scoped.requestJson<T>(path, options);
        if (options?.method && !["GET", "HEAD"].includes(options.method.toUpperCase())) memory?.invalidate("lists");
        return result;
      } catch (error) {
        if (error instanceof RequestError && [401, 403].includes(error.status)) memory?.invalidate("access");
        throw error;
      }
    } };
  }, [accountSpaceId, memory]);
  return { ...api, accountSpaceId };
}
