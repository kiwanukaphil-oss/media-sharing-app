// Normalize API failures so the feed and transfer queue retain actionable messages.
export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export function libraryPath(path: string, accountSpaceId?: string) {
  return accountSpaceId === undefined ? path : `${path}${path.includes("?") ? "&" : "?"}space=${encodeURIComponent(accountSpaceId)}`;
}

export function createLibraryApi(accountSpaceId?: string) {
  return {
    requestJson: <T>(path: string, options?: RequestInit) => requestJson<T>(libraryPath(path, accountSpaceId), options),
    apiUrl: (path: string) => `/api/${libraryPath(path, accountSpaceId)}`,
  };
}
export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new RequestError(body.error || "Couldn't connect. Please try again.", response.status);
  return body as T;
}
