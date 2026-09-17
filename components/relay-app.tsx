"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated thumbnails and local QR data URLs must bypass public image optimizers. */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ImagePlus and Send are retained removal candidates from the earlier UI.
import { ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, Clapperboard, Copy, FileImage, FileVideo, FolderDown, Grid2X2, ImagePlus, Laptop, Link2, LoaderCircle, MonitorSmartphone, Pause, Play, Plus, Radio, RefreshCw, Send, ShieldCheck, Smartphone, Upload, X } from "lucide-react";
import QRCode from "qrcode";
import { requestJson, RequestError } from "@/lib/api-client";
import { formatBytes, MAX_FILE_SIZE, type Category, type Device, type MediaItem, type Session, type FeedPage, type StorageUsage } from "@/lib/contracts";
import { persistTransfer, restoreTransfers, forgetTransfer, uploadOriginal, type Transfer } from "@/lib/transfers";
import { saveVerifiedOriginal, supportsVerifiedSave } from "@/lib/downloads";

type Filter = "all" | Category | "trash";
type Modal = "devices" | "help" | "storage" | MediaItem | null;
const statusLabels = { queued: "Waiting to send", preparing: "Checking original", sending: "Sending", paused: "Paused", "needs-file": "Ready to resume", error: "Transfer interrupted", complete: "Available to everyone" };
type RelayModelContext = { registerTool: (tool: { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };

// Native dialog supplies focus containment, Escape handling, and a modal accessibility tree.
function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} onClose={onClose} className="modal" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

function MediaPreview({ item, large = false }: { item: MediaItem; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const photo = /^image\/(jpeg|png|webp|gif|avif)$/.test(item.mime);
  if (!failed && ((large && photo) || item.hasPreview)) return <img loading="lazy" decoding="async" onError={() => setFailed(true)} src={`/api/media/${item.id}/${large ? "preview" : "thumbnail"}`} alt={item.name} className="media-image" />;
  if (!failed && large && /^video\/(mp4|webm|quicktime)$/.test(item.mime)) return <video controls playsInline preload="metadata" onError={() => setFailed(true)} src={`/api/media/${item.id}/preview`} className="media-image" />;
  const Icon = item.mime.startsWith("video/") ? FileVideo : FileImage;
  return <div className={`file-preview ${item.mime.startsWith("video/") ? "video-preview" : "raw-preview"}`}><Icon size={large ? 56 : 38} strokeWidth={1.2} /><span>{item.name.split(".").pop()?.toUpperCase() || "ORIGINAL"}</span></div>;
}

// The working surface shares one durable feed; browser storage tracks only this device's queue.
export default function RelayApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [counts, setCounts] = useState({ all: 0, original: 0, final: 0, trash: 0 });
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [storage, setStorage] = useState<StorageUsage | null>(null);
  const [online, setOnline] = useState(true);
  const [inviteExpiresAt, setInviteExpiresAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [download, setDownload] = useState<{ id: string; name: string; progress: number; controller: AbortController } | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [modal, setModal] = useState<Modal>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [invitation, setInvitation] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [qr, setQr] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [canCreateSpace, setCanCreateSpace] = useState(false);
  const [verifiedSaveAvailable, setVerifiedSaveAvailable] = useState(false);
  const [savingVerified, setSavingVerified] = useState(false);
  const [deviceName, setDeviceName] = useState("My desktop");
  const [spaceName, setSpaceName] = useState("Our shared space");
  const fileInput = useRef<HTMLInputElement>(null);
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeTarget = useRef<Transfer | null>(null);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const serialQueue = useRef<Promise<unknown>>(Promise.resolve());
  const transferTasks = useRef(new Map<string, Promise<unknown>>());
  const runningTransfers = useRef(new Set<string>());
  const cancelledTransfers = useRef(new Set<string>());
  const dragDepth = useRef(0);
  const feedQuery = useRef("category=all");
  const pageDepth = useRef(1);
  const feedRevision = useRef(0);

  // Refresh every loaded page with stable cursors, keeping filters and cross-device changes consistent.
  const refreshFeed = useCallback(async () => {
    const revision = ++feedRevision.current;
    let cursor: string | null = null; const collected: MediaItem[] = []; let result: FeedPage;
    for (let page = 0; page < pageDepth.current; page++) {
      result = await requestJson<FeedPage>(`feed?${feedQuery.current}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      collected.push(...result.items); cursor = result.nextCursor;
      if (!cursor) break;
    }
    if (revision !== feedRevision.current) return;
    setItems(collected); setCounts(result!.counts); setTotal(result!.total); setNextCursor(cursor); setOnline(true);
  }, []);
  async function loadMore() {
    setFeedBusy(true); pageDepth.current++;
    try { await refreshFeed(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't load more files."); }
    finally { setFeedBusy(false); }
  }
  const refreshStorage = useCallback(async () => { setStorage(await requestJson<StorageUsage>("storage")); }, []);
  const refreshDevices = useCallback(async () => {
    const result = await requestJson<{ devices: Device[] }>("devices");
    setDevices(result.devices);
  }, []);
  // Recover the paired session and unfinished manifests without creating a space implicitly.
  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/session");
      if (response.status === 401) {
        setSession(null);
        const access = await requestJson<{ canCreateSpace: boolean }>("access");
        setCanCreateSpace(access.canCreateSpace);
        return;
      }
      const body = await response.json() as Session & { error?: string };
      if (!response.ok) throw new Error(body.error);
      const current = body as Session;
      setSession(current);
      await Promise.all([refreshFeed(), refreshDevices(), refreshStorage()]);
      setTransfers(await restoreTransfers(current.deviceId));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't open this space."); }
    finally { setLoading(false); }
  }, [refreshDevices, refreshFeed, refreshStorage]);

  /* eslint-disable react-hooks/set-state-in-effect -- Pairing fragments and browser capabilities must be read after hydration. */
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("join");
    if (token) { setInvitation(token); history.replaceState(null, "", location.pathname); }
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) setDeviceName("My phone");
    setVerifiedSaveAvailable(supportsVerifiedSave());
    void loadSession();
    const active = controllers.current;
    return () => { active.forEach(controller => controller.abort()); };
  }, [loadSession]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshFeed().catch(failure => {
      setOnline(false);
      if (failure instanceof RequestError && failure.status === 401) { setSession(null); setItems([]); setError(failure.message); }
    }); }, 10000);
    return () => clearInterval(timer);
  }, [session, refreshFeed]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      feedQuery.current = new URLSearchParams({ category: filter, q: search }).toString();
      pageDepth.current = 1; setFeedBusy(true);
      void refreshFeed().catch(failure => setError(failure.message)).finally(() => setFeedBusy(false));
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [filter, search, session, refreshFeed]);
  useEffect(() => {
    const update = () => { setOnline(navigator.onLine); if (navigator.onLine && session) void refreshFeed().catch(() => {}); };
    window.addEventListener("online", update); window.addEventListener("offline", update);
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); clearInterval(timer); };
  }, [session, refreshFeed]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4500); return () => clearTimeout(timer); }, [notice]);
  // Expose the same authorized feed to supporting agents without granting filesystem access.
  useEffect(() => {
    const context = (document as Document & { modelContext?: RelayModelContext }).modelContext;
    if (!session || !context?.registerTool) return;
    const lifecycle = new AbortController();
    void Promise.resolve(context.registerTool({
      name: "list_shared_media", description: "List available original files or final cuts in the connected Relay space.",
      inputSchema: { type: "object", properties: { category: { type: "string", enum: ["all", "original", "final"] } }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute(input) {
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => key !== "category")) throw new Error("Expected an optional category only.");
        const category = "category" in input ? input.category : "all";
        if (!["all", "original", "final"].includes(String(category))) throw new Error("Unknown file category.");
        const result = await requestJson<{ items: MediaItem[] }>("feed");
        return { items: result.items.filter(item => category === "all" || item.category === category) };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, [session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (controllers.current.size || savingVerified) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [savingVerified]);

  // Pairing is an explicit one-time action; a join link never silently changes an existing space.
  async function connectSpace(event: React.FormEvent) {
    event.preventDefault(); setConnecting(true); setError("");
    try {
      await requestJson("connect", { method: "POST", body: JSON.stringify({ name: deviceName, spaceName, ...(invitation ? { invitation } : {}) }) });
      setInvitation(""); await loadSession();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't connect this device."); }
    finally { setConnecting(false); }
  }
  function updateTransfer(next: Transfer) {
    setTransfers(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next]);
  }
  // Serialize files to bound memory; each file resumes from its persisted completed parts.
  function scheduleTransfer(file: File, transfer: Transfer) {
    if (controllers.current.has(transfer.id)) return;
    files.current.set(transfer.id, file);
    const controller = new AbortController();
    controllers.current.set(transfer.id, controller);
    updateTransfer({ ...transfer, state: "queued", message: undefined });
    serialQueue.current = serialQueue.current.catch(() => {}).then(async () => {
      try {
        if (cancelledTransfers.current.has(transfer.id)) return;
        runningTransfers.current.add(transfer.id);
        const completed = await uploadOriginal(file, transfer, controller.signal, updateTransfer);
        if (completed.state === "needs-file") files.current.delete(transfer.id);
        if (completed.state === "complete") { files.current.delete(transfer.id); await Promise.all([refreshFeed(), refreshStorage()]); }
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't save transfer progress."); }
      finally { controllers.current.delete(transfer.id); runningTransfers.current.delete(transfer.id); transferTasks.current.delete(transfer.id); }
    });
    transferTasks.current.set(transfer.id, serialQueue.current);
  }
  // Persist source manifests before queueing so reloads can recover unfinished work.
  async function selectOriginals(selected: FileList | File[]) {
    if (!session) return;
    for (const file of Array.from(selected)) {
      if (!file.size || file.size > MAX_FILE_SIZE) { setError(`${file.name}: choose a file between 1 byte and 100 GB.`); continue; }
      const transfer: Transfer = { id: crypto.randomUUID(), deviceId: session.deviceId, name: file.name, size: file.size, mime: file.type || "application/octet-stream", category: filter === "final" ? "final" : "original", parts: [], state: "queued", progress: 0 };
      try { await persistTransfer(transfer); scheduleTransfer(file, transfer); }
      catch { setError("Allow browser storage before sending, so interrupted transfers can resume."); }
    }
  }
  function resumeTransfer(transfer: Transfer) {
    const file = files.current.get(transfer.id);
    if (file) scheduleTransfer(file, transfer);
    else { resumeTarget.current = transfer; resumeInput.current?.click(); }
  }
  // The invitation is encoded locally so device credentials never reach a third-party QR service.
  async function createInvitation() {
    setInviteBusy(true); setError("");
    try {
      const { token, expiresAt } = await requestJson<{ token: string; expiresAt: number }>("invitations", { method: "POST" });
      setInviteExpiresAt(expiresAt);
      const link = `${location.origin}/#join=${token}`;
      setInviteLink(link);
      setQr(await QRCode.toDataURL(link, { width: 220, margin: 2, color: { dark: "#25243d", light: "#ffffff" } }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't create an invitation."); }
    finally { setInviteBusy(false); }
  }
  async function disconnectDevice(id: string) {
    try { await requestJson(`devices/${id}`, { method: "DELETE" }); await refreshDevices(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't disconnect this device."); }
  }
  async function saveOriginal(item: MediaItem) {
    setModal(null);
    if (verifiedSaveAvailable) { await saveAsOriginal(item); return; }
    try {
      const link = document.createElement("a");
      link.href = `/api/media/${item.id}/download`; link.download = item.name;
      document.body.appendChild(link); link.click(); link.remove();
      setNotice("Download requested. Check your browser's downloads.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't start that download."); }
  }
  // Stream to the selected file, committing only verified bytes.
  async function saveAsOriginal(item: MediaItem) {
    if (savingVerified) return;
    const controller = new AbortController();
    setSavingVerified(true);
    setDownload({ id: item.id, name: item.name, progress: 0, controller });
    try { await saveVerifiedOriginal(item, { signal: controller.signal, onProgress: progress => setDownload(current => current ? { ...current, progress } : null) }); setNotice("Saved to your device. Original file verified."); }
    catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : "Couldn't save the file.");
    } finally { setSavingVerified(false); setDownload(null); }
  }
  // Trash is reversible; only the separate permanent-delete action removes stored originals.
  async function changeMedia(item: MediaItem, action: "archive" | "restore" | "delete") {
    if (action === "delete" && !window.confirm(`Permanently delete “${item.name}” from this shared space? Saved local copies are unaffected.`)) return;
    try {
      await requestJson(`media/${item.id}${action === "delete" ? "" : `/${action}`}`, { method: action === "delete" ? "DELETE" : "POST" });
      setModal(null); await Promise.all([refreshFeed(), refreshStorage()]);
      setNotice(action === "archive" ? "Moved to Trash. You can restore it anytime." : action === "restore" ? "Restored to the shared feed." : "Original permanently deleted from shared storage.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't update this file."); }
  }
  // Wait for active work to stop before releasing its reservation and local manifest.
  async function cancelUpload(id: string, name: string) {
    if (!window.confirm(`Cancel the unfinished upload “${name}”? The original on its device is unaffected.`)) return;
    try {
      controllers.current.get(id)?.abort();
      cancelledTransfers.current.add(id);
      if (runningTransfers.current.has(id)) await transferTasks.current.get(id)?.catch(() => {});
      try { await requestJson(`uploads/${id}`, { method: "DELETE" }); } catch (failure) { if (!(failure instanceof RequestError && failure.status === 404)) throw failure; }
      await forgetTransfer(id); files.current.delete(id); setTransfers(current => current.filter(item => item.id !== id));
      await refreshStorage(); setNotice("Unfinished upload cancelled.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't cancel this upload."); }
  }
  async function restartTransfer(transfer: Transfer) {
    if (!window.confirm(`Restart “${transfer.name}” from the beginning? Use this if its saved upload parts have expired.`)) return;
    try {
      const result = await requestJson<{ uploadId: string }>(`uploads/${transfer.id}/restart`, { method: "POST" });
      const restarted = { ...transfer, uploadId: result.uploadId, parts: [], progress: 0, state: "needs-file" as const, message: "Choose the original file to restart" };
      await persistTransfer(restarted); updateTransfer(restarted); resumeTransfer(restarted);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't restart this transfer."); }
  }
  const visibleItems = items;
  const activeTransfers = transfers.filter(item => item.state !== "complete");
  const originalCount = counts.original;
  const finalCount = counts.final;
  const pageTitle = filter === "all" ? "Shared drop zone" : filter === "original" ? "Originals" : filter === "trash" ? "Trash" : "Final cuts";
  const invitationRequired = !session && !invitation && !canCreateSpace;

  return <div className="app-shell" onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (session) void selectOriginals(event.dataTransfer.files); }}>
    <aside className="sidebar">
      <Link href="/" className="wordmark" aria-label="Relay home"><span className="brand-icon"><ArrowLeftRight size={22} strokeWidth={2.4} /></span>relay<span className="brand-dot">.</span></Link>
      <div className="space-label"><span className="space-avatar">{(session?.space.name || "Your space").slice(0, 1).toUpperCase()}</span><div><strong>{session?.space.name || "Your shared space"}</strong><span>{session ? "Connected workspace" : "A little less back and forth"}</span></div></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Shared media">
        <button className={`nav-item ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}><Grid2X2 size={18} />All files<span>{counts.all}</span></button>
        <button className={`nav-item ${filter === "original" ? "active" : ""}`} onClick={() => setFilter("original")}><FileImage size={18} />Originals<span>{originalCount}</span></button>
        <button className={`nav-item ${filter === "final" ? "active" : ""}`} onClick={() => setFilter("final")}><Clapperboard size={18} />Final cuts<span>{finalCount}</span></button>
      </nav>
      <button className={`nav-item ${filter === "trash" ? "active" : ""}`} onClick={() => setFilter("trash")}><FolderDown size={18} />Trash<span>{counts.trash}</span></button><button className="nav-item" disabled={!session} onClick={() => { setModal("storage"); void refreshStorage().catch(failure => setError(failure.message)); }}><ShieldCheck size={18} />Storage<span>{storage ? formatBytes(storage.used) : ""}</span></button><div className="nav-divider" />
      <button className="nav-item" disabled={!session} onClick={() => { setModal("devices"); void refreshDevices().catch(() => setError("Couldn't refresh connected devices.")); }}><MonitorSmartphone size={18} />Connected devices<span>{devices.length || "—"}</span></button>
      <div className="sidebar-bottom"><div className="quality-note"><ShieldCheck size={20} /><div><strong>Every detail, intact.</strong><p>Your files. Original quality.</p></div></div><button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={18} />How Relay works<ArrowUpRight size={15} /></button><div className="device-footer"><Laptop size={17} /><span>{devices.find(device => device.current)?.name || "This device"}</span><span className={`status-dot ${session ? "online" : ""}`} /></div></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>{filter === "all" ? "All files" : pageTitle}</strong></div><div className="topbar-right"><span className="connection"><span className={`status-dot ${session ? "online" : ""}`} />{session ? online ? "Connected" : "Reconnecting" : "Not paired"}</span><button className="button secondary compact" disabled={!session} onClick={() => setModal("devices")}><Plus size={16} />Pair a device</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span className="small-line" />LESS SENDING. MORE CREATING.</div><h1>{pageTitle}<span className="title-dot">.</span></h1><p>{filter === "final" ? "The finished work, ready for its next stop." : "From the shop floor to your next great idea."}</p></div><button className="button primary" disabled={!session || session.transport === "unconfigured"} onClick={() => fileInput.current?.click()}><Plus size={18} />{filter === "final" ? "Drop final cuts" : "Add files"}</button></div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
        {!online && session && <div className="error-banner" role="status">Connection interrupted. Your queue is retained; resume sending when you are back online.</div>}
        {session?.transport === "local" && <div className="local-note"><span className="status-dot" />Local workspace · files stay on this computer until hosting is connected.</div>}
        {session?.transport === "unconfigured" && <div className="error-banner">File transfers need their storage connection. Existing originals have not been changed.</div>}
        {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={25} /><p>Opening your space…</p></div> : invitationRequired ?
          <section className="welcome-panel"><div className="welcome-symbol"><Link2 size={32} /></div><span className="pill">YOUR FILES STAY IN YOUR CIRCLE</span><h2>Bring this device along.</h2><p>Open an invitation link or scan a code from a connected device.</p><button className="button secondary" onClick={() => setModal("help")}><CircleHelp size={17} />How Relay works</button><small>No passwords. No new accounts.</small></section> : !session ?
          <section className="welcome-panel"><div className="welcome-symbol"><ArrowLeftRight size={32} /></div><span className="pill">A SHARED SPACE, WITHOUT THE FUSS</span><h2>{invitation ? "You're one step away." : "Good work starts with a drop."}</h2><p>{invitation ? "Give this device a name. You'll stay connected." : "Connect once. Move photos and videos whenever you need."}</p><form onSubmit={connectSpace}>{!invitation && <label>Space name<input required maxLength={60} value={spaceName} onChange={event => setSpaceName(event.target.value)} /></label>}<label>This device<input required maxLength={60} value={deviceName} onChange={event => setDeviceName(event.target.value)} /></label><button className="button primary" disabled={connecting}>{connecting ? <LoaderCircle size={18} className="spin" /> : <ArrowUpRight size={18} />}{invitation ? "Join shared space" : "Create shared space"}</button></form><small>No passwords. No new accounts.</small></section> : <>
          <button className={`drop-zone ${dragging ? "dragging" : ""}`} disabled={session.transport === "unconfigured"} onClick={() => fileInput.current?.click()}><span className="drop-icon"><Upload size={25} strokeWidth={1.6} /></span><span className="drop-copy"><strong>Drop it here. Pick it up anywhere.</strong><span>Drag photos and videos here, or <b>browse files</b></span></span><span className="drop-quality"><ShieldCheck size={15} />Original files, always</span></button>
          <div className="web-tools"><label className="search-field"><span className="visually-hidden">Search filenames</span><input type="search" placeholder="Find a file…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className="button secondary compact" onClick={() => { setModal("storage"); void refreshStorage().catch(failure => setError(failure.message)); }}>Storage</button><button className="button secondary compact" onClick={() => setFilter(filter === "trash" ? "all" : "trash")}>{filter === "trash" ? "Back to files" : `Trash (${counts.trash})`}</button></div><div className="feed-toolbar"><div className="filter-tabs" aria-label="File categories">{(["all", "original", "final"] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All files" : value === "original" ? "Originals" : "Final cuts"}<span>{value === "all" ? counts.all : value === "original" ? originalCount : finalCount}</span></button>)}</div><span className="sort-label">Newest first<ArrowDown size={14} /></span></div>
          {visibleItems.length ? <><div className="feed-label"><span>{filter === "trash" ? "REMOVED FILES · RESTORE ANYTIME" : "RECENT DROPS"}</span><span aria-live="polite">{visibleItems.length} of {total} files{feedBusy ? " · Updating…" : ""}</span></div><div className="media-grid">{visibleItems.map(item => <article className="media-card" key={item.id}><button className="media-cover" onClick={() => setModal(item)} aria-label={`Preview ${item.name}`}><MediaPreview item={item} /><span className={`category-badge ${item.category}`}>{item.category === "final" ? <CheckCheck size={12} /> : <ShieldCheck size={12} />}{item.category === "final" ? "Final cut" : "Original"}</span>{item.mime.startsWith("video/") && <span className="play-badge"><Play size={14} fill="currentColor" /></span>}</button><div className="media-card-body"><h3 title={item.name}>{item.name}</h3><p>{formatBytes(item.size)}<span>·</span>{item.deviceName}</p><div className="card-bottom"><span>{new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><button className="save-button" disabled={savingVerified} onClick={() => void saveOriginal(item)}><ArrowDownToLine size={15} />Save to device</button></div><div className="file-actions">{filter === "trash" ? <><button className="text-button" onClick={() => void changeMedia(item, "restore")}>Restore</button><button className="text-button danger" onClick={() => void changeMedia(item, "delete")}>Delete permanently</button></> : <button className="text-button" onClick={() => void changeMedia(item, "archive")}>Move to Trash</button>}</div></div></article>)}</div>{nextCursor && <div className="load-more"><button className="button secondary" disabled={feedBusy} onClick={() => void loadMore()}>{feedBusy ? "Loading…" : "Load more files"}</button></div>}</> : <section className="empty-feed"><div className="empty-art" aria-hidden="true"><span className="art-card back"><Clapperboard size={31} strokeWidth={1.2} /></span><span className="art-card front"><FileImage size={35} strokeWidth={1.2} /><span /><span /></span><span className="art-arrow"><ArrowDown size={18} /></span></div><h2>{search ? "No matching files." : filter === "trash" ? "Nothing in Trash." : filter === "final" ? "Ready for the final touch." : "A fresh space for your next idea."}</h2><p>{search ? "Try a different filename or clear your search." : filter === "trash" ? "Removed files appear here until you restore or permanently delete them." : filter === "final" ? "Drop your finished edits here. Everyone can save the original export." : "Drop your first photos or videos above. They'll be right here for every connected device."}</p><span className="empty-footnote"><ShieldCheck size={14} />No compression. No extra steps.</span></section>}
          <footer className="feed-footer"><span><ArrowLeftRight size={14} />A simple handoff. A little more flow.</span><span>Originals in. Originals out.</span></footer>
        </>}
      </main>
    </div>

    <input ref={fileInput} className="visually-hidden" type="file" multiple aria-label="Choose original files" onChange={event => { if (event.target.files) void selectOriginals(event.target.files); event.target.value = ""; }} />
    <input ref={resumeInput} className="visually-hidden" type="file" aria-label="Choose file to resume" onChange={event => { const file = event.target.files?.[0]; const target = resumeTarget.current; if (file && target) { if (file.size !== target.size) setError("Choose the same original file to resume."); else scheduleTransfer(file, target); } event.target.value = ""; }} />
    {dragging && session && <div className="drop-overlay"><Upload size={52} /><h2>Let it drop.</h2><p>{filter === "final" ? "Send your final cuts" : "Send your originals"}</p></div>}
    {(transfers.length > 0 || download) && <section className="transfer-tray" aria-label="File transfers"><div className="tray-heading"><strong>{activeTransfers.length ? <><Radio size={16} />{activeTransfers.length} {activeTransfers.length === 1 ? "transfer" : "transfers"}</> : <><CheckCheck size={17} />{download ? "Saving original" : "All files delivered"}</>}</strong><button className="icon-button" aria-label="Dismiss completed transfers" onClick={() => { for (const transfer of transfers.filter(item => item.state === "complete")) void forgetTransfer(transfer.id); setTransfers(current => current.filter(item => item.state !== "complete")); }}><X size={16} /></button></div><div className="transfer-list">{download && <div className="transfer-row"><ArrowDownToLine size={21} /><div className="transfer-information"><strong>{download.name}</strong><div><span>Saving and verifying</span><span>{download.progress}%</span></div><progress max={100} value={download.progress} aria-label="Download progress" /></div><button className="icon-button" aria-label="Cancel download" onClick={() => download.controller.abort()}><X size={17} /></button></div>}{transfers.map(transfer => <div className="transfer-row" key={transfer.id}><div className="transfer-file-icon"><FileImage size={21} /></div><div className="transfer-information"><strong>{transfer.name}</strong><div><span>{statusLabels[transfer.state]}</span><span>{transfer.state === "sending" ? `${transfer.progress}%` : formatBytes(transfer.size)}</span></div><progress max={100} value={transfer.progress} aria-label={`${transfer.name} progress`} />{transfer.message && <p>{transfer.message}</p>}</div>{transfer.state === "complete" ? <Check size={19} className="success-icon" /> : ["sending", "preparing", "queued"].includes(transfer.state) ? <button className="icon-button" aria-label={`Pause ${transfer.name}`} onClick={() => controllers.current.get(transfer.id)?.abort()}><Pause size={17} /></button> : <div className="transfer-actions"><button className="icon-button" aria-label={`Resume ${transfer.name}`} onClick={() => resumeTransfer(transfer)}><Play size={17} /></button>{transfer.state === "error" && <button className="icon-button" aria-label={`Restart ${transfer.name}`} onClick={() => void restartTransfer(transfer)}><RefreshCw size={16} /></button>}<button className="icon-button" aria-label={`Cancel ${transfer.name}`} onClick={() => void cancelUpload(transfer.id, transfer.name)}><X size={15} /></button></div>}</div>)}</div>{activeTransfers.length > 0 && <p className="tray-note">Keep this tab open while sending.</p>}</section>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}

    {modal === "devices" && <ModalFrame title="Your connected devices" onClose={() => setModal(null)}>{error && <p role="alert" className="error-banner">{error}</p>}<p className="modal-intro">One space. Everything you need to keep things moving.</p><div className="device-list">{devices.map(device => <div key={device.id} className="device-row"><span className="device-symbol">{/phone|iphone|android/i.test(device.name) ? <Smartphone size={22} /> : <Laptop size={22} />}</span><div><strong>{device.name}</strong><p>{device.current ? "This device" : "Connected to this space"}</p></div>{device.current ? <span className="pill">YOU</span> : <button className="text-button" onClick={() => void disconnectDevice(device.id)}>Disconnect</button>}</div>)}</div><div className="pair-panel"><Link2 size={22} /><h3>Bring another device along.</h3><p>Scan a code or open an invitation link. No account needed.</p>{qr ? <><img className={clock >= inviteExpiresAt ? "expired-qr" : ""} src={qr} width={200} height={200} alt="Scan to join this shared space" /><p className="small-muted">{clock >= inviteExpiresAt ? "Invitation expired. Create a new one below." : `Single use · ${Math.ceil((inviteExpiresAt - clock) / 60000)} min remaining`}</p><button className="button secondary" disabled={clock >= inviteExpiresAt} onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setNotice("Invitation link copied.")).catch(() => setError("Couldn't copy. Select the invitation link below.")); }}><Copy size={16} />Copy invitation link</button><input className="invite-url" readOnly value={inviteLink} aria-label="Invitation link" onFocus={event => event.target.select()} /><button className="text-button" disabled={inviteBusy} onClick={() => void createInvitation()}><RefreshCw size={13} />Create a new invitation</button></> : <button className="button primary" disabled={inviteBusy} onClick={() => void createInvitation()}>{inviteBusy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Pair a device</button>}{session?.transport === "local" && <p className="small-muted">This local link works only on this computer. Phone pairing needs a hosted address.</p>}</div></ModalFrame>}
    {modal === "storage" && <ModalFrame title="Your shared storage" onClose={() => setModal(null)}>{error && <p role="alert" className="error-banner">{error}</p>}{storage ? <><p className="modal-intro">{formatBytes(storage.used)} of {formatBytes(storage.limit)} used. Originals stay until you choose to remove them.</p><progress className="storage-meter" max={storage.limit} value={storage.used} aria-label="Shared storage used" /><p className="small-muted">{formatBytes(storage.reserved)} reserved for unfinished uploads · {formatBytes(storage.trash)} in Trash. Trash continues to use storage.</p><button className="button secondary" onClick={() => { setModal(null); setFilter("trash"); }}>Open Trash</button><h3 className="storage-heading">Unfinished uploads</h3>{storage.uploads.length ? storage.uploads.map(upload => <div className="device-row" key={upload.id}><div><strong>{upload.name}</strong><p>{formatBytes(upload.size)} · {upload.deviceName}</p></div><button className="text-button danger" onClick={() => void cancelUpload(upload.id, upload.name)}>Cancel upload</button></div>) : <p className="small-muted">No storage is reserved for unfinished transfers.</p>}</> : <p>Loading storage…</p>}</ModalFrame>}
    {modal === "help" && <ModalFrame title="A simple way to pass it on." onClose={() => setModal(null)}><div className="help-step"><span>01</span><div><h3>Drop your originals.</h3><p>Add files or drag them into your shared space. Relay sends the original bytes, without re-encoding.</p></div></div><div className="help-step"><span>02</span><div><h3>Save. Then make it yours.</h3><p>Save to device starts an original-file download. Edit locally in whichever tools you love.</p></div></div><div className="help-step"><span>03</span><div><h3>Drop the final cut.</h3><p>Open Final cuts and add your export. It is immediately available once the transfer finishes.</p></div></div><div className="help-note"><ShieldCheck size={20} /><p>Keep this browser tab open during uploads. After a reload, choose the same file to resume. Browser downloads go to Downloads or the location you select. Direct saving to Photos requires the native mobile app.</p></div></ModalFrame>}
    {modal && typeof modal === "object" && <ModalFrame title={modal.name} onClose={() => setModal(null)}><div className="detail-preview"><MediaPreview item={modal} large /></div><div className="detail-metadata"><span>{modal.category === "final" ? "Final cut" : "Original"}</span><span>{formatBytes(modal.size)}</span><span>{modal.mime}</span></div><p className="small-muted">Shared by {modal.deviceName}</p><details className="integrity-details"><summary>Original file fingerprint</summary><code>{modal.sha256}</code><p>SHA-256 of the file selected for upload. Browser-managed downloads do not verify this automatically.</p></details><button className="button primary full-width" disabled={savingVerified} onClick={() => void saveOriginal(modal)}><FolderDown size={18} />Save original to device</button>{/* Removal candidate: the main Save action now performs verified saving. false && verifiedSaveAvailable && <button className="button secondary full-width save-as-button" disabled={savingVerified} onClick={() => void saveAsOriginal(modal)}>{savingVerified ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}{savingVerified ? "Saving and checking original…" : "Save as… with file verification"}</button> */}</ModalFrame>}
  </div>;
}
