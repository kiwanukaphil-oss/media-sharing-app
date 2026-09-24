"use client";
/* eslint-disable @next/next/no-html-link-for-pages -- Entry links deliberately replace the full library/account state. */
/* eslint-disable @next/next/no-location-assign-relative-destination -- Entry transitions replace account/library state with a fresh navigation. */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ArrowLeftRight, ArrowUpRight, ArrowRight, Check, Folder, LockKeyhole, Users, Search, LogOut, LoaderCircle } from "lucide-react";
import { requestJson, RequestError } from "@/lib/api-client";
import { libraryRoleLabel } from "@/lib/contracts";

type Account = { sessionId: string; displayName: string; verifiedEmail: string };
type Identity = { enabled: boolean; account: Account | null };
type Space = { id: string; name: string; kind?: "personal" | "shared"; role: string };

export function EntryFrame({ children, wide = false, account }: { children: ReactNode; wide?: boolean; account?: Account }) {
  return <div className={`entry-page${wide ? " entry-workspaces" : ""}`}><header className="entry-header"><a href="/" className="entry-brand" aria-label="Relay home"><span><ArrowLeftRight size={21} /></span>relay<span className="entry-brand-dot">.</span></a>{account ? <a className="entry-account" href="/account"><span className="entry-avatar">{account.displayName.slice(0, 1).toUpperCase()}</span><span>{account.displayName}</span></a> : <span className="entry-header-note">A home for every story.</span>}</header>{children}<footer className="entry-footer"><span>RELAY</span><span>Your moments. Thoughtfully collected.</span></footer></div>;
}

// Relay owns the branded entry; credentials remain on the existing secure hosted sign-in service.
export function SignInPanel({ enabled = true, failure = "", pairedName }: { enabled?: boolean; failure?: string; pairedName?: string }) {
  const [trusted, setTrusted] = useState(false);
  return <div className="entry-signin"><div className="entry-story"><p className="entry-eyebrow">MAKE ROOM FOR WHAT MATTERS</p><h1>Your stories.<br /><em>A place of their own.</em></h1><p>Bring your photos, films and favourite people together. One album at a time.</p><div className="entry-art" aria-hidden="true"><div className="entry-art-album art-back"><span>RELAY COLLECTION</span><strong>Everyday,<br />lately</strong><i /></div><div className="entry-art-album art-front"><span>RELAY COLLECTION</span><strong>Places<br />we return to.</strong><i /></div></div></div><section className="entry-signin-panel" aria-labelledby="signin-heading"><div className="entry-step"><span>01</span> SIGN IN TO YOUR SPACE</div><h2 id="signin-heading">Welcome to Relay.</h2><p>Open your albums and the workspaces you share.</p>{failure && <p className="entry-error" role="alert">{failure}</p>}{enabled ? <><label className="entry-trust"><input type="checkbox" checked={trusted} onChange={event => setTrusted(event.target.checked)} /><span>Keep me signed in<small>For your own computer only</small></span></label><a className="entry-primary" href={`/api/auth/login?session=${trusted ? "trusted" : "temporary"}`}>Sign in<ArrowRight size={18} /></a><p className="entry-session-note"><LockKeyhole size={13} />{trusted ? "Trusted browser / up to 7 days" : "Temporary session / up to 8 hours"}</p></> : <p className="entry-error" role="status">Account sign-in is not enabled on this deployment.</p>}<div className="entry-invitation-note">Invited to a workspace?<br /><span>Sign in with the email address on your invitation.</span></div>{pairedName && <a className="entry-device-link" href="/?device=1">Continue to {pairedName}<ArrowUpRight size={14} /></a>}</section></div>;
}

