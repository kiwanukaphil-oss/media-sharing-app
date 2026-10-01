// Normalize API failures so the feed and transfer queue retain actionable messages.
export class RequestError extends Error {
  constructor(message: string, public status: number, public retryAfterMs = 0) { super(message); }
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
// Preserve server retry timing and finish local source cleanup before leaving a signed-out session.
export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) {
    const retry = response.headers.get("Retry-After");
    const retryAfterMs = retry ? Math.max(0, /^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
    throw new RequestError(body.error || "Couldn't connect. Please try again.", response.status, Number.isFinite(retryAfterMs) ? retryAfterMs : 0);
  }
  if (typeof window !== "undefined" && path.startsWith("auth/") && ("providerLogoutUrl" in body || "signedOut" in body)) {
    const { uploadManager } = await import("./upload-manager");
    await uploadManager.signOut();
  }
  return body as T;
}
