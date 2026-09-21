"use client";

import { createContext, useContext, useMemo } from "react";
import { createLibraryApi } from "@/lib/api-client";

export const LibraryScope = createContext<string | undefined>(undefined);

// Scope belongs to this mounted library, never a global variable shared by tabs or transfers.
export function useLibraryApi() {
  const accountSpaceId = useContext(LibraryScope);
  const api = useMemo(() => createLibraryApi(accountSpaceId), [accountSpaceId]);
  return { ...api, accountSpaceId };
}
