"use client";
import { navigateInRelay } from "@/lib/app-navigation";

import { useState } from "react";
import { requestJson } from "@/lib/api-client";
import { libraryRoleDescription, libraryRoleLabel } from "@/lib/contracts";

export type PendingWorkspaceInvitation = { id: string; spaceName: string; email: string; role: string; expiresAt: number };

// Account-backed invitations survive email verification in another tab, browser or device.
// A named join action accepts only this invitation and then opens that exact shared workspace.
export default function PendingWorkspaceInvitations({ invitations }: { invitations: PendingWorkspaceInvitation[] }) {
  const [joiningId, setJoiningId] = useState("");
  const [failure, setFailure] = useState("");
  // Keep failures retryable; clear obsolete tab state only after the server confirms membership.
  async function joinInvitedWorkspace(invitation: PendingWorkspaceInvitation) {
    setJoiningId(invitation.id); setFailure("");
    try {
      const joined = await requestJson<{ spaceId: string }>(`auth/invitations/${invitation.id}/accept`, { method: "POST" });
      try { sessionStorage.removeItem("relay-pending-person-invitation"); } catch { /* Opening a joined workspace does not require browser storage. */ }
      // Keep application uploads alive while the new page checks authority.
      navigateInRelay(`/?space=${encodeURIComponent(joined.spaceId)}`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "The workspace could not be joined. Please retry."); setJoiningId("");
    }
  }
  if (!invitations.length) return null;
  return <section className="workspace-group pending-workspace-invitations" aria-label="Workspace invitations">
    <h2>You&apos;re invited</h2>
    <p className="mb-4 text-sm">Join your shared workspace to start using its albums and files.</p>
    {failure && <p role="alert" className="entry-error">{failure}</p>}
    {invitations.map(invitation => <article key={invitation.id} className="mb-4 rounded-2xl border border-[var(--line)] bg-white p-5">
      <h3 className="break-words text-xl font-semibold">{invitation.spaceName}</h3>
      <p className="mt-2 break-words text-sm">Invited as {invitation.email} · {libraryRoleLabel(invitation.role)}</p>
      <p className="mt-2 text-sm">{libraryRoleDescription(invitation.role)}</p>
      <p className="mt-2 text-sm text-[var(--muted)]">Your personal workspace stays separate. Files you contribute remain in this shared workspace if you leave.</p>
      <button className="entry-primary mt-4" disabled={!!joiningId} onClick={() => void joinInvitedWorkspace(invitation)} aria-label={`Join shared workspace ${invitation.spaceName}`}>{joiningId === invitation.id ? "Joining..." : "Join shared workspace"}</button>
    </article>)}
  </section>;
}
