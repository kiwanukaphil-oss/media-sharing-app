// Normalize API failures so the feed and transfer queue retain actionable messages.
export async function requestJson<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    ...options,
    headers: { ...(options?.body ? { "Content-Type": "application/json" } : {}), ...options?.headers },
  });
  const body = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(body.error || "Couldn't connect. Please try again.");
  return body as T;
}
