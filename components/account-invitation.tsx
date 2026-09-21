"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api-client";

const storageKey = "relay-pending-person-invitation";
type Preview = { spaceName: string; email: string; expiresAt: number };

// Fragment tokens never enter server URLs. Keep one pending link in this tab through hosted sign-in.
// Reading the preview grants no access; only explicit acceptance creates a membership.
export default function AccountInvitation({ sessionId }: { sessionId?: string }) {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const fragment = /^#invite=([a-f0-9]{64})$/.exec(window.location.hash)?.[1];
    try {
      if (fragment) {
        sessionStorage.setItem(storageKey, fragment);
        history.replaceState(null, "", window.location.pathname + window.location.search);
      }
      const pending = sessionStorage.getItem(storageKey) || "";
      if (!/^[a-f0-9]{64}$/.test(pending)) return;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Hydrate external tab storage after SSR; it is unavailable during rendering.
      setToken(pending); setPreview(null); setError("");
      if (sessionId) void requestJson<Preview>("auth/invitation-preview", { method: "POST", headers: { "X-Relay-Invitation": pending }, signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setPreview(result); })
        .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "This invitation could not be reviewed."); });
    } catch { setError("This browser cannot preserve the invitation during sign-in. Sign in first, then reopen your invitation link."); }
    return () => controller.abort();
  }, [sessionId]);

  // Discard the token only on confirmed acceptance; network errors can be retried without silent joining.
  async function acceptInvitation() {
    setBusy(true); setError("");
    try {
      const result = await requestJson<{ spaceId: string }>("auth/invitation-accept", { method: "POST", headers: { "X-Relay-Invitation": token } });
      sessionStorage.removeItem(storageKey);
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Open the explicitly accepted library with fresh state.
      window.location.assign(`/?space=${encodeURIComponent(result.spaceId)}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The library could not be joined."); setBusy(false); }
  }
  if (!token && !error) return null;
  return <section className="mb-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
    <h2 className="text-lg font-semibold">{preview ? `Join ${preview.spaceName}?` : "Your library invitation"}</h2>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {!sessionId && <p className="mt-3 text-sm leading-6">Sign in below with the email address invited by the owner. You will review the library before joining.</p>}
    {preview && <><p className="mt-3 break-words text-sm leading-6">Join as {preview.email}. You can view, download and upload shared files. Owners manage shared files. The library owners manage membership.</p><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Your personal space and other libraries remain separate. Files you contribute stay in this shared library if you leave.</p><button disabled={busy} className="account-primary-action mt-5 min-h-11 rounded-xl px-4 text-sm" onClick={() => void acceptInvitation()}>Join library</button></>}
    <button disabled={busy} className="mt-3 min-h-11 px-4 text-sm" onClick={() => { try { sessionStorage.removeItem(storageKey); } catch { /* No persistent storage was available. */ } setToken(""); setPreview(null); setError(""); }}>Dismiss invitation</button>
  </section>;
}
