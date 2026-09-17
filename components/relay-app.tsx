"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, Clapperboard, Copy, FileImage, FileVideo, FolderDown, Grid2X2, ImagePlus, Laptop, Link2, LoaderCircle, MonitorSmartphone, Pause, Play, Plus, Radio, RefreshCw, Send, ShieldCheck, Smartphone, Upload, X } from "lucide-react";
import QRCode from "qrcode";
import { requestJson } from "@/lib/api-client";
import { formatBytes, MAX_FILE_SIZE, type Category, type Device, type MediaItem, type Session } from "@/lib/contracts";
import { persistTransfer, restoreTransfers, uploadOriginal, type Transfer } from "@/lib/transfers";
import { saveVerifiedOriginal, supportsVerifiedSave } from "@/lib/downloads";

type Filter = "all" | Category;
type Modal = "devices" | "help" | MediaItem | null;
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
  const photo = /^image\/(jpeg|png|webp|gif|avif)$/.test(item.mime);
  if (photo) return <img loading="lazy" src={`/api/media/${item.id}/preview`} alt={item.name} className="media-image" />;
  if (large && item.mime.startsWith("video/")) return <video controls playsInline preload="metadata" src={`/api/media/${item.id}/preview`} className="media-image" />;
  const Icon = item.mime.startsWith("video/") ? FileVideo : FileImage;
  return <div className={`file-preview ${item.mime.startsWith("video/") ? "video-preview" : "raw-preview"}`}><Icon size={large ? 56 : 38} strokeWidth={1.2} /><span>{item.name.split(".").pop()?.toUpperCase() || "ORIGINAL"}</span></div>;
}

