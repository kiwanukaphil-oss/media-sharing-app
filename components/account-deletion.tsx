"use client";

import { useState } from "react";
import { useActionConfirmation } from "./action-confirmation";

type Review = { request: { id: string; requestedAt: number; status: string } | null;
  ownershipBlockers: { id: string; name: string }[]; recentSignIn: boolean };

// Deletion is an explicit review request, not a misleading promise of immediate erasure from retained backups.
export default function AccountDeletion() {
  const [review, setReview] = useState<Review | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { confirm, confirmation } = useActionConfirmation();
  async function updateReview(method = "GET", id?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/auth/deletion${id ? `/${id}` : ""}`, { method, cache: "no-store",
        headers: method === "POST" ? { "X-Relay-Confirm": "request-account-deletion" } : {} });
      const data = await response.json() as Review & { error?: string };
      if (!response.ok) {
        if ([401, 403].includes(response.status)) setReview(null);
        throw new Error(data.error || "The request could not be completed.");
      }
      setReview(data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Please retry."); }
    finally { setBusy(false); }
  }

  // Confirmation explains retained shared copies and the operator review, with no invisible access change.
  async function confirmDeletionRequest() {
    if (!await confirm({ title: "Request account deletion?", action: "Submit request", destructive: true,
      description: "Relay's operator will review removal of your account and personal files, including retained backups. Your account stays active until the request is processed. Shared uploads and published copies stay with their libraries. This request does not erase anything immediately; you can withdraw it here while it is awaiting review." })) return;
    await updateReview("POST");
  }

  const pending = review?.request && ["pending", "review_required"].includes(review.request.status);
  return <section className="mt-10 border-t border-[var(--line)] pt-7" aria-label="Account deletion">
    <h2 className="font-semibold">Account deletion</h2><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Review what happens to your personal files and shared libraries before requesting deletion.</p>
    <button disabled={busy} className="mt-2 min-h-11 text-sm underline" onClick={() => void updateReview()}>Review deletion &amp; request status</button>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {review && <div className="mt-4 rounded-2xl border border-[var(--line)] p-5">
      {pending ? <><p role="status" className="font-medium">{review.request!.status === "review_required" ? "Request needs renewed operator review" : "Deletion request awaiting review"}</p><p className="mt-2 text-sm leading-6 text-[var(--muted)]">Requested {new Date(review.request!.requestedAt).toLocaleDateString()}. Your account is still active. No files have been erased by this request. Relay&apos;s operator must verify removal from live storage and retained backups before marking it complete.</p><button disabled={busy} className="account-secondary-action mt-4 min-h-11 rounded-lg px-3 text-sm" onClick={() => void updateReview("DELETE", review.request!.id)}>Withdraw request</button></>
        : <><p className="text-sm leading-6 text-[var(--muted)]">Download any personal files you want to keep first. Shared uploads and published copies stay with their libraries. Trash has no automatic expiry, and backups currently retain all versions; deletion needs operator review, including those backups. Submitting a request does not immediately delete your account or files.</p>
          {review.request?.status === "withdrawn" && <p role="status" className="mt-3 text-sm">Your previous request was withdrawn.</p>}
          {review.ownershipBlockers.length > 0 && <div className="mt-4"><p className="text-sm">Hand over ownership before requesting deletion:</p><ul className="mt-2 space-y-2">{review.ownershipBlockers.map(space => <li key={space.id}><a className="break-words text-sm underline" href={`/people?space=${encodeURIComponent(space.id)}`}>{space.name}</a></li>)}</ul><p className="mt-2 text-xs leading-5 text-[var(--muted)]">Each shared library needs another account owner. Your personal space does not need a handover.</p></div>}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- OIDC requires a full navigation; never prefetch a login transaction. */}
          {!review.recentSignIn && <p className="mt-4 text-sm">For your security, <a className="underline" href="/api/auth/login?session=temporary">sign in again</a>, then return to this review.</p>}
          <button disabled={busy || !review.recentSignIn || review.ownershipBlockers.length > 0} className="mt-4 min-h-11 text-sm text-red-800 disabled:opacity-40" onClick={() => void confirmDeletionRequest()}>Request account deletion</button>
        </>}
    </div>}{confirmation}
  </section>;
}
