"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Copy, UserPlus, Users } from "lucide-react";
import { createLibraryApi, RequestError } from "@/lib/api-client";
import { useActionConfirmation } from "./action-confirmation";

type Member = { id: string; name: string; email: string | null; role: "owner" | "member"; revision: number };
type People = { space: { id: string; name: string }; currentMembershipId: string; role: string; members: Member[];
  invitations: { id: string; email: string; expiresAt: number }[]; legacyDevices: number | null };

// Person membership controls are separate from legacy pairing and always bind to the displayed space.
export default function SpacePeople({ spaceId }: { spaceId: string }) {
  const api = useMemo(() => createLibraryApi(spaceId), [spaceId]);
  const [people, setPeople] = useState<People | null>(null);
  const [email, setEmail] = useState("");
  const [invitation, setInvitation] = useState<{ url: string; email: string } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const { confirm, confirmation } = useActionConfirmation();
  const refreshPeople = useCallback((signal?: AbortSignal) => api.requestJson<People>("people", { signal })
    .then(result => { if (!signal?.aborted) setPeople(result); })
    .catch(failure => {
      if (signal?.aborted) return;
      if (failure instanceof RequestError && [401, 403].includes(failure.status)) { setPeople(null); setInvitation(null); }
      setError(failure instanceof Error ? failure.message : "People could not be loaded.");
    }), [api]);
  useEffect(() => { const controller = new AbortController(); void refreshPeople(controller.signal); return () => controller.abort(); }, [refreshPeople]);

  // Audience changes require a named confirmation; failed requests remain retryable with a refreshed revision.
  async function changeMember(member: Member, action: "owner" | "member" | "remove" | "leave") {
    const removing = action === "remove" || action === "leave";
    const title = action === "leave" ? `Leave ${people?.space.name}?` : action === "remove" ? `Remove ${member.name}?` : `Make ${member.name} ${action === "owner" ? "an owner" : "a member"}?`;
    if (!await confirm({ title, action: action === "leave" ? "Leave library" : action === "remove" ? "Remove access" : "Change role", destructive: removing,
      description: removing ? "Their shared files stay in this library. Account access and explicitly linked legacy device access end. Previously downloaded copies and already issued file links cannot be recalled; other legacy devices must be reviewed separately."
        : action === "owner" ? "An owner can manage people, invite others and organise or delete shared content. Your own access remains in place." : "Member access allows viewing, downloading and uploading, plus managing their own uploads. Owner administration ends; linked legacy devices follow this change." })) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.requestJson(`people/${member.id}`, { method: "PUT", body: JSON.stringify({ action, revision: member.revision }) });
      if (action === "leave" || (action === "remove" && member.id === people?.currentMembershipId)) {
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- Clear the departed space's state.
        window.location.assign("/account"); return;
      }
      setNotice("Access updated. Shared files are preserved."); await refreshPeople();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Access could not be changed."); await refreshPeople(); }
    finally { setBusy(false); }
  }

  // Creating a link sends no email. The recipient must sign in with this exact verified address and accept.
  async function createInvitation(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice(""); setInvitation(null);
    try {
      const result = await api.requestJson<{ token: string; email: string }>("person-invitations", { method: "POST", body: JSON.stringify({ email }) });
      setInvitation({ url: `${window.location.origin}/join#invite=${result.token}`, email: result.email }); setEmail(""); await refreshPeople();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "The invitation could not be created."); }
    finally { setBusy(false); }
  }

  // Revoking an unused invitation is immediate and does not remove anyone already in the library.
  async function revokeInvitation(id: string) {
    setBusy(true); setError("");
    try { await api.requestJson(`person-invitations/${id}`, { method: "DELETE" }); setInvitation(null); setNotice("Invitation revoked."); await refreshPeople(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The invitation could not be revoked."); }
    finally { setBusy(false); }
  }

  return <main className="account-page min-h-screen">
    <a href={`/?space=${encodeURIComponent(spaceId)}`} className="inline-flex items-center gap-2 text-sm text-[var(--muted)]"><ArrowLeft size={16} /> Back to library</a>
    <header className="mb-8 mt-10"><Users className="mb-4 text-[var(--accent)]" /><h1>People &amp; access</h1><p className="mt-3 text-[var(--muted)]">{people?.space.name || "Shared library"}</p></header>
    {error && <p role="alert" className="mb-5 text-sm text-red-800">{error} <button className="underline" onClick={() => { setError(""); void refreshPeople(); }}>Refresh</button> <a href="/account" className="underline">Your account</a></p>}
    {notice && <p role="status" className="mb-5 text-sm">{notice}</p>}
    {people && <>
      <section className="rounded-2xl border border-[var(--line)] p-5"><h2 className="font-semibold">Use another device</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Open Relay on your other device and sign in with your account. Your libraries follow you. Invitations below are for other people.</p><a href="/account" className="mt-3 inline-block text-sm underline">Manage your signed-in browsers</a></section>
      <section className="mt-8"><h2 className="font-semibold">Library members</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Everyone listed can see this shared library. Their personal spaces stay separate.</p>
        <ul className="mt-4 divide-y divide-[var(--line)]">{people.members.map(member => <li key={member.id} className="py-5">
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><strong className="break-words text-sm">{member.name}{member.id === people.currentMembershipId ? " (you)" : ""}</strong>{member.email && <p className="mt-1 break-all text-xs text-[var(--muted)]">{member.email}</p>}</div><span className="text-xs text-[var(--muted)]">{member.role === "owner" ? "Owner" : "Member"}</span></div>
          <div className="mt-3 flex flex-wrap gap-2">{people.role === "owner" && <button className="account-secondary-action min-h-11 rounded-lg px-3 text-xs" disabled={busy} onClick={() => void changeMember(member, member.role === "owner" ? "member" : "owner")}>{member.role === "owner" ? "Make member" : "Make owner"}</button>}
            {member.id === people.currentMembershipId ? <button disabled={busy} className="min-h-11 px-3 text-xs text-red-800" onClick={() => void changeMember(member, "leave")}>Leave library</button> : people.role === "owner" && <button disabled={busy} className="min-h-11 px-3 text-xs text-red-800" onClick={() => void changeMember(member, "remove")}>Remove access</button>}</div>
        </li>)}</ul>
        {people.role === "owner" && <p className="text-xs leading-5 text-[var(--muted)]">To hand over ownership, make another member an owner first, then leave or change your own role. Relay always keeps at least one account owner.</p>}
      </section>
      {people.legacyDevices !== null && people.legacyDevices > 0 && <p className="mt-6 rounded-xl bg-[var(--surface)] p-4 text-sm leading-6">{people.legacyDevices} legacy paired device{people.legacyDevices === 1 ? " also has" : "s also have"} access. Device names do not identify people. Review these separately from a connected owner device before treating this roster as the full audience.</p>}
      {people.role === "owner" && <section className="mt-8 rounded-2xl border border-[var(--line)] p-5"><h2 className="flex items-center gap-2 font-semibold"><UserPlus size={18} /> Invite a person</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">They will join {people.space.name} as a member: view and download shared files, upload, and manage their own uploads. The link works once, for their verified email, for 7 days.</p>
        <form className="library-form mt-4" onSubmit={event => void createInvitation(event)}><label>Email address<input type="email" required maxLength={320} autoComplete="off" value={email} onChange={event => setEmail(event.target.value)} /></label><button disabled={busy} className="account-primary-action mt-3 min-h-11 rounded-xl px-4 text-sm">Create invitation link</button></form>
        {invitation && <div className="mt-5"><p className="break-all text-sm">Share this link with {invitation.email}. No email has been sent.</p><input className="invitation-link mt-2" aria-label="Invitation link" readOnly value={invitation.url} onFocus={event => event.target.select()} /><button className="mt-2 inline-flex min-h-11 items-center gap-2 text-sm" onClick={() => { void navigator.clipboard.writeText(invitation.url).then(() => setNotice("Invitation link copied.")).catch(() => setError("Select and copy the invitation link above.")); }}><Copy size={15} /> Copy link</button></div>}
        {people.invitations.length > 0 && <ul className="mt-5 divide-y divide-[var(--line)]">{people.invitations.map(invite => <li key={invite.id} className="flex items-center justify-between gap-3 py-3"><div className="min-w-0"><p className="break-all text-sm">{invite.email}</p><p className="mt-1 text-xs text-[var(--muted)]">Expires {new Date(invite.expiresAt).toLocaleDateString()}</p></div><button disabled={busy} className="min-h-11 px-2 text-xs" onClick={() => void revokeInvitation(invite.id)}>Revoke</button></li>)}</ul>}
      </section>}
    </>}{confirmation}
  </main>;
}
