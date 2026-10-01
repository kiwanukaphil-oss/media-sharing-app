"use client";
import { navigateInRelay } from "@/lib/app-navigation";
/* eslint-disable @next/next/no-html-link-for-pages -- Hosted authentication must perform a full document navigation. */

import { useEffect, useState } from "react";
import { libraryRoleDescription, libraryRoleLabel } from "@/lib/contracts";
import { requestJson } from "@/lib/api-client";

const storageKey = "relay-pending-person-invitation";
type Preview = { spaceName: string; email: string; expiresAt: number; role: string };

// Fragment tokens never enter server URLs. Keep one pending link in this tab through hosted sign-in.
// Reading the preview grants no access; only explicit acceptance creates a membership.
export default function AccountInvitation({ sessionId, email, standalone = false }: { sessionId?: string; email?: string; standalone?: boolean }) {
  const [token, setToken] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [trusted, setTrusted] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const reopenInvitation = () => setRevision(value => value + 1);
    window.addEventListener("hashchange", reopenInvitation);
    return () => window.removeEventListener("hashchange", reopenInvitation);
  }, []);
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
  }, [sessionId, revision]);

  // Discard the token only on confirmed acceptance; network errors can be retried without silent joining.
  async function acceptInvitation() {
    setBusy(true); setError("");
    try {
      const result = await requestJson<{ spaceId: string }>("auth/invitation-accept", { method: "POST", headers: { "X-Relay-Invitation": token } });
      try { sessionStorage.removeItem(storageKey); } catch { /* Successful joining must still open the workspace. */ }
      // Keep application uploads alive while the new page checks authority.
      navigateInRelay(`/?space=${encodeURIComponent(result.spaceId)}`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The library could not be joined."); setBusy(false); }
  }
  if (!token && !error) return standalone ? <section><h1>Open your invitation link</h1><p className="mt-3">Already signed in? Find your pending invitation in Your workspaces, even if you opened the original link in another tab or browser.</p><a className="entry-secondary mt-5" href="/workspaces">Your workspaces</a></section> : null;
  return <section className="mb-8 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6">
    <h2 className="text-lg font-semibold">{preview ? `Join ${preview.spaceName}?` : "Your library invitation"}</h2>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {!sessionId && <><p className="mt-3 text-sm leading-6">New to Relay? Create your account first. Use the email address the owner invited and choose your own password. You do not need an existing username or password.</p><ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-6"><li>Create an account, or sign in if you already have one.</li><li>Verify your email if prompted. Return to this tab afterwards.</li><li>Review the shared workspace and choose Join library.</li></ol><label className="entry-trust"><input type="checkbox" checked={trusted} onChange={event => setTrusted(event.target.checked)} /><span>Keep me signed in<small>For your own computer only</small></span></label><a className="entry-primary" href={`/api/auth/login?screen=signup&session=${trusted ? "trusted" : "temporary"}`}>Create account</a><a className="entry-secondary mt-3" href={`/api/auth/login?session=${trusted ? "trusted" : "temporary"}`}>Sign in</a><p className="mt-3 text-sm text-[var(--muted)]">Already registered? Choose Sign in. Forgot your password? Use Reset password on the next screen. Your invitation stays here while you continue.</p></>}
    {sessionId && <p className="mt-3 break-words text-sm">Signed in{email ? ` as ${email}` : " to Relay"}. <a className="underline" href="/api/auth/login?session=temporary">Use a different account</a></p>}
    {sessionId && !preview && !error && <p role="status" className="mt-3">Checking your invitation...</p>}
    {sessionId && error && <><p className="mt-3 text-sm">Use the email address the owner invited. If this is the right account, ask the owner for a fresh link, or check whether the workspace is already in your list.</p><button className="entry-secondary mt-3" onClick={() => setRevision(value => value + 1)}>Retry invitation</button><a className="entry-secondary mt-3" href="/workspaces?invitations=skip">Your workspaces</a></>}
    {preview && <><p className="mt-3 break-words text-sm leading-6">Join as {preview.email} with {libraryRoleLabel(preview.role)} access. {libraryRoleDescription(preview.role)} The library owners manage membership.</p><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Your personal space and other libraries remain separate. Files you contribute stay in this shared library if you leave.</p><button disabled={busy} className="entry-primary mt-5" onClick={() => void acceptInvitation()}>{busy ? "Joining..." : "Join library"}</button></>}
    <button disabled={busy} className="mt-3 min-h-11 px-4 text-sm" onClick={() => { try { sessionStorage.removeItem(storageKey); } catch { /* No persistent storage was available. */ } setToken(""); setPreview(null); setError(""); }}>Dismiss invitation</button>
  </section>;
}
