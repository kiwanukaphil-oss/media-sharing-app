"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, ShieldCheck, Monitor, LogOut } from "lucide-react";

type Session = { sessionId: string; displayName: string; verifiedEmail: string; expiresAt: number };
type SessionEntry = { id: string; createdAt: number; expiresAt: number };
type AccountState = { enabled: boolean; account: Session | null };

// This screen keeps identity management separate from the currently paired shared library.
export default function AccountPage() {
  const [state, setState] = useState<AccountState | null>(null);
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  // Abort on navigation and suppress stale responses when account state is refreshed.
  useEffect(() => {
    const controller = new AbortController();
    const signInResult = new URLSearchParams(window.location.search).get("signin");
    const loadAccount = async () => {
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
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Please try again.");
      }
    };
    void loadAccount();
    return () => controller.abort();
  }, [revision]);

  // Revoke on the server before changing the screen; failures leave the session visible for retry.
  async function signOutSession(id: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) { const data = await response.json() as { error?: string }; throw new Error(data.error || "Sign-out failed. Please retry."); }
      setRevision(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally { setBusy(false); }
  }

  return <main className="account-page min-h-screen">
    <Link href="/" className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} /> Back to library</Link>
    <header className="mb-10 mt-12">
      <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent)]"><ShieldCheck size={24} /></div>
      <h1 className="text-3xl font-semibold tracking-tight">Your account</h1>
      <p className="mt-3 text-[var(--muted)]">A secure home for your identity and signed-in browsers.</p>
    </header>
    {error && <div role="alert" className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error} <button className="ml-2 underline" onClick={() => { setError(""); setRevision(value => value + 1); }}>Retry</button></div>}
    {!state && !error && <p role="status" className="text-[var(--muted)]">Loading your account…</p>}
    {state && !state.enabled && <section className="rounded-2xl border border-[var(--line)] p-7"><h2 className="font-semibold">Account sign-in is coming soon</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">You can continue using your connected library while we prepare recoverable accounts.</p></section>}
    {state?.enabled && !state.account && <section className="rounded-2xl border border-[var(--line)] p-7">
      <h2 className="text-lg font-semibold">Welcome to Relay</h2><p className="mt-3 text-sm leading-6 text-[var(--muted)]">Sign in with your verified email. Access to shared spaces is managed separately.</p>
      {/* Full navigation is required for the external OIDC redirect; never prefetch a login transaction. */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a href="/api/auth/login" className="mt-6 inline-flex items-center gap-3 rounded-xl bg-[var(--accent)] px-5 py-3 font-medium text-white">Sign in securely <ArrowRight size={17} /></a>
    </section>}
    {state?.account && <>
      <section className="rounded-2xl border border-[var(--line)] p-7"><h2 className="text-lg font-semibold">{state.account.displayName}</h2><p className="mt-1 break-words text-sm text-[var(--muted)]">{state.account.verifiedEmail}</p><p className="mt-5 text-sm leading-6 text-[var(--muted)]">Your account is signed in. Your currently connected library remains available from the link above.</p></section>
      <section className="mt-10" aria-labelledby="sessions-heading"><h2 id="sessions-heading" className="text-lg font-semibold">Signed-in browsers</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Sessions expire after seven days. Signing out here ends account access for that browser. Connected library devices are managed separately in the library.</p>
        <ul className="mt-5 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] px-5">
          {sessions.map(session => <li key={session.id} className="flex items-center gap-4 py-5"><Monitor size={20} className="shrink-0 text-[var(--muted)]" /><div className="min-w-0 flex-1"><strong className="text-sm font-medium">{session.id === state.account!.sessionId ? "This browser" : "Another browser"}</strong><p className="mt-1 text-xs text-[var(--muted)]">Signed in {new Date(session.createdAt).toLocaleString()}</p></div><button disabled={busy} onClick={() => void signOutSession(session.id)} className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-[var(--surface)]" aria-label={session.id === state.account!.sessionId ? "Sign out this browser" : `Sign out browser signed in ${new Date(session.createdAt).toLocaleString()}`}><LogOut size={16} /><span className="hidden sm:inline">Sign out</span></button></li>)}
        </ul>
      </section>
    </>}
  </main>;
}