// Resolve identity before mounting the application shell; failed reads never look like an empty library.
export default function RelayEntry({ mode = "home", legacy }: { mode?: "home" | "login" | "workspaces"; legacy?: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [paired, setPaired] = useState<string>();
  const [showLegacy, setShowLegacy] = useState(false);
  const [failure, setFailure] = useState("");
  const [signinFailure, setSigninFailure] = useState("");
  const [revision, setRevision] = useState(0);
  const expireIdentity = useCallback(() => setIdentity({ enabled: true, account: null }), []);
  useEffect(() => {
    const controller = new AbortController();
    async function resolveEntry() {
      try {
        setFailure("");
        if (mode === "home" && new URLSearchParams(location.hash.slice(1)).has("join")) { setShowLegacy(true); return; }
        const result = await requestJson<Identity>("auth/session", { signal: controller.signal, cache: "no-store" });
        if (controller.signal.aborted) return;
        const signin = new URLSearchParams(location.search).get("signin");
        setSigninFailure(signin ? signin === "verify-email" ? "Verify your email address, then sign in again." : "Sign-in was interrupted or expired. Please try again." : "");
        if (result.account) {
          // Pending invitation secrets stay in this tab; retain their existing explicit review/acceptance flow.
          try { if (["relay-pending-person-invitation", "relay-pending-collection", "relay-pending-delivery"].some(key => /^[a-f0-9]{64}$/.test(sessionStorage.getItem(key) || ""))) { location.replace("/account"); return; } } catch { /* Entry still works when optional tab storage is unavailable. */ }
          setIdentity(result); return;
        }
        if (!result.enabled && mode === "home") { setShowLegacy(true); return; }
        const response = await fetch("/api/session", { signal: controller.signal, cache: "no-store" });
        if (response.ok) {
          const session = await response.json() as { space?: { name: string } };
          if (controller.signal.aborted) return;
          setPaired(session.space?.name);
          // Existing paired-device sessions retain their deliberate device access; account entry uses the chooser.
          if (mode === "home") { setShowLegacy(true); return; }
        } else if (response.status !== 401 && response.status !== 403) throw new Error("Workspace access could not be checked. Please retry.");
        if (!controller.signal.aborted) setIdentity(result);
      } catch (error) { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : "Relay could not be opened."); }
    }
    void resolveEntry();
    return () => controller.abort();
  }, [mode, revision]);
  if (showLegacy && legacy) return legacy;
  if (identity?.account) return <WorkspaceChooser account={identity.account} onExpired={expireIdentity} />;
  if (identity) return <EntryFrame><SignInPanel enabled={identity.enabled} failure={signinFailure} pairedName={paired} /></EntryFrame>;
  return <EntryFrame><main className="entry-state">{failure ? <><p className="entry-eyebrow">LET&apos;S TRY THAT AGAIN</p><h1>We couldn&apos;t open Relay.</h1><p role="alert">{failure}</p><button className="entry-primary" onClick={() => setRevision(value => value + 1)}>Try again<ArrowRight size={17} /></button></> : <><LoaderCircle className="spin" size={22} /><p role="status">Opening Relay...</p></>}</main></EntryFrame>;
}

