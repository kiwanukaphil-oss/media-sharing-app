// Normalize API failures so the feed and transfer queue retain actionable messages.
export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
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
