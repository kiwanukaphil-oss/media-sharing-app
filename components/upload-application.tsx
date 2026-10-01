"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowUp, Check, ChevronDown, FileImage, Pause, Play, RefreshCw, X } from "lucide-react";
import { requestJson, RequestError } from "@/lib/api-client";
import { formatBytes, type Session } from "@/lib/contracts";
import { runningUploadStates, uploadManager } from "@/lib/upload-manager";
import type { Transfer } from "@/lib/transfers";
import { PresentationShield } from "./presentation-shield";
import { useActionConfirmation } from "./action-confirmation";

export const useUploads = () => useSyncExternalStore(uploadManager.subscribe, uploadManager.snapshot, uploadManager.serverSnapshot);
const labels: Record<Transfer["state"], string> = { queued: "Queued", preparing: "Preparing original", sending: "Uploading", finalizing: "Finishing upload", paused: "Paused", offline: "Waiting for connection", elsewhere: "Uploading in another tab", "needs-access": "File access needed", "needs-file": "Original needed", error: "Needs attention", complete: "Uploaded" };
const needsAttention = (job: Transfer) => ["error", "needs-file", "needs-access"].includes(job.state);

// Keep session-owned uploads and private UI alive across app routes, while preserving ordinary external links.
export function UploadApplication({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  useEffect(() => {
    let disposed = false;
    const authenticate = async () => {
      try {
        const { spaces } = await requestJson<{ spaces: { id: string; actorId?: string; role: string }[] }>("auth/spaces");
        if (!disposed) await uploadManager.authorize(spaces, "account");
      } catch (failure) {
        if (!(failure instanceof RequestError && [401, 404].includes(failure.status))) return;
        if (!disposed) await uploadManager.authorize([], "account");
        try { const session = await requestJson<Session>("session"); if (!disposed) await uploadManager.registerSession(session); }
        catch (legacyFailure) { if (!disposed && legacyFailure instanceof RequestError && legacyFailure.status === 401) await uploadManager.signOut(); }
      }
    };
    void authenticate();
    const timer = setInterval(() => { void authenticate(); }, 60000);
    const transfers = setInterval(() => uploadManager.refreshElsewhere(), 10000);
    const appNavigate = (event: Event) => {
      const { path, replace } = (event as CustomEvent<{ path: string; replace: boolean }>).detail;
      if (replace) router.replace(path); else router.push(path);
    };
    const online = () => uploadManager.connectionChanged();
    const warn = (event: BeforeUnloadEvent) => {
      if (uploadManager.snapshot().some(job => runningUploadStates.includes(job.state))) { event.preventDefault(); event.returnValue = ""; }
    };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.download || anchor.target || anchor.hasAttribute("data-full-navigation")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin !== location.origin || !["/", "/account", "/workspaces", "/people", "/uploads", "/collect", "/delivery", "/join"].includes(url.pathname)) return;
      event.preventDefault(); router.push(url.pathname + url.search + url.hash);
    };
    window.addEventListener("online", online); window.addEventListener("offline", online); window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate);
    window.addEventListener("relay-navigate", appNavigate);
    return () => { disposed = true; clearInterval(timer); clearInterval(transfers); window.removeEventListener("online", online); window.removeEventListener("offline", online); window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigate); window.removeEventListener("relay-navigate", appNavigate); };
  }, [router, pathname]);
  return <PresentationShield>{children}<UploadIndicator /></PresentationShield>;
}