// Workspace choice is explicit, including accounts with one space. Membership is refreshed before every arrival.
function WorkspaceChooser({ account, onExpired }: { account: Account; onExpired: () => void }) {
  const [spaces, setSpaces] = useState<Space[] | null>(null);
  const [failure, setFailure] = useState("");
  const [search, setSearch] = useState("");
  const [revision, setRevision] = useState(0);
  const [canCreatePersonal, setCanCreatePersonal] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ spaces: Space[]; personalSpace?: { enabled: boolean } }>("auth/spaces", { signal: controller.signal, cache: "no-store" })
      .then(result => { if (!controller.signal.aborted) { setSpaces(result.spaces); setCanCreatePersonal(!!result.personalSpace?.enabled); setFailure(""); } })
      .catch(error => { if (controller.signal.aborted) return; if (error instanceof RequestError && error.status === 401) { onExpired(); return; } setFailure("Your workspaces couldn't be loaded. Please try again."); });
    return () => controller.abort();
  }, [revision, onExpired]);
  async function createPersonalWorkspace() {
    setBusy(true); setFailure("");
    try { const result = await requestJson<{ space: Space }>("auth/personal-space", { method: "POST" }); location.assign(`/?space=${encodeURIComponent(result.space.id)}`); }
    catch (error) { setFailure(error instanceof Error ? error.message : "Your workspace could not be created."); setBusy(false); }
  }
  async function signOutCurrentBrowser() {
    setBusy(true); setFailure("");
    try { const result = await requestJson<{ providerLogoutUrl?: string }>(`auth/sessions/${encodeURIComponent(account.sessionId)}`, { method: "DELETE" }); if (result.providerLogoutUrl) location.assign(result.providerLogoutUrl); else location.replace("/login"); }
    catch { setFailure("Sign-out could not be completed. Please retry."); setBusy(false); }
  }
  const matches = (spaces || []).filter(space => space.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <EntryFrame wide account={account}><main className="workspace-arrival"><nav className="entry-progress" aria-label="Sign-in progress"><span><Check size={13} />Signed in</span><span aria-current="step">02 &nbsp; Choose workspace</span><span>03 &nbsp; Open albums</span></nav><header className="workspace-arrival-heading"><p className="entry-eyebrow">YOUR COLLECTIONS START HERE</p><h1>Where would you<br /><em>like to begin?</em></h1><p>Choose a workspace to open its albums.</p></header>{failure && <div className="entry-error" role="alert">{failure}<button disabled={busy} onClick={() => { setSpaces(null); setRevision(value => value + 1); }}>Retry workspaces</button></div>}{spaces === null && !failure && <p role="status" className="entry-loading">Loading your workspaces...</p>}{spaces && <>{spaces.length > 4 && <label className="workspace-search"><Search size={17} /><input type="search" aria-label="Find a workspace" placeholder="Find a workspace" value={search} onChange={event => setSearch(event.target.value)} /></label>}{["personal", "shared"].map(kind => { const group = matches.filter(space => (space.kind || "shared") === kind); return group.length ? <section className="workspace-group" key={kind} aria-label={kind === "personal" ? "Personal workspaces" : "Shared workspaces"}><h2>{kind === "personal" ? "JUST FOR YOU" : "BETTER TOGETHER"}</h2><div className="workspace-cards">{group.map(space => <a key={space.id} className={`workspace-choice workspace-${kind}`} href={`/?space=${encodeURIComponent(space.id)}`} aria-label={`Open workspace ${space.name}`}><span className="workspace-choice-icon">{kind === "personal" ? <LockKeyhole size={22} /> : <Users size={22} />}</span><span className="workspace-choice-body"><span className="workspace-kind">{kind === "personal" ? "Personal workspace" : "Shared workspace"}</span><strong>{space.name}</strong><span className="workspace-role">{kind === "personal" ? "Only you" : libraryRoleLabel(space.role)}</span></span><span className="workspace-choice-arrow"><ArrowUpRight size={21} /></span></a>)}</div></section> : null; })}{spaces.length === 0 && <div className="workspace-empty"><Folder size={28} /><h2>No workspaces yet.</h2><p>{canCreatePersonal ? "Create your personal workspace, or open a workspace invitation." : "Open an invitation from a workspace owner to get started."}</p><a href="/account">Manage account and connections<ArrowUpRight size={15} /></a></div>}{search && matches.length === 0 && <div className="workspace-empty"><h2>No matching workspaces.</h2><button className="entry-secondary" onClick={() => setSearch("")}>Clear search</button></div>}{canCreatePersonal && !spaces.some(space => space.kind === "personal") && <button className="entry-secondary workspace-create" disabled={busy} onClick={() => void createPersonalWorkspace()}>{busy ? "Opening..." : "Create personal workspace"}<ArrowRight size={16} /></button>}</>}<footer className="workspace-identity"><span>Signed in as <strong>{account.verifiedEmail}</strong></span><button disabled={busy} onClick={() => void signOutCurrentBrowser()}><LogOut size={15} />{busy ? "Please wait..." : "Sign out"}</button></footer></main></EntryFrame>;
}

export function WorkspaceUnavailable({ retry }: { retry: () => void }) {
  return <EntryFrame><main className="entry-state"><p className="entry-eyebrow">WORKSPACE UNAVAILABLE</p><h1>Let&apos;s get you to the right place.</h1><p>This workspace could not be opened. Your session may have expired or your access may have changed.</p><a className="entry-primary" href="/workspaces">Sign in or choose a library<ArrowRight size={17} /></a><button className="entry-secondary" onClick={retry}>Try again</button></main></EntryFrame>;
}
