"use client";

import { useState } from "react";
import { Monitor, Unplug } from "lucide-react";
import type { createLibraryApi } from "@/lib/api-client";
import { useActionConfirmation } from "./action-confirmation";

type Device = { id: string; name: string; role: string; linkedPerson: string | null; expiresAt: number };
type Inventory = { devices: Device[]; total: number };

// Owners review the actual legacy audience without guessing identity from device names.
export default function LegacyAccessReview({ api, count, onChanged }: {
  api: ReturnType<typeof createLibraryApi>; count: number; onChanged: () => Promise<unknown>;
}) {
  const [inventory, setInventory] = useState<Inventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const { confirm, confirmation } = useActionConfirmation();
  async function loadInventory() {
    setBusy(true); setError("");
    try { setInventory(await api.requestJson<Inventory>("legacy-devices")); }
    catch (failure) { setInventory(null); setError(failure instanceof Error ? failure.message : "Devices could not be loaded."); }
    finally { setBusy(false); }
  }

  // Account ownership remains intact, so ending the last paired owner never strands this library.
  async function revokeDevices(device: Device | null) {
    if (!await confirm({ title: device ? `Disconnect ${device.name}?` : "End all paired-device access?", destructive: true,
      action: device ? "Disconnect device" : "End paired access", description: `${device ? "This paired device loses" : "All paired devices lose"} access, including native apps. Unused pairing links from these devices stop working. Your account and library members keep access, and shared files stay. Downloaded copies and issued download links cannot be recalled. Sign in with an authorised account to reconnect on the web.` })) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api.requestJson(`legacy-devices/${device?.id || "all"}`, { method: "DELETE", body: JSON.stringify({ confirmed: true }) });
      setInventory(await api.requestJson<Inventory>("legacy-devices"));
      setNotice(device ? "Device disconnected. Shared files are preserved." : "Paired-device access ended. Account access and shared files are preserved.");
      await onChanged();
    } catch (failure) { setInventory(null); setError(failure instanceof Error ? failure.message : "Access could not be changed. Refresh and try again."); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-2xl border border-[var(--line)] p-5" aria-label="Paired device access">
    <h2 className="flex items-center gap-2 font-semibold"><Monitor size={18} /> Paired devices</h2>
    <p className="mt-2 text-sm leading-6 text-[var(--muted)]">{inventory?.total ?? count} legacy paired device{(inventory?.total ?? count) === 1 ? " also has" : "s also have"} access. Paired access works separately from account sign-in. Device names do not prove who uses them.</p>
    <button className="account-secondary-action mt-3 min-h-11 rounded-lg px-3 text-xs" disabled={busy} onClick={() => void loadInventory()}>{inventory ? "Refresh devices" : "Review devices"}</button>
    {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="mt-3 text-sm">{notice}</p>}
    {inventory && <>
      {inventory.total > inventory.devices.length && <p className="mt-3 text-xs text-[var(--muted)]">Showing the first {inventory.devices.length} of {inventory.total}. Disconnect reviewed devices and refresh to see more.</p>}
      <ul className="mt-3 divide-y divide-[var(--line)]">{inventory.devices.map(device => <li key={device.id} className="flex items-center justify-between gap-3 py-4">
        <div className="min-w-0"><p className="break-words text-sm font-medium">{device.name}</p><p className="mt-1 break-words text-xs leading-5 text-[var(--muted)]">{device.role === "owner" ? "Owner" : "Member"} · {device.linkedPerson ? `Claimed by ${device.linkedPerson}` : "Not linked to an account"}</p></div>
        <button disabled={busy} aria-label={`Disconnect ${device.name}`} title="Disconnect device" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-red-800 hover:bg-[var(--surface)]" onClick={() => void revokeDevices(device)}><Unplug size={17} /></button>
      </li>)}</ul>
      {inventory.total > 0 ? <div className="mt-4 border-t border-[var(--line)] pt-4"><p className="text-xs leading-5 text-[var(--muted)]">When everyone can sign in with an account, end paired access to make membership the only way into this library. Native apps still using pairing will lose access.</p><button disabled={busy} className="mt-2 min-h-11 text-sm text-red-800" onClick={() => void revokeDevices(null)}>End all paired-device access</button></div>
        : <p className="mt-3 text-sm">Only current library members have access through Relay.</p>}
    </>}{confirmation}
  </section>;
}