// Details are opt-in; neither restore, new jobs nor errors can expand the panel or steal focus.
function UploadIndicator() {
  const jobs = useUploads();
  const pathname = usePathname();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const closer = useRef<HTMLButtonElement>(null);
  const previousPath = useRef(pathname);
  useEffect(() => {
    if (previousPath.current !== pathname) { previousPath.current = pathname; setExpanded(false); }
  }, [pathname]);
  useEffect(() => { if (expanded) closer.current?.focus(); }, [expanded]);
  useEffect(() => {
    // The external queue can become empty after asynchronous cleanup; reset its previous presentation.
    if (!jobs.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the external queue's empty lifecycle.
      setExpanded(false);
    }
  }, [jobs.length]);
  const close = () => { setExpanded(false); trigger.current?.focus(); };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !document.querySelector("dialog[open]")) { setExpanded(false); trigger.current?.focus(); } };
    if (expanded) document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [expanded]);
  if (!jobs.length || pathname === "/uploads") return null;
  const completed = jobs.filter(job => job.state === "complete").length;
  const attention = jobs.filter(needsAttention).length;
  const active = jobs.some(job => runningUploadStates.includes(job.state));
  const label = attention ? `${attention} need attention` : active ? `${completed} of ${jobs.length} uploaded` : completed === jobs.length ? `${completed} uploaded` : jobs.some(job => job.state === "offline") ? "Waiting for connection" : "Paused";
  return <div className="upload-center">
    {expanded && <section className="upload-drawer" aria-label="Upload details"><header><h2>Uploads</h2><button ref={closer} className="upload-icon" aria-label="Hide upload details" onClick={close}><X size={20} /></button></header><UploadList compact /><Link className="upload-view-all" href="/uploads" onClick={() => setExpanded(false)}>View all uploads</Link></section>}
    <button ref={trigger} className={`upload-indicator${attention ? " attention" : ""}`} aria-label={`Uploads: ${label}`} aria-expanded={expanded} onClick={() => { if (matchMedia("(max-width:600px)").matches) router.push("/uploads"); else setExpanded(value => !value); }}><ArrowUp size={18} /><span>{label}</span><ChevronDown size={15} /></button>
    {completed === jobs.length && <button className="upload-clear-compact" aria-label="Clear completed uploads" title="Clear completed uploads" onClick={() => void uploadManager.clearCompleted()}><X size={17} /></button>}
  </div>;
}

