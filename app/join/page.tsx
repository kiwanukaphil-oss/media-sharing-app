"use client";

import { useEffect, useState } from "react";
import AccountInvitation from "@/components/account-invitation";
import { EntryFrame } from "@/components/relay-entry";
import { requestJson } from "@/lib/api-client";

// Keep joining focused on the invitation, including the return from email verification.
export default function JoinWorkspacePage() {
  const [identity, setIdentity] = useState<{ enabled: boolean; account: { sessionId: string; verifiedEmail: string } | null }>();
  const [failure, setFailure] = useState("");
  const [signin, setSignin] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Read callback context only in the browser.
    setSignin(new URLSearchParams(location.search).get("signin") || "");
    void requestJson<NonNullable<typeof identity>>("auth/session", { signal: controller.signal, cache: "no-store" })
      .then(result => { if (!controller.signal.aborted) { setIdentity(result); setFailure(""); } })
      .catch(error => { if (!controller.signal.aborted) setFailure(error instanceof Error ? error.message : "Your account could not be checked."); });
    return () => controller.abort();
  }, [revision]);
  return <EntryFrame><main className="invitation-arrival">
    {signin && <div className="entry-error" role="alert">{signin === "verify-email" ? "Check your inbox for the verification email (including spam). Follow its verification link, then return here and choose Sign in. Your invitation is saved in this tab." : "Sign-in was interrupted. Your invitation is saved; choose Sign in to try again."}</div>}
    {failure ? <div role="alert">{failure}<button className="entry-secondary" onClick={() => setRevision(value => value + 1)}>Try again</button></div> : identity ? identity.enabled ? <AccountInvitation standalone sessionId={identity.account?.sessionId} email={identity.account?.verifiedEmail} /> : <p role="alert">Account access is temporarily unavailable. Keep your invitation link and try again later.</p> : <p role="status">Opening your invitation...</p>}
  </main></EntryFrame>;
}
