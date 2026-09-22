"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import AccountLibraries from "@/components/account-libraries";
import DeliveryInvitation from "@/components/delivery-invitation";
import CollectionInvitation from "@/components/collection-invitation";
import AccountInvitation from "@/components/account-invitation";
import AccountDeletion from "@/components/account-deletion";
import { ArrowLeft, ArrowRight, ShieldCheck, Monitor, LogOut, LoaderCircle } from "lucide-react";

type Session = { sessionId: string; displayName: string; verifiedEmail: string; expiresAt: number };
type SessionEntry = { id: string; createdAt: number; expiresAt: number; sessionMode: "temporary" | "trusted" };
type AccountState = { enabled: boolean; account: Session | null };

// This screen keeps identity management separate from the currently paired shared library.
export default function AccountPage() {
  const [state, setState] = useState<AccountState | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [error, setError] = useState("");
  const [signingOutId, setSigningOutId] = useState<string | null>(null);
  const busy = signingOutId !== null;
  const [sessionsState, setSessionsState] = useState<"loading" | "ready" | "error">("loading");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [trustBrowser, setTrustBrowser] = useState(false);

  // Abort on navigation and suppress stale responses when account state is refreshed.
  useEffect(() => {
    const controller = new AbortController();
    const signInResult = new URLSearchParams(window.location.search).get("signin");
    const loadAccount = async () => {
      setSessionsState("loading");
      try {
        const response = await fetch("/api/auth/session", { signal: controller.signal, cache: "no-store" });
        const data = await response.json() as AccountState & { error?: string };
        if (!response.ok) throw new Error(data.error || "Your account could not be loaded.");
        if (signInResult) setError(signInResult === "verify-email"
          ? "Check your inbox and verify your email address, then sign in again."
          : "Sign-in could not be completed. Please start again.");
        setState(data);
        if (data.account) {
          const response = await fetch("/api/auth/sessions", { signal: controller.signal, cache: "no-store" });
          const list = await response.json() as { sessions: SessionEntry[]; error?: string };
          if (!response.ok) throw new Error(list.error || "Sessions could not be loaded.");
          setSessions(list.sessions);
        } else setSessions([]);
        setSessionsState("ready");
      } catch (failure) {
        if (!controller.signal.aborted) { setSessionsState("error"); setError(failure instanceof Error ? failure.message : "Please try again."); }
      }
    };
    void loadAccount();
    return () => controller.abort();
  }, [revision]);

  // Revoke on the server before changing the screen; failures leave the session visible for retry.
  async function signOutSession(id: string) {
    setSigningOutId(id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || "Sign-out failed. Please retry."); }
      const result = await response.json() as { providerLogoutUrl?: string };
      if (result.providerLogoutUrl) { window.location.assign(result.providerLogoutUrl); return; }
      setNotice("Browser signed out.");
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally { setSigningOutId(null); }
  }

  return <main className="account-page min-h-screen">
    <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} /> Back to library</Link>
    <header className="mb-10 mt-12">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><ShieldCheck size={24} /></div>
      <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
      <p className="mt-3 text-[var(--muted)]">A secure home for your identity and signed-in browsers.</p>
    </header>
    <AccountInvitation sessionId={state?.account?.sessionId} />
    <CollectionInvitation sessionId={state?.account?.sessionId} />
    <DeliveryInvitation sessionId={state?.account?.sessionId} />
    {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} <button className="ml-2 underline" onClick={() => { setError(""); setRevision(value => value + 1); }}>Retry</button></div>}
    {!state && !error && <p role="status" className="text-[var(--muted)]">Loading your account…</p>}
    {state && !state.enabled && <section className="rounded-2xl border border-[var(--line)] p-7"><h2 className="font-semibold">Account sign-in is coming soon</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">You can continue using your connected library while we prepare recoverable accounts.</p></section>}
    {state?.enabled && !state.account && <section className="rounded-2xl border border-[var(--line)] p-7">
      <h2 className="text-lg font-semibold">Welcome to Relay</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Sign in with your verified email. Access to shared spaces is managed separately.</p>
      <label className="account-trust-choice mt-6 flex cursor-pointer items-start gap-3 rounded-xl bg-[var(--surface)] p-4">
        <input type="checkbox" checked={trustBrowser} onChange={event => setTrustBrowser(event.target.checked)} />
        <span><span className="text-sm font-medium">Keep me signed in on this browser</span><span className="mt-1 block text-xs leading-5 text-[var(--muted)]">Up to 7 days. Only choose this on a device you trust.</span></span>
      </label>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{trustBrowser ? "You can sign this browser out remotely from Your account." : "Temporary access lasts up to 8 hours. Always sign out on a shared computer; browsers may restore sessions after closing."}</p>
      {/* Full navigation is required for the external OIDC redirect; never prefetch a login transaction. */}
      <a href={`/api/auth/login?session=${trustBrowser ? "trusted" : "temporary"}`} className="account-primary-action mt-6 inline-flex items-center gap-3 rounded-xl px-5 py-3 font-medium">Sign in securely <ArrowRight size={17} /></a>
    </section>}
    {state?.account && <>
      <section className="rounded-2xl border border-[var(--line)] p-7"><h2 className="break-words text-lg font-semibold">{state.account.displayName}</h2>{state.account.displayName !== state.account.verifiedEmail && <p className="mt-1 break-words text-sm text-[var(--muted)]">{state.account.verifiedEmail}</p>}<p className="mt-5 text-sm leading-6 text-[var(--muted)]">Your account is signed in. Your currently connected library remains available from the link above.</p></section>
      <AccountLibraries key={state.account.sessionId} />
      <section className="mt-10" aria-labelledby="sessions-heading"><h2 id="sessions-heading" className="text-lg font-semibold">Signed-in browsers</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Temporary access lasts up to 8 hours; trusted browsers stay signed in for up to 7 days. Signing out this browser also opens secure provider sign-out. Remote sign-out ends its Relay account access. Connected library devices are managed separately in the library.</p>
        {notice && <p role="status" className="mt-4 text-sm text-[var(--muted)]">{notice}</p>}
        {sessionsState === "loading" && <p role="status" className="mt-5 text-sm text-[var(--muted)]">Checking signed-in browsers...</p>}
        {sessionsState === "error" && <p className="mt-5 text-sm text-[var(--muted)]">Browser details could not be refreshed. Retry above to see current access.</p>}
        {sessionsState === "ready" && sessions.length === 0 && <p className="mt-5 text-sm text-[var(--muted)]">No active browsers were returned. Refresh this page to check your account.</p>}
        {sessionsState === "ready" && sessions.length > 0 && <ul className="mt-5 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] px-5">
          {sessions.map(session => <li key={session.id} className="flex items-center gap-4 py-5"><Monitor size={20} className="shrink-0 text-[var(--muted)]" /><div className="min-w-0 flex-1"><strong className="text-sm font-medium">{session.id === state.account!.sessionId ? "This browser" : "Another browser"}</strong><p className="mt-1 text-xs text-[var(--muted)]">{session.sessionMode === "temporary" ? "Temporary" : "Trusted"} &middot; Signed in {new Date(session.createdAt).toLocaleString()}</p><p className="mt-1 text-xs text-[var(--muted)]">Expires {new Date(session.expiresAt).toLocaleString()}</p></div><button disabled={busy} onClick={() => void signOutSession(session.id)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-[var(--surface)]" aria-label={session.id === state.account!.sessionId ? "Sign out this browser" : `Sign out browser signed in ${new Date(session.createdAt).toLocaleString()}`}>{signingOutId === session.id ? <LoaderCircle size={16} className="spin" /> : <LogOut size={16} />}<span className={signingOutId === session.id ? "" : "hidden sm:inline"}>{signingOutId === session.id ? "Signing out..." : "Sign out"}</span></button></li>)}
        </ul>}
      </section>
      <AccountDeletion key={`deletion-${state.account.sessionId}`} />
    </>}
  </main>;
}