// Render a bounded slice of long queues; aggregate progress still includes every original.
export function UploadList({ compact = false }: { compact?: boolean }) {
  const jobs = useUploads();
  const [limit, setLimit] = useState(30);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const replacementId = useRef<string | null>(null);
  const { confirm, confirmation } = useActionConfirmation();
  const total = jobs.reduce((sum, job) => sum + job.size, 0);
  const sent = jobs.reduce((sum, job) => sum + (job.state === "complete" ? job.size : job.sentBytes ?? job.size * job.progress / 100), 0);
  const completed = jobs.filter(job => job.state === "complete").length;
  const attention = jobs.filter(needsAttention).length;
  const active = jobs.some(job => runningUploadStates.includes(job.state));
  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true); setMessage("");
    try { await operation(); } catch (failure) { setMessage(failure instanceof Error ? failure.message : "Please try again."); }
    finally { setBusy(false); }
  };
  const speed = jobs.find(job => job.state === "sending")?.bytesPerSecond;
  async function cancelJobs(selected: Transfer[]) {
    if (!await confirm({ title: selected.length === 1 ? "Cancel this upload?" : "Cancel unfinished uploads?", description: "Unfinished progress will be discarded. Uploaded files and device originals stay safe.", action: "Cancel upload", destructive: true })) return;
    await run(async () => { for (const job of selected) await uploadManager.cancel(job.id); });
  }
  async function restartJob(job: Transfer) {
    if (await confirm({ title: "Restart this upload?", description: "Saved parts will be replaced. The original must be sent again.", action: "Restart upload" })) await run(() => uploadManager.restart(job.id));
  }
  async function chooseReplacement(job: Transfer) {
    if (await confirm({ title: "Choose the original again?", description: "This upload stopped before its identity was recorded. Confirm the correct original when selecting it.", action: "Choose original" })) { replacementId.current = job.id; picker.current?.click(); }
  }
  if (!jobs.length) return <div className="upload-empty"><Check size={26} /><h2>No uploads</h2><p>New uploads will appear here.</p><Link href="/workspaces">Browse workspaces</Link></div>;
  return <>
    <div className="upload-summary"><strong>{completed === jobs.length ? "All files delivered" : `${completed} of ${jobs.length} uploaded`}{attention > 0 && ` · ${attention} need attention`}</strong><progress max={Math.max(total, 1)} value={sent} aria-label="Total upload progress" /><span>{formatBytes(sent)} of {formatBytes(total)}{speed && speed > 0 ? ` · ${formatBytes(speed)}/s · about ${Math.max(1, Math.ceil((total - sent) / speed / 60))} min left` : ""}</span>
      <div className="upload-controls">
        {active && <button disabled={busy} onClick={() => jobs.filter(job => runningUploadStates.includes(job.state)).forEach(job => uploadManager.pause(job.id))}>Pause all</button>}
        {jobs.some(job => ["paused", "offline", "error"].includes(job.state)) && <button disabled={busy} onClick={() => void run(async () => { for (const job of jobs.filter(entry => ["paused", "offline", "error"].includes(entry.state))) await uploadManager.resume(job.id); })}>Resume available</button>}
        {jobs.some(job => job.state === "needs-file" && job.hash) && <button disabled={busy} onClick={() => { replacementId.current = null; picker.current?.click(); }}>Locate originals</button>}
        {jobs.some(job => !["complete", "elsewhere"].includes(job.state)) && <button disabled={busy} onClick={() => void cancelJobs(jobs.filter(job => !["complete", "elsewhere"].includes(job.state)))}>Cancel unfinished</button>}
        {completed > 0 && <button disabled={busy} onClick={() => void run(() => uploadManager.clearCompleted())}>Clear completed</button>}
      </div>
    </div>
    <input ref={picker} type="file" multiple className="visually-hidden" aria-label="Locate original files" onChange={event => { const selected = Array.from(event.target.files || []); event.target.value = ""; if (!selected.length) return; void run(async () => { if (replacementId.current) await uploadManager.replaceUnstartedOriginal(replacementId.current, selected[0]); else { const matched = await uploadManager.locateOriginals(selected); setMessage(`${matched} matched${selected.length > matched ? " · Some originals did not match" : ""}`); } }); }} />
    {busy && <p className="upload-message" role="status">Checking uploads…</p>}{message && <p className="upload-message" role="status">{message}</p>}
    <div className="upload-rows">{jobs.slice(0, compact ? 5 : limit).map(job => <article key={job.id} className="transfer-row upload-row"><FileImage size={20} /><div className="transfer-information"><strong>{job.name}</strong><p>{[job.spaceName || "Library", job.albumName, job.sectionName].filter(Boolean).join(" / ")}</p><div><span>{labels[job.state]}</span><span>{job.state === "preparing" ? `${job.preparationProgress ?? 0}%` : formatBytes(job.size)}</span></div><progress max={100} value={job.state === "preparing" ? job.preparationProgress ?? 0 : job.progress} aria-label={`${job.name} progress`} />{job.message && <p>{job.message}</p>}
      {job.state !== "complete" && <p className="upload-recovery">{job.storageWarning ? "Progress is saved in this tab only" : job.recovery === "copy" ? "Recovery copy saved on this device" : job.recovery === "handle" ? "File access remembered" : "Keep this tab open · Originals may be needed after reload"}</p>}
      <div className="upload-controls">
        {runningUploadStates.includes(job.state) ? <button disabled={busy} aria-label={`Pause ${job.name}`} onClick={() => uploadManager.pause(job.id)}><Pause size={14} />Pause</button> : job.state === "complete" ? <Link href={`/?${new URLSearchParams({ ...(job.accountSpaceId ? { space: job.accountSpaceId } : { device: "1" }), ...(job.albumId ? { album: job.albumId } : { view: "files" }) })}`}>Open destination</Link> : <>
          {job.state === "needs-access" ? <button disabled={busy} onClick={() => void run(() => uploadManager.allowAccess(job.id))}>Allow file access</button> : job.state === "needs-file" ? <button disabled={busy} onClick={() => { if (!job.hash) void chooseReplacement(job); else { replacementId.current = null; picker.current?.click(); } }}>Choose original{job.hash ? "s" : ""}</button> : <button disabled={busy} aria-label={`Resume ${job.name}`} onClick={() => void run(() => uploadManager.resume(job.id))}><Play size={14} />{job.state === "elsewhere" ? "Check status" : "Resume"}</button>}
          {job.state === "error" && job.uploadId && <button disabled={busy} aria-label={`Restart ${job.name}`} onClick={() => void restartJob(job)}><RefreshCw size={14} />Restart</button>}
        </>}
        {!["complete", "elsewhere"].includes(job.state) && <button disabled={busy} aria-label={`Cancel ${job.name}`} onClick={() => void cancelJobs([job])}>Cancel</button>}
      </div></div></article>)}</div>
    {!compact && jobs.length > limit && <button className="upload-more" onClick={() => setLimit(value => value + 30)}>Show more uploads</button>}
    {completed < jobs.length && <p className="upload-footnote">Browse Relay while uploading. Closing this tab or locking your phone can interrupt uploads.</p>}{confirmation}
  </>;
}