// The working surface shares one durable feed; browser storage tracks only this device's queue.
export default function RelayApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
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
  const dragDepth = useRef(0);

  const refreshFeed = useCallback(async () => {
    const result = await requestJson<{ items: MediaItem[] }>("feed");
    setItems(result.items);
  }, []);
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
      await Promise.all([refreshFeed(), refreshDevices()]);
      setTransfers(await restoreTransfers(current.deviceId));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't open this space."); }
    finally { setLoading(false); }
  }, [refreshDevices, refreshFeed]);

  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("join");
    if (token) { setInvitation(token); history.replaceState(null, "", location.pathname); }
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) setDeviceName("My phone");
    setVerifiedSaveAvailable(supportsVerifiedSave());
    void loadSession();
    const active = controllers.current;
    return () => { active.forEach(controller => controller.abort()); };
  }, [loadSession]);
  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refreshFeed().catch(() => {}); }, 5000);
    return () => clearInterval(timer);
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
        setItems(result.items);
        return { items: result.items.filter(item => category === "all" || item.category === category) };
      },
    }, { signal: lifecycle.signal })).catch(() => {});
    return () => lifecycle.abort();
  }, [session]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (controllers.current.size) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

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
    files.current.set(transfer.id, file);
    const controller = new AbortController();
    controllers.current.set(transfer.id, controller);
    updateTransfer({ ...transfer, state: "queued", message: undefined });
    serialQueue.current = serialQueue.current.catch(() => {}).then(async () => {
      try {
        const completed = await uploadOriginal(file, transfer, controller.signal, updateTransfer);
        if (completed.state === "complete") { files.current.delete(transfer.id); await refreshFeed(); }
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't save transfer progress."); }
      finally { controllers.current.delete(transfer.id); }
    });
  }
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
      const { token } = await requestJson<{ token: string }>("invitations", { method: "POST" });
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
    try {
      const { url } = await requestJson<{ url: string }>(`media/${item.id}/link`);
      const link = document.createElement("a");
      link.href = url; link.download = item.name;
      document.body.appendChild(link); link.click(); link.remove();
      setNotice("Download requested. Check your browser's downloads.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't start that download."); }
  }
  async function saveAsOriginal(item: MediaItem) {
    setSavingVerified(true);
    try { await saveVerifiedOriginal(item); setNotice("Saved to your device. Original file verified."); }
    catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : "Couldn't save the file.");
    } finally { setSavingVerified(false); }
  }
  const visibleItems = items.filter(item => filter === "all" || item.category === filter);
  const activeTransfers = transfers.filter(item => item.state !== "complete");
  const originalCount = items.filter(item => item.category === "original").length;
  const finalCount = items.filter(item => item.category === "final").length;
  const pageTitle = filter === "all" ? "Shared drop zone" : filter === "original" ? "Originals" : "Final cuts";
  const invitationRequired = !session && !invitation && !canCreateSpace;

  return <div className="app-shell" onDragEnter={event => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (session) void selectOriginals(event.dataTransfer.files); }}>
    <aside className="sidebar">
      <a href="/" className="wordmark" aria-label="Relay home"><span className="brand-icon"><ArrowLeftRight size={22} strokeWidth={2.4} /></span>relay<span className="brand-dot">.</span></a>
      <div className="space-label"><span className="space-avatar">{(session?.space.name || "Your space").slice(0, 1).toUpperCase()}</span><div><strong>{session?.space.name || "Your shared space"}</strong><span>{session ? "Connected workspace" : "A little less back and forth"}</span></div></div>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Shared media">
        <button className={`nav-item ${filter === "all" ? "active" : ""}`} onClick={() => setFilter("all")}><Grid2X2 size={18} />All files<span>{items.length}</span></button>
        <button className={`nav-item ${filter === "original" ? "active" : ""}`} onClick={() => setFilter("original")}><FileImage size={18} />Originals<span>{originalCount}</span></button>
        <button className={`nav-item ${filter === "final" ? "active" : ""}`} onClick={() => setFilter("final")}><Clapperboard size={18} />Final cuts<span>{finalCount}</span></button>
      </nav>
      <div className="nav-divider" />
      <button className="nav-item" disabled={!session} onClick={() => { setModal("devices"); void refreshDevices().catch(() => setError("Couldn't refresh connected devices.")); }}><MonitorSmartphone size={18} />Connected devices<span>{devices.length || "—"}</span></button>
      <div className="sidebar-bottom"><div className="quality-note"><ShieldCheck size={20} /><div><strong>Every detail, intact.</strong><p>Your files. Original quality.</p></div></div><button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={18} />How Relay works<ArrowUpRight size={15} /></button><div className="device-footer"><Laptop size={17} /><span>{devices.find(device => device.current)?.name || "This device"}</span><span className={`status-dot ${session ? "online" : ""}`} /></div></div>
    </aside>

    <div className="workspace">
      <header className="topbar"><div className="breadcrumb">Workspace<ChevronRight size={14} /><strong>{filter === "all" ? "All files" : pageTitle}</strong></div><div className="topbar-right"><span className="connection"><span className={`status-dot ${session ? "online" : ""}`} />{session ? "Connected" : "Not paired"}</span><button className="button secondary compact" disabled={!session} onClick={() => setModal("devices")}><Plus size={16} />Pair a device</button></div></header>
      <main>
        <div className="page-heading"><div><div className="eyebrow"><span className="small-line" />LESS SENDING. MORE CREATING.</div><h1>{pageTitle}<span className="title-dot">.</span></h1><p>{filter === "final" ? "The finished work, ready for its next stop." : "From the shop floor to your next great idea."}</p></div><button className="button primary" disabled={!session || session.transport === "unconfigured"} onClick={() => fileInput.current?.click()}><Plus size={18} />{filter === "final" ? "Drop final cuts" : "Add files"}</button></div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
        {session?.transport === "local" && <div className="local-note"><span className="status-dot" />Local workspace · files stay on this computer until hosting is connected.</div>}
        {session?.transport === "unconfigured" && <div className="error-banner">File transfers need their storage connection. Existing originals have not been changed.</div>}
        {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={25} /><p>Opening your space…</p></div> : invitationRequired ?
          <section className="welcome-panel"><div className="welcome-symbol"><Link2 size={32} /></div><span className="pill">YOUR FILES STAY IN YOUR CIRCLE</span><h2>Bring this device along.</h2><p>Open an invitation link or scan a code from a connected device.</p><button className="button secondary" onClick={() => setModal("help")}><CircleHelp size={17} />How Relay works</button><small>No passwords. No new accounts.</small></section> : !session ?
          <section className="welcome-panel"><div className="welcome-symbol"><ArrowLeftRight size={32} /></div><span className="pill">A SHARED SPACE, WITHOUT THE FUSS</span><h2>{invitation ? "You're one step away." : "Good work starts with a drop."}</h2><p>{invitation ? "Give this device a name. You'll stay connected." : "Connect once. Move photos and videos whenever you need."}</p><form onSubmit={connectSpace}>{!invitation && <label>Space name<input required maxLength={60} value={spaceName} onChange={event => setSpaceName(event.target.value)} /></label>}<label>This device<input required maxLength={60} value={deviceName} onChange={event => setDeviceName(event.target.value)} /></label><button className="button primary" disabled={connecting}>{connecting ? <LoaderCircle size={18} className="spin" /> : <ArrowUpRight size={18} />}{invitation ? "Join shared space" : "Create shared space"}</button></form><small>No passwords. No new accounts.</small></section> : <>
          <button className={`drop-zone ${dragging ? "dragging" : ""}`} disabled={session.transport === "unconfigured"} onClick={() => fileInput.current?.click()}><span className="drop-icon"><Upload size={25} strokeWidth={1.6} /></span><span className="drop-copy"><strong>Drop it here. Pick it up anywhere.</strong><span>Drag photos and videos here, or <b>browse files</b></span></span><span className="drop-quality"><ShieldCheck size={15} />Original files, always</span></button>
          <div className="feed-toolbar"><div className="filter-tabs" aria-label="File categories">{(["all", "original", "final"] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All files" : value === "original" ? "Originals" : "Final cuts"}<span>{value === "all" ? items.length : value === "original" ? originalCount : finalCount}</span></button>)}</div><span className="sort-label">Newest first<ArrowDown size={14} /></span></div>
          {visibleItems.length ? <><div className="feed-label"><span>RECENT DROPS</span><span>{visibleItems.length} {visibleItems.length === 1 ? "file" : "files"}</span></div><div className="media-grid">{visibleItems.map(item => <article className="media-card" key={item.id}><button className="media-cover" onClick={() => setModal(item)} aria-label={`Preview ${item.name}`}><MediaPreview item={item} /><span className={`category-badge ${item.category}`}>{item.category === "final" ? <CheckCheck size={12} /> : <ShieldCheck size={12} />}{item.category === "final" ? "Final cut" : "Original"}</span>{item.mime.startsWith("video/") && <span className="play-badge"><Play size={14} fill="currentColor" /></span>}</button><div className="media-card-body"><h3 title={item.name}>{item.name}</h3><p>{formatBytes(item.size)}<span>·</span>{item.deviceName}</p><div className="card-bottom"><span>{new Date(item.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span><button className="save-button" onClick={() => saveOriginal(item)}><ArrowDownToLine size={15} />Save to device</button></div></div></article>)}</div></> : <section className="empty-feed"><div className="empty-art" aria-hidden="true"><span className="art-card back"><Clapperboard size={31} strokeWidth={1.2} /></span><span className="art-card front"><FileImage size={35} strokeWidth={1.2} /><span /><span /></span><span className="art-arrow"><ArrowDown size={18} /></span></div><h2>{filter === "final" ? "Ready for the final touch." : "A fresh space for your next idea."}</h2><p>{filter === "final" ? "Drop your finished edits here. Everyone can save the original export." : "Drop your first photos or videos above. They'll be right here for every connected device."}</p><span className="empty-footnote"><ShieldCheck size={14} />No compression. No extra steps.</span></section>}
          <footer className="feed-footer"><span><ArrowLeftRight size={14} />A simple handoff. A little more flow.</span><span>Originals in. Originals out.</span></footer>
        </>}
      </main>
    </div>

    <input ref={fileInput} className="visually-hidden" type="file" multiple aria-label="Choose original files" onChange={event => { if (event.target.files) void selectOriginals(event.target.files); event.target.value = ""; }} />
    <input ref={resumeInput} className="visually-hidden" type="file" aria-label="Choose file to resume" onChange={event => { const file = event.target.files?.[0]; const target = resumeTarget.current; if (file && target) { if (file.size !== target.size) setError("Choose the same original file to resume."); else scheduleTransfer(file, target); } event.target.value = ""; }} />
    {dragging && session && <div className="drop-overlay"><Upload size={52} /><h2>Let it drop.</h2><p>{filter === "final" ? "Send your final cuts" : "Send your originals"}</p></div>}
    {transfers.length > 0 && <section className="transfer-tray" aria-label="File transfers"><div className="tray-heading"><strong>{activeTransfers.length ? <><Radio size={16} />{activeTransfers.length} {activeTransfers.length === 1 ? "transfer" : "transfers"}</> : <><CheckCheck size={17} />All files delivered</>}</strong><button className="icon-button" aria-label="Dismiss completed transfers" onClick={() => setTransfers(current => current.filter(item => item.state !== "complete"))}><X size={16} /></button></div><div className="transfer-list">{transfers.map(transfer => <div className="transfer-row" key={transfer.id}><div className="transfer-file-icon"><FileImage size={21} /></div><div className="transfer-information"><strong>{transfer.name}</strong><div><span>{statusLabels[transfer.state]}</span><span>{transfer.state === "sending" ? `${transfer.progress}%` : formatBytes(transfer.size)}</span></div><progress max={100} value={transfer.progress} aria-label={`${transfer.name} progress`} />{transfer.message && <p>{transfer.message}</p>}</div>{transfer.state === "complete" ? <Check size={19} className="success-icon" /> : ["sending", "preparing", "queued"].includes(transfer.state) ? <button className="icon-button" aria-label={`Pause ${transfer.name}`} onClick={() => controllers.current.get(transfer.id)?.abort()}><Pause size={17} /></button> : <button className="icon-button" aria-label={`Resume ${transfer.name}`} onClick={() => resumeTransfer(transfer)}><Play size={17} /></button>}</div>)}</div>{activeTransfers.length > 0 && <p className="tray-note">Keep this tab open while sending.</p>}</section>}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}

    {modal === "devices" && <ModalFrame title="Your connected devices" onClose={() => setModal(null)}><p className="modal-intro">One space. Everything you need to keep things moving.</p><div className="device-list">{devices.map(device => <div key={device.id} className="device-row"><span className="device-symbol">{/phone|iphone|android/i.test(device.name) ? <Smartphone size={22} /> : <Laptop size={22} />}</span><div><strong>{device.name}</strong><p>{device.current ? "This device" : "Connected to this space"}</p></div>{device.current ? <span className="pill">YOU</span> : <button className="text-button" onClick={() => void disconnectDevice(device.id)}>Disconnect</button>}</div>)}</div><div className="pair-panel"><Link2 size={22} /><h3>Bring another device along.</h3><p>Scan a code or open an invitation link. No account needed.</p>{qr ? <><img src={qr} width={200} height={200} alt="Scan to join this shared space" /><p className="small-muted">Single use · expires 10 minutes after creation</p><button className="button secondary" onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setNotice("Invitation link copied.")).catch(() => setError("Couldn't copy. Select the invitation link below.")); }}><Copy size={16} />Copy invitation link</button><input className="invite-url" readOnly value={inviteLink} aria-label="Invitation link" onFocus={event => event.target.select()} /><button className="text-button" disabled={inviteBusy} onClick={() => void createInvitation()}><RefreshCw size={13} />Create a new invitation</button></> : <button className="button primary" disabled={inviteBusy} onClick={() => void createInvitation()}>{inviteBusy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Pair a device</button>}{session?.transport === "local" && <p className="small-muted">This local link works only on this computer. Phone pairing needs a hosted address.</p>}</div></ModalFrame>}
    {modal === "help" && <ModalFrame title="A simple way to pass it on." onClose={() => setModal(null)}><div className="help-step"><span>01</span><div><h3>Drop your originals.</h3><p>Add files or drag them into your shared space. Relay sends the original bytes, without re-encoding.</p></div></div><div className="help-step"><span>02</span><div><h3>Save. Then make it yours.</h3><p>Save to device starts an original-file download. Edit locally in whichever tools you love.</p></div></div><div className="help-step"><span>03</span><div><h3>Drop the final cut.</h3><p>Open Final cuts and add your export. It's immediately available once the transfer finishes.</p></div></div><div className="help-note"><ShieldCheck size={20} /><p>Keep this browser tab open during uploads. After a reload, choose the same file to resume. Browser downloads go to Downloads or the location you select. Direct saving to Photos requires the native mobile app.</p></div></ModalFrame>}
    {modal && typeof modal === "object" && <ModalFrame title={modal.name} onClose={() => setModal(null)}><div className="detail-preview"><MediaPreview item={modal} large /></div><div className="detail-metadata"><span>{modal.category === "final" ? "Final cut" : "Original"}</span><span>{formatBytes(modal.size)}</span><span>{modal.mime}</span></div><p className="small-muted">Shared by {modal.deviceName}</p><details className="integrity-details"><summary>Original file fingerprint</summary><code>{modal.sha256}</code><p>SHA-256 of the file selected for upload. Browser-managed downloads do not verify this automatically.</p></details><button className="button primary full-width" onClick={() => void saveOriginal(modal)}><FolderDown size={18} />Save original to device</button>{verifiedSaveAvailable && <button className="button secondary full-width save-as-button" disabled={savingVerified} onClick={() => void saveAsOriginal(modal)}>{savingVerified ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}{savingVerified ? "Saving and checking original…" : "Save as… with file verification"}</button>}</ModalFrame>}
  </div>;
}
