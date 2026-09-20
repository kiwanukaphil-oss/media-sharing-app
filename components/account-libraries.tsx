"use client";

import { useEffect, useState } from "react";
import { requestJson } from "@/lib/api-client";

type AccountSpace = { id: string; name: string; role: string };
type ClaimPreview = { token: string; spaceName: string; deviceName: string; accountEmail: string; expiresAt: number };

// An explicit preview binds the named library and signed-in account before any ownership is added.
export default function AccountLibraries() {
  const [spaces, setSpaces] = useState<AccountSpace[]>([]);
  const [preview, setPreview] = useState<ClaimPreview | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void requestJson<{ spaces: AccountSpace[] }>("auth/spaces", { signal: controller.signal })
      .then(result => { setSpaces(result.spaces); setLoaded(true); })
      .catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Libraries could not be loaded."); });
    return () => controller.abort();
  }, []);

  // A failed or expired confirmation is discarded; retry starts with a fresh authority preview.
  async function connectOwnedLibrary(confirm: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (!confirm) {
        setPreview(await requestJson<ClaimPreview>("auth/owner-claim", { method: "POST" }));
      } else {
        if (!preview) return;
        await requestJson("auth/owner-claim/confirm", { method: "POST", headers: { "X-Relay-Claim": preview.token } });
        setPreview(null);
        setNotice("Library connected to your account.");
        const result = await requestJson<{ spaces: AccountSpace[] }>("auth/spaces");
        setSpaces(result.spaces); setLoaded(true);
      }
    } catch (failure) {
      setPreview(null);
      setError(failure instanceof Error ? failure.message : "This library could not be connected. Please retry.");
    } finally { setBusy(false); }
  }

  return <section className="mt-10" aria-labelledby="account-libraries-heading">
    <h2 id="account-libraries-heading" className="text-lg font-semibold">Your libraries</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">Connect a library you already own to your verified account. Its files and existing audience stay in place.</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-4 text-sm text-[var(--green)]">{notice}</p>}
    {spaces.length > 0 && <ul className="mt-5 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)] px-5">
      {spaces.map(space => <li key={space.id} className="flex justify-between gap-4 py-4 text-sm"><span>{space.name}</span><span className="text-[var(--muted)]">{space.role === "owner" ? "Owner" : "Member"}</span></li>)}
    </ul>}
    {loaded && spaces.length === 0 && <p className="mt-4 text-sm text-[var(--muted)]">No libraries connected yet.</p>}
    {preview ? <div className="mt-5 rounded-2xl border border-[var(--line)] bg-[var(--surface)] p-6" aria-label="Review library connection">
      <h3 className="font-semibold">Connect {preview.spaceName}?</h3>
      <p className="mt-3 break-words text-sm leading-6">{preview.accountEmail} will become an owner of this library, using your current owner access from {preview.deviceName}.</p>
      <p className="mt-3 text-sm leading-6 text-[var(--muted)]">This does not make the library private or connect other people’s devices to your account.</p>
      <div className="mt-5 flex flex-wrap gap-3"><button disabled={busy} className="account-primary-action min-h-11 rounded-xl bg-[var(--accent)] px-4 text-sm font-medium text-white" onClick={() => void connectOwnedLibrary(true)}>{busy ? "Connecting…" : "Confirm connection"}</button><button disabled={busy} className="min-h-11 rounded-xl px-4 text-sm" onClick={() => setPreview(null)}>Cancel</button></div>
    </div> : <button disabled={busy} className="account-secondary-action mt-5 min-h-11 rounded-xl border border-[var(--line)] px-4 text-sm font-medium" onClick={() => void connectOwnedLibrary(false)}>{busy ? "Checking access…" : "Connect an existing library"}</button>}
  </section>;
}
