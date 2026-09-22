"use client";

/* eslint-disable @next/next/no-img-element -- Authenticated thumbnails and local QR data URLs must bypass public image optimizers. */
// Full account navigation retains the browser beforeunload guard for active transfers.
import AccountWorkspaceNavigation from "@/components/account-workspace-navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ImagePlus and Send are retained removal candidates from the earlier UI.
import { ArrowDown, ArrowDownToLine, ArrowLeftRight, ArrowUpRight, Check, CheckCheck, ChevronRight, CircleHelp, Clapperboard, Copy, FileImage, FileVideo, Folder, FolderDown, Grid2X2, ImagePlus, Laptop, Link2, List, LoaderCircle, Menu, MonitorSmartphone, MoreHorizontal, Pause, Pencil, Play, Plus, Radio, RefreshCw, Search, Send, ShieldCheck, Smartphone, Star, Trash2, Undo2, Upload, Users, X } from "lucide-react";
import QRCode from "qrcode";
import { PresentationShield, HideLibraryButton } from "./presentation-shield";
import { LibraryScope, useLibraryApi } from "./library-scope";
import PublicationDialog from "./publication-dialog";
import ScopeCopyDialog from "./scope-copy-dialog";
import DeliveryManager from "./delivery-manager";
import UploadRequests from "./upload-requests";
import { SavedLibraryViews } from "./saved-library-views";
import { savedLibraryViewsKey } from "@/lib/saved-library-views";
import { AccessScopes } from "./access-scopes";
import { LibraryActivity } from "./library-activity";
import { FolderImport, type MappedImportFile } from "./folder-import";
import { LibraryOverview } from "./library-overview";
import { LibraryTools, emptyLibraryQuery, type LibraryQuery } from "./library-tools";
import { MediaViewer } from "./media-viewer";
import { SelectionControl } from "./selection-control";
import { useActionConfirmation } from "./action-confirmation";
import { RequestError, createLibraryApi, requestJson as requestAccountJson } from "@/lib/api-client";
import { libraryRoleLabel, formatBytes, MAX_FILE_SIZE, type Category, type Device, type MediaItem, type Session, type FeedPage, type StorageUsage, type Album, type AlbumSection } from "@/lib/contracts";
import { persistTransfer, restoreTransfers, forgetTransfer, forgetDeviceTransfers, uploadOriginal, type Transfer } from "@/lib/transfers";
import { saveVerifiedOriginal, supportsVerifiedSave } from "@/lib/downloads";
import { startLibraryPolling } from "@/lib/library-polling";

type AccountLibrary = { id: string; name: string; role: string; kind?: "personal" | "shared"; actorId?: string | null };
type LibraryView = "grid" | "list";
const libraryViewStorageKey = "relay-library-view";

type Filter = "all" | Category | "trash";
type Modal = "devices" | "help" | "storage" | "upload-requests" | "deliveries" | "delivery-create" | MediaItem | null;
const statusLabels = { queued: "Waiting to send", preparing: "Checking original", sending: "Sending", paused: "Paused", "needs-file": "Ready to resume", error: "Transfer interrupted", complete: "Available to everyone" };
type RelayModelContext = { registerTool: (tool: { name: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => Promise<unknown> }, options: { signal: AbortSignal }) => void | Promise<void> };

// Native dialog supplies focus containment, Escape handling, and a modal accessibility tree.
function ModalFrame({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} aria-labelledby={titleId} onClose={onClose} className="modal" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="modal-heading"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>;
}

// A stored video poster is for the grid; opening the file still provides its original player.
function MediaPreview({ item, large = false }: { item: MediaItem; large?: boolean }) {
  const { apiUrl } = useLibraryApi();
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const photo = /^image\/(jpeg|png|webp|gif|avif)$/.test(item.mime);
  if (!failed && large && /^video\/(mp4|webm|quicktime)$/.test(item.mime)) return <video controls playsInline preload="metadata" aria-label={`Play ${item.name}`} poster={item.hasPreview ? apiUrl(`media/${item.id}/thumbnail`) : undefined} onError={() => setFailed(true)} src={apiUrl(`media/${item.id}/preview`)} className="media-image" />;
  if (!failed && ((large && photo) || item.hasPreview)) return <div className={`preview-image-frame${loaded ? " is-loaded" : ""}`}>
    {large && !loaded && item.hasPreview && <img className="preview-placeholder" src={apiUrl(`media/${item.id}/thumbnail`)} alt="" aria-hidden="true" />}
    <img loading={large ? "eager" : "lazy"} decoding="async" onLoad={() => setLoaded(true)} onError={() => setFailed(true)} src={apiUrl(`media/${item.id}/${large && photo ? "preview" : "thumbnail"}`)} alt={item.name} className="media-image" />
    {large && !loaded && <span className="preview-loading" role="status"><LoaderCircle size={18} className="spin" /><span>Loading preview…</span></span>}
  </div>;
  const Icon = item.mime.startsWith("video/") ? FileVideo : FileImage;
  return <div className={`file-preview ${item.mime.startsWith("video/") ? "video-preview" : "raw-preview"}`}><Icon size={large ? 56 : 38} strokeWidth={1.2} /><span>{item.name.split(".").pop()?.toUpperCase() || "ORIGINAL"}</span><small>{large ? "Preview unavailable. Save the original to open it." : "Original ready to save"}</small></div>;
}

// The working surface shares one durable feed; browser storage tracks only this device's queue.
export default function RelayApp({ accountSpaceId }: { accountSpaceId?: string }) {
  return <LibraryScope.Provider value={accountSpaceId}><PresentationShield><RelayWorkspace key={accountSpaceId ?? "legacy"} /></PresentationShield></LibraryScope.Provider>;
}

// Isolate library state across account spaces and legacy device access.
function RelayWorkspace() {
  const { requestJson, apiUrl, accountSpaceId } = useLibraryApi();
  const libraryAccessLost = useRef(false);
  const verifiedDownload = useRef<AbortController | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [accountLibraries, setAccountLibraries] = useState<AccountLibrary[]>([]);
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<MediaItem[]>([]);
  const [counts, setCounts] = useState({ all: 0, original: 0, final: 0, trash: 0 });
  const [total, setTotal] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [feedBusy, setFeedBusy] = useState(false);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [feedFailure, setFeedFailure] = useState<{ query: string; message: string } | null>(null);
  const [sessionFailure, setSessionFailure] = useState(false);
  const [search, setSearch] = useState("");
  const [albums, setAlbums] = useState<Album[]>([]);
  const [sections, setSections] = useState<AlbumSection[]>([]);
  const [libraryQuery, setLibraryQuery] = useState<LibraryQuery>(emptyLibraryQuery);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [undoLibraryAction, setUndoLibraryAction] = useState<(() => Promise<unknown>) | null>(null);
  const [mediaActionBusy, setMediaActionBusy] = useState(false);
  const { confirm, confirmation } = useActionConfirmation();
  const [renameItems, setRenameItems] = useState<MediaItem[]>([]);
  const [scopeCopyItem, setScopeCopyItem] = useState<MediaItem | null>(null);
  const [publicationItem, setPublicationItem] = useState<MediaItem | null>(null);
  const [dateItem, setDateItem] = useState<MediaItem | null>(null);
  const selectionAnchor = useRef<string | null>(null);
  const [libraryView, setLibraryView] = useState<LibraryView>("grid");
  const [navigationOpen, setNavigationOpen] = useState(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const navigationButton = useRef<HTMLButtonElement>(null);
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
  const [deviceAccessBusy, setDeviceAccessBusy] = useState(false);
  const [canCreateSpace, setCanCreateSpace] = useState(false);
  const [verifiedSaveAvailable, setVerifiedSaveAvailable] = useState(false);
  const [savingVerified, setSavingVerified] = useState(false);
  const [deviceName, setDeviceName] = useState("My desktop");
  const [spaceName, setSpaceName] = useState("Our shared space");
  const fileInput = useRef<HTMLInputElement>(null);
  const queuedImportTransfers = useRef(new Set<string>());
  const resumeInput = useRef<HTMLInputElement>(null);
  const resumeTarget = useRef<Transfer | null>(null);
  const files = useRef(new Map<string, File>());
  const controllers = useRef(new Map<string, AbortController>());
  const serialQueue = useRef<Promise<unknown>>(Promise.resolve());
  const transferTasks = useRef(new Map<string, Promise<unknown>>());
  const runningTransfers = useRef(new Set<string>());
  const cancelledTransfers = useRef(new Set<string>());
  const dragDepth = useRef(0);
  const feedQuery = useRef("category=all&q=");
  const pageDepth = useRef(1);
  const feedRevision = useRef(0);
  const audienceRef = useRef("");

  // Refresh every loaded page with stable cursors, keeping filters and cross-device changes consistent.
  const refreshFeed = useCallback(async (signal?: AbortSignal) => {
    const revision = ++feedRevision.current;
    const query = feedQuery.current;
    try {
      let cursor: string | null = null; const collected: MediaItem[] = []; let result: FeedPage;
      for (let page = 0; page < pageDepth.current; page++) {
        result = await requestJson<FeedPage>(`feed?${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
        collected.push(...result.items); cursor = result.nextCursor;
        if (!cursor) break;
      }
      if (signal?.aborted || revision !== feedRevision.current || libraryAccessLost.current) return;
      setLoadedQuery(query); setFeedFailure(null);
      setItems(collected); setCounts(result!.counts); setTotal(result!.total); setNextCursor(cursor); setOnline(true);
      // A refreshed authoritative page may remove a revoked restricted item even in combined browsing.
      // Close cached detail/action surfaces as well as the gallery; old modal state is not an access grant.
      const currentItems = new Map(collected.map(item => [item.id, item]));
      setModal(current => current && typeof current === "object" ? currentItems.get(current.id) ?? null : current);
      setScopeCopyItem(current => current ? currentItems.get(current.id) ?? null : null);
      setPublicationItem(current => current ? currentItems.get(current.id) ?? null : null);
      setRenameItems(current => current.filter(item => currentItems.has(item.id)));
      setDateItem(current => current ? currentItems.get(current.id) ?? null : null);
      setSelectedIds(current => new Set([...current].filter(id => currentItems.has(id))));
      setSession(current => current && current.role !== result!.role ? { ...current, role: result!.role } : current);
    } catch (failure) {
      if (signal?.aborted || revision !== feedRevision.current) return;
      if (accountSpaceId !== undefined && failure instanceof RequestError && [401, 403].includes(failure.status)) {
        libraryAccessLost.current = true;
        controllers.current.forEach(controller => controller.abort());
        verifiedDownload.current?.abort();
        setSession(null); setSessionFailure(true); setItems([]); setAlbums([]); setSections([]);
        setStorage(null); setTransfers([]); setSelectedIds(new Set()); setModal(null); setPublicationItem(null); setScopeCopyItem(null);
        setRenameItems([]); setDateItem(null); setFeedbackMessage(""); setUndoLibraryAction(null); setDownload(null);
        setCounts({ all: 0, original: 0, final: 0, trash: 0 });
      }
      setFeedFailure({ query, message: failure instanceof Error ? failure.message : "Couldn't load files." });
      throw failure;
    }
  }, [accountSpaceId, requestJson]);
  async function loadMore() {
    setFeedBusy(true); pageDepth.current++;
    try { await refreshFeed(); } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't load more files."); }
    finally { setFeedBusy(false); }
  }
  // Ignore album responses from a former audience without restarting uploads on navigation.
  const refreshAlbums = useCallback(async (signal?: AbortSignal) => {
    const scope = audienceRef.current;
    const result = await requestJson<{ albums: Album[]; sections?: AlbumSection[] }>(`albums?scope=${encodeURIComponent(scope)}`, { signal });
    if (signal?.aborted || libraryAccessLost.current || scope !== audienceRef.current) return;
    setAlbums(result.albums); setSections(result.sections || []);
  }, [requestJson]);
  const refreshStorage = useCallback(async () => { const result = await requestJson<StorageUsage>("storage"); if (!libraryAccessLost.current) setStorage(result); }, [requestJson]);
  const refreshDevices = useCallback(async () => {
    if (accountSpaceId !== undefined) { setDevices([]); return; }
    const result = await requestJson<{ devices: Device[] }>("devices");
    setDevices(result.devices);
  }, [accountSpaceId, requestJson]);
  // Recover the paired session and unfinished manifests without creating a space implicitly.
  const loadSession = useCallback(async () => {
    setLoading(true); setSessionFailure(false); setError("");
    try {
      const response = await fetch(apiUrl("session"));
      if (response.status === 401 && accountSpaceId === undefined) {
        setSession(null);
        const access = await requestJson<{ canCreateSpace: boolean }>("access");
        setCanCreateSpace(access.canCreateSpace);
        return;
      }
      const body = await response.json() as Session & { error?: string };
      if (!response.ok) throw new Error(body.error);
      const current = body as Session;
      libraryAccessLost.current = false;
      setSession(current);
      const accountSpaces = accountSpaceId === undefined ? undefined : (await requestAccountJson<{ spaces: AccountLibrary[] }>("auth/spaces")).spaces;
      setAccountLibraries(accountSpaces || []);
      setTransfers(await restoreTransfers(current.deviceId, accountSpaces));
      await Promise.all([refreshFeed(), refreshDevices(), refreshStorage(), refreshAlbums()]);
    } catch (failure) { setSessionFailure(true); setError(failure instanceof Error ? failure.message : "Couldn't open this space."); }
    finally { setLoading(false); }
  }, [accountSpaceId, apiUrl, requestJson, refreshDevices, refreshFeed, refreshStorage, refreshAlbums]);

  /* eslint-disable react-hooks/set-state-in-effect -- Pairing fragments and browser capabilities must be read after hydration. */
  useEffect(() => {
    const token = new URLSearchParams(location.hash.slice(1)).get("join");
    if (token) { setInvitation(token); history.replaceState(null, "", location.pathname); }
    if (/Android|iPhone|iPad/i.test(navigator.userAgent)) setDeviceName("My phone");
    try { setLibraryView(localStorage.getItem(libraryViewStorageKey) === "list" ? "list" : "grid"); }
    catch { /* Restricted browser storage keeps the default grid usable. */ }
    setVerifiedSaveAvailable(supportsVerifiedSave());
    const restoreLibraryLocation = () => {
      const params = new URLSearchParams(location.search);
      const restored = { ...emptyLibraryQuery };
      for (const key of Object.keys(restored) as (keyof LibraryQuery)[]) restored[key] = params.get(key) || emptyLibraryQuery[key];
      if (params.getAll("scope").length > 1) restored.scope = "invalid";
      const category = params.get("category") || "all";
      resetAudienceState(restored.scope);
      feedQuery.current = new URLSearchParams({ category, q: params.get("q") || "", ...restored }).toString();
      setLibraryQuery(restored); setSearch(params.get("q") || "");
      setFilter((["all", "original", "final", "trash"].includes(category) ? category : "all") as Filter);
    };
    restoreLibraryLocation();
    window.addEventListener("popstate", restoreLibraryLocation);
    void loadSession();
    const active = controllers.current;
    return () => { active.forEach(controller => controller.abort()); window.removeEventListener("popstate", restoreLibraryLocation); };
  }, [loadSession]);
  /* eslint-enable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!session) return;
    return startLibraryPolling(signal => Promise.all([refreshFeed(signal), refreshAlbums(signal)]), failure => {
      setOnline(navigator.onLine);
      if (failure instanceof RequestError && failure.status === 401) { setSession(null); setItems([]); setError(failure.message); }
    });
  }, [session, refreshFeed, refreshAlbums]);
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(() => {
      const audienceChanged = audienceRef.current !== libraryQuery.scope;
      audienceRef.current = libraryQuery.scope;
      if (audienceChanged) { setAlbums([]); setSections([]); void refreshAlbums().catch(() => {}); }
      feedQuery.current = new URLSearchParams({ category: filter, q: search, ...libraryQuery }).toString();
      history.replaceState(null, "", `${location.pathname}?${feedQuery.current}${accountSpaceId === undefined ? "" : `&space=${encodeURIComponent(accountSpaceId)}`}${location.hash}`);
      setSelectedIds(new Set()); selectionAnchor.current = null;
      pageDepth.current = 1; setFeedBusy(true);
      void refreshFeed().catch(() => {}).finally(() => setFeedBusy(false));
    }, search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [accountSpaceId, filter, search, libraryQuery, session, refreshFeed, refreshAlbums]);
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
  }, [session, requestJson]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (controllers.current.size || savingVerified) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [savingVerified]);

  function chooseLibraryView(view: LibraryView) {
    setLibraryView(view);
    try { localStorage.setItem(libraryViewStorageKey, view); }
    catch { /* The current view still changes when browser storage is unavailable. */ }
  }

  // Removal candidate: legacy disclosure support is retained until the direct-action layout is approved.
  useEffect(() => {
    const dismissFileMenus = (event: PointerEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (event instanceof KeyboardEvent && document.querySelector("dialog[open]")) return;
      document.querySelectorAll<HTMLDetailsElement>(".file-actions[open]").forEach(menu => {
        if (event instanceof PointerEvent && menu.contains(event.target as Node)) return;
        const restoreFocus = event instanceof KeyboardEvent && menu.contains(document.activeElement);
        menu.open = false;
        if (restoreFocus) menu.querySelector("summary")?.focus();
      });
    };
    document.addEventListener("pointerdown", dismissFileMenus);
    document.addEventListener("keydown", dismissFileMenus);
    return () => { document.removeEventListener("pointerdown", dismissFileMenus); document.removeEventListener("keydown", dismissFileMenus); };
  }, []);

  // The narrow-screen drawer traps focus, closes on Escape, and restores its invoking control.
  useEffect(() => {
    if (!navigationOpen) return;
    const sidebar = sidebarRef.current;
    const opener = navigationButton.current;
    const focusable = () => Array.from(sidebar?.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), summary') || []).filter(node => node.getClientRects().length > 0);
    focusable()[0]?.focus();
    const handleNavigationKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); setNavigationOpen(false); }
      if (event.key !== "Tab") return;
      const controls = focusable();
      const first = controls[0]; const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const wideLayout = window.matchMedia("(min-width: 801px)");
    const closeOnWideLayout = () => { if (wideLayout.matches) setNavigationOpen(false); };
    document.addEventListener("keydown", handleNavigationKey);
    wideLayout.addEventListener("change", closeOnWideLayout);
    return () => {
      document.removeEventListener("keydown", handleNavigationKey);
      wideLayout.removeEventListener("change", closeOnWideLayout);
      if (!document.querySelector("dialog[open]")) opener?.focus();
    };
  }, [navigationOpen]);

  // Search stays reachable from the keyboard without intercepting typing or native dialog shortcuts.
  useEffect(() => {
    const focusLibrarySearch = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || document.querySelector("dialog[open]")) return;
      if ((event.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      const searchInput = document.querySelector<HTMLInputElement>('.search-field input');
      if (searchInput) { event.preventDefault(); searchInput.focus(); }
    };
    document.addEventListener("keydown", focusLibrarySearch);
    return () => document.removeEventListener("keydown", focusLibrarySearch);
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
    if (libraryAccessLost.current) return;
    setTransfers(current => current.some(item => item.id === next.id) ? current.map(item => item.id === next.id ? next : item) : [...current, next]);
  }
  // Serialize files to bound memory; each file resumes from its persisted completed parts.
  function scheduleTransfer(file: File, transfer: Transfer) {
    if (session?.role === "viewer" && transfer.accountSpaceId === accountSpaceId) { setError("Viewer access does not allow uploads."); return; }
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
        if (completed.state === "complete") { files.current.delete(transfer.id); await Promise.all([refreshFeed(), refreshStorage(), refreshAlbums()]); }
      } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't save transfer progress."); }
      finally { controllers.current.delete(transfer.id); runningTransfers.current.delete(transfer.id); transferTasks.current.delete(transfer.id); }
    });
    transferTasks.current.set(transfer.id, serialQueue.current);
  }
  // Folder previews carry an explicit immutable destination for each file. Persist before dispatch,
  // skip entries already queued by this preview, and retain partial progress if browser storage fails.
  async function queueFolderImport(entries: MappedImportFile[]) {
    if (!session || !["owner", "editor"].includes(session.role)) throw new Error("Organiser access changed. Refresh before importing.");
    const uploadBatch = crypto.randomUUID();
    let queued = 0;
    for (const entry of entries) {
      if (queuedImportTransfers.current.has(entry.transferId)) { queued++; continue; }
      const transfer: Transfer = { id: entry.transferId, deviceId: session.deviceId, accountSpaceId, spaceName: session.space.name,
        name: entry.file.name, size: entry.file.size, mime: entry.file.type || "application/octet-stream", category: "original",
        accessScopeId: entry.accessScopeId, audienceName: entry.audienceName, albumId: entry.albumId, albumName: entry.albumName, sectionId: entry.sectionId, sectionName: entry.sectionName,
        uploadBatch, parts: [], state: "queued", progress: 0 };
      try { await persistTransfer(transfer); }
      catch { throw new Error(`${queued} of ${entries.length} files queued. Allow browser storage, then retry the remaining files from this preview.`); }
      queuedImportTransfers.current.add(entry.transferId); queued++; scheduleTransfer(entry.file, transfer);
    }
    await refreshAlbums();
  }
  // Persist source manifests before queueing so reloads can recover unfinished work.
  async function selectOriginals(selected: FileList | File[]) {
    if (!session || session.role === "viewer" || filter === "trash" || libraryQuery.scope === "accessible") return;
    const destination = albums.find(album => album.id === libraryQuery.album);
    if (destination?.archivedAt) { setError("Unarchive this album before uploading into it."); return; }
    if (libraryQuery.album && libraryQuery.album !== "unorganised" && !destination) { setError("This album is no longer available. Choose a destination before uploading."); return; }
    const uploadBatch = crypto.randomUUID();
    const category = filter === "final" ? "final" : "original";
    for (const file of Array.from(selected)) {
      if (!file.size || file.size > MAX_FILE_SIZE) { setError(`${file.name}: choose a file between 1 byte and 100 GB.`); continue; }
      const transfer: Transfer = { id: crypto.randomUUID(), deviceId: session.deviceId, accountSpaceId, spaceName: session.space.name, name: file.name, size: file.size, mime: file.type || "application/octet-stream", category, accessScopeId: libraryQuery.scope || null, audienceName: libraryQuery.scope ? "Restricted audience" : "General library", albumId: destination?.id, albumName: destination?.name, sectionId: libraryQuery.section && libraryQuery.section !== "unsectioned" ? libraryQuery.section : undefined, sectionName: sections.find(section => section.id === libraryQuery.section)?.name, uploadBatch, parts: [], state: "queued", progress: 0 };
      try { await persistTransfer(transfer); scheduleTransfer(file, transfer); }
      catch { setError("Allow browser storage before sending, so interrupted transfers can resume."); }
    }
  }
  function resumeTransfer(transfer: Transfer) {
    if (session?.role === "viewer" && transfer.accountSpaceId === accountSpaceId) { setError("Viewer access allows browsing and saving. Ask an owner before resuming uploads."); return; }
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
    const target = devices.find(device => device.id === id);
    if (!target || !await confirm({ title: `Disconnect ${target.name}?`, description: "This device will need a new invitation to return. Existing download links may work for up to one hour.", action: "Disconnect device", destructive: true })) return;
    setDeviceAccessBusy(true); setError("");
    try { await requestJson(`devices/${id}`, { method: "DELETE" }); await refreshDevices(); setNotice("Device disconnected."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't disconnect this device."); }
    finally { setDeviceAccessBusy(false); }
  }
  // Ownership changes are explicit; the server atomically prevents removal of the final owner.
  async function changeDeviceRole(target: Device) {
    const role = target.role === "owner" ? "member" : "owner";
    if (!await confirm({ title: `Make ${target.name} ${role === "owner" ? "an owner" : "a member"}?`, description: role === "owner" ? "Owners can remove shared files, invite devices, and manage access." : "Members can upload and save files, but cannot manage shared files or access.", action: role === "owner" ? "Make owner" : "Make member" })) return;
    setDeviceAccessBusy(true); setError("");
    try {
      await requestJson(`devices/${target.id}/role`, { method: "PUT", body: JSON.stringify({ role }) });
      await refreshDevices(); setNotice(`Device is now ${role === "owner" ? "an owner" : "a member"}.`);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't change this device's role."); }
    finally { setDeviceAccessBusy(false); }
  }
  // Revoke access before clearing local state; stop queued work so it cannot repopulate the private manifest store.
  async function disconnectThisDevice() {
    if (!session || !await confirm({ title: "Disconnect this device?", description: "You will need a new invitation to return. Unfinished transfers will stop; another owner can cancel their reservations in Storage. Shared files stay available.", action: "Disconnect this device", destructive: true })) return;
    setDeviceAccessBusy(true); setError("");
    try {
      await requestJson("session", { method: "DELETE" });
      controllers.current.forEach(controller => controller.abort());
      download?.controller.abort();
      await Promise.allSettled([...transferTasks.current.values()]);
      try { await forgetDeviceTransfers(session.deviceId); }
      catch { /* Access is already revoked; browser storage may be unavailable. */ }
      window.location.replace("/");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't disconnect. Please retry."); }
    finally { setDeviceAccessBusy(false); }
  }
  async function saveOriginal(item: MediaItem) {
    setModal(null);
    if (verifiedSaveAvailable) { await saveAsOriginal(item); return; }
    try {
      const link = document.createElement("a");
      link.href = apiUrl(`media/${item.id}/download`); link.download = item.name;
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
    verifiedDownload.current = controller;
    try { await saveVerifiedOriginal(item, { accountSpaceId, signal: controller.signal, onProgress: progress => setDownload(current => current ? { ...current, progress } : null) }); setNotice("Saved to your device. Original file verified."); }
    catch (failure) {
      if (!(failure instanceof DOMException && failure.name === "AbortError")) setError(failure instanceof Error ? failure.message : "Couldn't save the file.");
    } finally { verifiedDownload.current = null; setSavingVerified(false); setDownload(null); }
  }
  // Personal bookmarks do not change shared organisation or approval; confirm the server result before
  // refreshing the feed so removal from a filtered favourites view follows the actual saved state.
  async function toggleFavorite(item: MediaItem) {
    if (mediaActionBusy) return;
    setMediaActionBusy(true);
    try {
      await requestJson(`favorites/${item.id}`, { method: "PUT", body: JSON.stringify({ favorite: !item.isFavorite }) });
      setUndoLibraryAction(null);
      setFeedbackMessage(item.isFavorite ? "Removed from your favourites." : "Saved to your favourites. Only you see this bookmark.");
      await refreshFeed();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Your favourite could not be updated."); }
    finally { setMediaActionBusy(false); }
  }
  // Trash is reversible; only the separate permanent-delete action removes stored originals.
  async function changeMedia(item: MediaItem, action: "archive" | "restore" | "delete") {
    if (mediaActionBusy) return;
    if (action === "delete" && !await confirm({ title: "Delete this file permanently?", description: `“${item.name}” will be deleted for everyone in this space. This cannot be undone. Saved local copies are unaffected.`, action: "Delete permanently", destructive: true })) return;
    setMediaActionBusy(true);
    try {
      if (action === "delete") {
        await requestJson(`media/${item.id}`, { method: "DELETE" });
        setUndoLibraryAction(null);
      } else {
        const result = await requestJson<{ changed: { id: string }[]; files: { id: string; revision: number }[] }>("library/organise", { method: "POST", body: JSON.stringify({ action: action === "archive" ? "trash" : "restore", files: [{ id: item.id, expectedRevision: item.revision ?? 0 }] }) });
        const changed = new Set(result.changed.map(file => file.id));
        const files = result.files.filter(file => changed.has(file.id)).map(file => ({ id: file.id, expectedRevision: file.revision }));
        setUndoLibraryAction(files.length ? () => () => requestJson("library/organise", { method: "POST", body: JSON.stringify({ action: action === "archive" ? "restore" : "trash", files }) }) : null);
      }
      setFeedbackMessage(action === "archive" ? "File moved to Trash." : action === "restore" ? "File restored." : "File permanently deleted.");
      setSelectedIds(current => { const next = new Set(current); next.delete(item.id); return next; });
      setModal(null); await Promise.all([refreshFeed(), refreshStorage(), refreshAlbums()]);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't update this file."); }
    finally { setMediaActionBusy(false); }
  }
  // Wait for active work to stop before releasing its reservation and local manifest.
  async function cancelUpload(id: string, name: string) {
    if (!await confirm({ title: "Cancel this upload?", description: `Progress for “${name}” will be discarded. The original on its device is unaffected.`, action: "Cancel upload", destructive: true })) return;
    try {
      controllers.current.get(id)?.abort();
      cancelledTransfers.current.add(id);
      if (runningTransfers.current.has(id)) await transferTasks.current.get(id)?.catch(() => {});
      const manifest = transfers.find(transfer => transfer.id === id);
      const uploadApi = manifest ? createLibraryApi(manifest.accountSpaceId).requestJson : requestJson;
      try { await uploadApi(`uploads/${id}`, { method: "DELETE" }); } catch (failure) { if (!(failure instanceof RequestError && failure.status === 404)) throw failure; }
      await forgetTransfer(id); files.current.delete(id); setTransfers(current => current.filter(item => item.id !== id));
      await refreshStorage(); setNotice("Unfinished upload cancelled.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't cancel this upload."); }
  }
  async function restartTransfer(transfer: Transfer) {
    if (!await confirm({ title: "Restart this upload?", description: `“${transfer.name}” will start again from the beginning. Use this if its saved upload parts have expired.`, action: "Restart upload" })) return;
    try {
      const result = await createLibraryApi(transfer.accountSpaceId).requestJson<{ uploadId: string }>(`uploads/${transfer.id}/restart`, { method: "POST" });
      const restarted = { ...transfer, uploadId: result.uploadId, parts: [], progress: 0, state: "needs-file" as const, message: "Choose the original file to restart" };
      await persistTransfer(restarted); updateTransfer(restarted); resumeTransfer(restarted);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't restart this transfer."); }
  }
  // Navigation preserves deep links; selection never leaks into a different album or date range.
  // Audience changes invalidate in-flight reads and close content dialogs immediately. Transfers
  // retain their captured destination and continue independently from this browsing selection.
  function resetAudienceState(scope: string) {
    if (scope === audienceRef.current) return;
    audienceRef.current = scope; ++feedRevision.current;
    setItems([]); setAlbums([]); setSections([]); setCounts({ all: 0, original: 0, final: 0, trash: 0 });
    setTotal(0); setNextCursor(null); setSelectedIds(new Set()); setRenameItems([]); setDateItem(null); setPublicationItem(null); setScopeCopyItem(null);
    setFeedbackMessage(""); setUndoLibraryAction(null); setModal(null);
  }
  function changeLibraryQuery(query: LibraryQuery) {
    const changed = query.scope !== audienceRef.current;
    resetAudienceState(query.scope);
    if (changed) void refreshAlbums().catch(() => {});
    history.pushState(null, "", `${location.pathname}?${new URLSearchParams({ category: filter, q: search, ...query, ...(accountSpaceId === undefined ? {} : { space: accountSpaceId }) })}`);
    setLibraryQuery(query); setSelectedIds(new Set());
  }
  const refreshLibrary = useCallback(async () => { await Promise.all([refreshFeed(), refreshAlbums(), refreshStorage()]); }, [refreshFeed, refreshAlbums, refreshStorage]);
  // Grant updates clear content-dependent dialogs and Undo before refreshing current authority.
  const refreshAudienceAccess = useCallback(async () => {
    setItems([]); setAlbums([]); setSections([]); setSelectedIds(new Set()); setModal(null);
    setRenameItems([]); setDateItem(null); setPublicationItem(null); setScopeCopyItem(null); setFeedbackMessage(""); setUndoLibraryAction(null);
    await refreshLibrary();
  }, [refreshLibrary]);
  // Shift selection is bounded to the visible result order and the 100-file bulk action limit.
  function toggleSelection(id: string, shift: boolean) {
    const anchor = visibleItems.findIndex(item => item.id === selectionAnchor.current);
    const index = visibleItems.findIndex(item => item.id === id);
    const range = shift && anchor >= 0 ? visibleItems.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map(item => item.id) : [id];
    setSelectedIds(current => {
      const next = new Set(current);
      const remove = next.has(id);
      for (const selectedId of range) { if (remove) next.delete(selectedId); else if (next.size < 100) next.add(selectedId); }
      return next;
    });
    selectionAnchor.current = id;
  }
  const currentAlbum = albums.find(album => album.id === libraryQuery.album);
  const desiredQuery = new URLSearchParams({ category: filter, q: search, ...libraryQuery }).toString();
  const feedReady = loadedQuery === desiredQuery;
  const currentFeedFailure = feedFailure?.query === desiredQuery ? feedFailure.message : "";
  const visibleItems = feedReady ? items : [];
  const activeTransfers = transfers.filter(item => item.state !== "complete");
  const originalCount = counts.original;
  const finalCount = counts.final;
  const pageTitle = !session && accountSpaceId !== undefined ? "Library" : filter === "trash" ? "Trash" : currentAlbum ? currentAlbum.name : libraryQuery.album === "unorganised" ? "Unorganised" : filter === "all" ? (session?.space.kind === "personal" ? "My space" : libraryQuery.scope === "accessible" ? "Everything I can access" : libraryQuery.scope ? "Restricted library" : "Shared library") : filter === "original" ? "Originals" : "Final cuts";
  const invitationRequired = !session && !invitation && !canCreateSpace;
  const isOwner = session?.role === "owner";
  const canUpload = Boolean(session && session.role !== "viewer" && (!libraryQuery.scope || /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(libraryQuery.scope)));
  const isOrganiser = isOwner || (session?.authentication === "account" && session.role === "editor");
  const canEditFiles = isOrganiser || session?.role === "contributor";
  const canSelectFiles = Boolean(session);
  const canEditFile = (item: MediaItem) => isOrganiser || (session?.role === "contributor" && Boolean(item.canEdit));
  const isLastOwner = isOwner && !devices.some(device => !device.current && device.role === "owner");

  return <div className={`app-shell ${transfers.length || download ? "has-transfers" : ""}`} onDragEnter={event => { if (canUpload && event.dataTransfer.types.includes("Files")) { event.preventDefault(); dragDepth.current++; setDragging(true); } }} onDragOver={event => event.preventDefault()} onDragLeave={event => { event.preventDefault(); dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }} onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); if (canUpload) void selectOriginals(event.dataTransfer.files); }}>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <aside ref={sidebarRef} className={`sidebar${navigationOpen ? " is-open" : ""}`} role={navigationOpen ? "dialog" : undefined} aria-modal={navigationOpen || undefined} aria-label="Workspace navigation" onClick={event => { if ((event.target as HTMLElement).closest("button") && !(event.target as HTMLElement).closest(".library-switcher")) setNavigationOpen(false); }}>
      <button className="icon-button navigation-close" aria-label="Close navigation" onClick={() => setNavigationOpen(false)}><X size={20} /></button>
      <a href={accountSpaceId === undefined ? "/" : `/?space=${encodeURIComponent(accountSpaceId)}`} className="wordmark" aria-label="Relay home"><span className="brand-icon"><ArrowLeftRight size={22} strokeWidth={2.4} /></span>relay<span className="brand-dot">.</span></a>
      <div className="space-label"><span className="space-avatar">{(session?.space.name || "Your space").slice(0, 1).toUpperCase()}</span><div><strong>{session?.space.name || (accountSpaceId !== undefined ? "Your library" : "Your shared space")}</strong><span>{session ? session.space.kind === "personal" ? "Personal / Only you" : accountSpaceId !== undefined ? `${libraryRoleLabel(session.role)} / Account access` : "Connected workspace" : "A little less back and forth"}</span></div></div>
      <p className="nav-label">WORKSPACE</p>
      <AccountWorkspaceNavigation spaceId={accountSpaceId} />
      <nav aria-label={!session ? "Media" : session.space.kind === "personal" ? "Personal media" : "Shared media"}>
        <button aria-pressed={filter === "all" && !libraryQuery.album} className={`nav-item ${filter === "all" && !libraryQuery.album ? "active" : ""}`} onClick={() => { setFilter("all"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope }); }}><Grid2X2 size={18} />{session?.restrictedScopes ? libraryQuery.scope === "accessible" ? "Accessible files" : libraryQuery.scope ? "Audience files" : "General files" : "All files"}<span>{counts.all}</span></button>
        {/* Retirement candidate: global categories remain available for older uploads and clients. */}
        <details className="category-navigation"><summary>File labels</summary>
        <button aria-pressed={filter === "original" && !libraryQuery.album} className={`nav-item ${filter === "original" && !libraryQuery.album ? "active" : ""}`} onClick={() => { setFilter("original"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope }); }}><FileImage size={18} />Originals<span>{originalCount}</span></button>
        <button aria-pressed={filter === "final" && !libraryQuery.album} className={`nav-item ${filter === "final" && !libraryQuery.album ? "active" : ""}`} onClick={() => { setFilter("final"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope }); }}><Clapperboard size={18} />Final cuts<span>{finalCount}</span></button>
        </details>
      </nav>
      {session && <><p className="nav-label albums-label">ALBUMS</p><nav className="album-navigation" aria-label="Albums">
        {albums.filter(album => !album.archivedAt).map(album => <button className={`nav-item${libraryQuery.album === album.id ? " active" : ""}`} aria-current={libraryQuery.album === album.id ? "page" : undefined} key={album.id} onClick={() => { setFilter("all"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope, album: album.id }); }}><Folder size={18} /><span className="album-name">{album.name}</span><span>{album.count}</span></button>)}
        {!albums.some(album => !album.archivedAt) && <p className="album-nav-empty">A home for your next idea.<br />Create an album in your library.</p>}
        <button className={`nav-item${libraryQuery.album === "unorganised" ? " active" : ""}`} aria-current={libraryQuery.album === "unorganised" ? "page" : undefined} onClick={() => { setFilter("all"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope, album: "unorganised" }); }}><Grid2X2 size={17} /><span className="album-name">Unorganised</span></button>
      </nav></>}
      <button aria-pressed={filter === "trash" && !libraryQuery.album} className={`nav-item ${filter === "trash" && !libraryQuery.album ? "active" : ""}`} onClick={() => { setFilter("trash"); setSearch(""); changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope }); }}><FolderDown size={18} />Trash<span>{counts.trash}</span></button><button className="nav-item" disabled={!session} onClick={() => { setModal("storage"); void refreshStorage().catch(failure => setError(failure.message)); }}><ShieldCheck size={18} />Storage<span>{storage ? formatBytes(storage.used) : ""}</span></button><div className="nav-divider" />
      {session?.deliveries && isOwner && <button className="nav-item" onClick={() => setModal("deliveries")}><Link2 size={18}/>Deliveries</button>}
      {session?.uploadRequests && isOwner && <button className="nav-item" onClick={() => setModal("upload-requests")}><Upload size={18}/>Upload requests</button>}
      {accountSpaceId !== undefined ? <>{session && session.space.kind !== "personal" && <a className="nav-item" href={`/people?space=${encodeURIComponent(accountSpaceId)}`}><Users size={18} />People &amp; access</a>}</> : <button className="nav-item" disabled={!session} onClick={() => { setModal("devices"); void refreshDevices().catch(() => setError("Couldn't refresh connected devices.")); }}><MonitorSmartphone size={18} />Connected devices<span>{devices.length || "—"}</span></button>}
      <div className="sidebar-bottom"><div className="quality-note"><ShieldCheck size={20} /><div><strong>Every detail, intact.</strong><p>Your files. Original quality.</p></div></div><button className="nav-item" onClick={() => setModal("help")}><CircleHelp size={18} />How Relay works<ArrowUpRight size={15} /></button><div className="device-footer"><Laptop size={17} /><span>{accountSpaceId !== undefined ? "Account access" : devices.find(device => device.current)?.name || "This device"}</span><span className={`status-dot ${session ? "online" : ""}`} /></div></div>
    </aside>

    {navigationOpen && <button className="navigation-scrim" aria-label="Close navigation overlay" tabIndex={-1} onClick={() => setNavigationOpen(false)} />}
    <div className="workspace" inert={navigationOpen}>
      <header className="topbar"><div className="breadcrumb"><button ref={navigationButton} className="icon-button navigation-open" aria-label="Open navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(true)}><Menu size={20} /></button><span title={session?.space.name}>{session?.space.name || "Workspace"}</span><ChevronRight size={14} /><strong>{pageTitle}</strong></div><div className="topbar-right">{session && <LibraryActivity key={`${session.deviceId}:${libraryQuery.scope}`} scope={libraryQuery.scope} />}<HideLibraryButton /><button className="icon-button mobile-help" aria-label="How Relay works" onClick={() => setModal("help")}><CircleHelp size={20} /></button><span className="connection"><span className={`status-dot ${session && online ? "online" : ""}`} />{loading ? "Opening…" : session ? online ? "Connected" : "Reconnecting" : accountSpaceId !== undefined ? "Not connected" : "Not paired"}</span><a className="button secondary compact" href="/account">Account</a>{accountSpaceId === undefined && <button className="button secondary compact" aria-label={isOwner ? "Pair a device" : "Devices"} disabled={!session} onClick={() => setModal("devices")}><MonitorSmartphone size={16} /><span>{isOwner ? "Pair a device" : "Devices"}</span></button>}</div></header>
      <main id="main-content" tabIndex={-1}>
        {session?.restrictedScopes && <AccessScopes value={libraryQuery.scope} refreshLibrary={refreshAudienceAccess} owner={isOwner} onChange={scope => changeLibraryQuery({ ...emptyLibraryQuery, scope })} />}
      <div className="page-heading"><div><div className="eyebrow"><span className="small-line" />LESS SENDING. MORE CREATING.</div><h1>{pageTitle}<span className="title-dot">.</span></h1><p>{filter === "trash" ? "Restore removed files or free up shared storage." : filter === "final" ? "The finished work, ready for its next stop." : "A little less sending. A lot more creating."}</p></div>{filter !== "trash" && canUpload && <div className="page-upload-actions">{isOrganiser && <FolderImport accessScopeId={libraryQuery.scope || null} audienceName={libraryQuery.scope ? "Restricted audience" : "General library"} disabled={!session || session.transport === "unconfigured"} spaceName={session?.space.name || "This library"} queue={queueFolderImport} />}<button className="button primary" disabled={!session || session.transport === "unconfigured" || Boolean(currentAlbum?.archivedAt)} onClick={() => fileInput.current?.click()}><Plus size={18} />{filter === "final" ? "Drop final cuts" : "Add files"}</button></div>}{filter === "trash" && <button className="button secondary" onClick={() => setFilter("all")}>Back to files</button>}</div>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="icon-button" aria-label="Dismiss error" onClick={() => setError("")}><X size={17} /></button></div>}
        {!online && session && <div className="error-banner" role="status">Connection interrupted. Your queue is retained; resume sending when you are back online.</div>}
        {session?.transport === "local" && <div className="local-note"><span className="status-dot" />Local workspace · files stay on this computer until hosting is connected.</div>}
        {session?.transport === "unconfigured" && <div className="error-banner">File transfers need their storage connection. Existing originals have not been changed.</div>}
        {loading ? <div className="loading-panel"><LoaderCircle className="spin" size={25} /><p>Opening your space…</p></div> : sessionFailure && !session ? <section className="loading-panel"><p>Couldn&apos;t open your space.</p>{accountSpaceId !== undefined && <a className="button secondary" href="/account">Sign in or choose a library</a>}<button className="button secondary" onClick={() => void loadSession()}>Try again</button></section> : invitationRequired ?
          <section className="welcome-panel"><div className="welcome-symbol"><Link2 size={32} /></div><span className="pill">YOUR FILES STAY IN YOUR CIRCLE</span><h2>Bring this device along.</h2><p>Sign in to open your account libraries, or use an invitation link from a connected device.</p><div className="welcome-actions"><a className="button primary" href="/account">Account &amp; libraries</a><button className="button secondary" onClick={() => setModal("help")}><CircleHelp size={17} />How Relay works</button></div><small>Device access is managed by the library owner.</small></section> : !session ?
          <section className="welcome-panel"><div className="welcome-symbol"><ArrowLeftRight size={32} /></div><span className="pill">A SHARED SPACE, WITHOUT THE FUSS</span><h2>{invitation ? "You're one step away." : "Good work starts with a drop."}</h2><p>{invitation ? "Give this device a name. You'll stay connected." : "Connect once. Move photos and videos whenever you need."}</p><form onSubmit={connectSpace}>{!invitation && <label>Space name<input required maxLength={60} value={spaceName} onChange={event => setSpaceName(event.target.value)} /></label>}<label>This device<input required maxLength={60} value={deviceName} onChange={event => setDeviceName(event.target.value)} /></label><button className="button primary" disabled={connecting}>{connecting ? <LoaderCircle size={18} className="spin" /> : <ArrowUpRight size={18} />}{invitation ? "Join shared space" : "Create shared space"}</button></form><small>Device access is managed by the library owner.</small></section> : <>
          {filter === "all" && !search && !libraryQuery.album && !libraryQuery.from && !libraryQuery.to && !libraryQuery.batch && !libraryQuery.type && !libraryQuery.uploader && !libraryQuery.favorites && <LibraryOverview albums={albums} interrupted={transfers.filter(transfer => transfer.deviceId === session.deviceId && transfer.accountSpaceId === accountSpaceId && ["paused", "error", "needs-file"].includes(transfer.state)).length} openAlbum={album => changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope, album })} reviewTransfers={() => { const tray = document.getElementById("file-transfers"); tray?.focus(); tray?.scrollIntoView({ block: "nearest" }); }} />}
          <LibraryTools onCreateDelivery={session.deliveries && isOwner && filter !== "trash" ? () => setModal("delivery-create") : undefined} feedback={{ message: feedbackMessage, setMessage: setFeedbackMessage, undo: undoLibraryAction, setUndo: setUndoLibraryAction }} albums={albums} sections={sections} query={libraryQuery} onQuery={changeLibraryQuery} canOrganise={isOrganiser && libraryQuery.scope !== "accessible"} canSelectFiles={canSelectFiles} canEditFiles={canEditFiles} canFavorite={session.authentication === "account"} selected={visibleItems.filter(item => selectedIds.has(item.id))} loadedCount={visibleItems.length} onSelectLoaded={() => setSelectedIds(new Set(visibleItems.slice(0, 100).map(item => item.id)))} onClearSelection={() => setSelectedIds(new Set())} refresh={refreshLibrary} renameItems={renameItems} onRename={setRenameItems} dateItem={dateItem} onDate={setDateItem} viewControls={<><SavedLibraryViews key={session.deviceId} storageKey={savedLibraryViewsKey(session.space.id, session.deviceId, session.authentication || "legacy")} current={{ category: filter, search, query: libraryQuery }} apply={view => { setFilter(view.category); setSearch(view.search); changeLibraryQuery(view.query); }} /><div className="view-toggle" role="group" aria-label="Library view"><button type="button" aria-label="Grid view" aria-pressed={libraryView === "grid"} onClick={() => chooseLibraryView("grid")}><Grid2X2 size={17} aria-hidden="true" /><span>Grid</span></button><button type="button" aria-label="List view" aria-pressed={libraryView === "list"} onClick={() => chooseLibraryView("list")}><List size={18} aria-hidden="true" /><span>List</span></button></div></>}>
            <label className="search-field"><span className="visually-hidden">Search filenames</span><Search className="search-symbol" size={18} aria-hidden="true" /><input type="search" placeholder="Find a file…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button clear-search" aria-label="Clear search" onClick={() => setSearch("")}><X size={17} /></button>}</label>
          </LibraryTools>
          <div className={`feed-toolbar${libraryQuery.album ? " album-toolbar" : ""}`}><details className="category-filter-disclosure"><summary>File labels{filter === "original" ? ": Originals" : filter === "final" ? ": Final cuts" : ""}</summary><div className="filter-tabs" aria-label="File categories">{(["all", "original", "final"] as Filter[]).map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All files" : value === "original" ? "Originals" : "Final cuts"}{!libraryQuery.album && <span>{value === "all" ? counts.all : value === "original" ? originalCount : finalCount}</span>}</button>)}</div></details><span className="sort-label">{libraryQuery.sort === "oldest" ? "Oldest first" : "Newest first"}<ArrowDown size={14} /></span></div>
          {currentFeedFailure && <div className="error-banner" role="alert"><span>Couldn&apos;t refresh files. {currentFeedFailure}</span><button className="button secondary compact" disabled={feedBusy} onClick={() => { setFeedBusy(true); void refreshFeed().catch(() => {}).finally(() => setFeedBusy(false)); }}>Retry loading files</button></div>}
          {!feedReady ? <section className="loading-panel" role="status">{currentFeedFailure ? <p>Your files will appear when the connection recovers.</p> : <><LoaderCircle className="spin" size={25} /><p>Loading files...</p></>}</section> : visibleItems.length ? <><div className="feed-label"><span>{canSelectFiles && <SelectionControl label={`Select loaded files (${Math.min(visibleItems.length, 100)})`} checked={visibleItems.slice(0, 100).every(item => selectedIds.has(item.id))} mixed={visibleItems.some(item => selectedIds.has(item.id)) && !visibleItems.slice(0, 100).every(item => selectedIds.has(item.id))} disabled={mediaActionBusy} onToggle={() => setSelectedIds(visibleItems.slice(0, 100).every(item => selectedIds.has(item.id)) ? new Set() : new Set(visibleItems.slice(0, 100).map(item => item.id)))} />}{filter === "trash" ? "Removed files" : search ? "Search results" : "Recent additions"}<span className="inline-drop-hint">{filter !== "trash" && canUpload && <><Upload size={13} />Drop files anywhere to add</>}</span></span><span aria-live="polite">{visibleItems.length} of {total} files{feedBusy ? " · Updating…" : ""}</span></div><div className={`media-grid${libraryView === "list" ? " media-list" : ""}${selectedIds.size ? " has-selection" : ""}`}>{visibleItems.map(item => <article className={`media-card${selectedIds.has(item.id) ? " is-selected" : ""}`} key={item.id}><button className="media-cover" onClick={() => setModal(item)} aria-label={`Preview ${item.name}`}><MediaPreview item={item} /><span className={`category-badge ${item.category}`}>{item.category === "final" ? <CheckCheck size={12} /> : <ShieldCheck size={12} />}{item.category === "final" ? "Final cut" : "Original"}</span>{item.mime.startsWith("video/") && <span className="play-badge"><Play size={14} fill="currentColor" /></span>}</button><div className="media-card-body"><div className="card-name-row">{canSelectFiles && <SelectionControl className="file-selection" label={`Select ${item.name}`} checked={selectedIds.has(item.id)} disabled={mediaActionBusy} onToggle={shift => toggleSelection(item.id, shift)} />}<h3 title={item.name}>{item.name}</h3></div><p>{formatBytes(item.size)}<span>·</span>{item.deviceName}<span className="list-category">{item.category === "final" ? "Final cut" : "Original"}</span></p><div className="card-bottom"><span className="file-date">{libraryQuery.dateMode === "captured" && item.capturedAt ? `Taken ${item.capturedAt.slice(0, 10)}` : `Uploaded ${new Date(item.createdAt).toISOString().slice(0, 10)}${libraryQuery.dateMode === "captured" ? " - date taken unknown" : ""}`}</span></div><div className="item-actions" aria-label={`Actions for ${item.name}`}>
                <button className="icon-button" aria-label="Save to device" title="Save to device" disabled={savingVerified} onClick={() => void saveOriginal(item)}><ArrowDownToLine size={17} /></button>
                {session.authentication === "account" && <button className="icon-button" aria-label={item.isFavorite ? "Remove from my favourites" : "Add to my favourites"} aria-pressed={Boolean(item.isFavorite)} title={item.isFavorite ? "Remove from my favourites" : "Add to my favourites (only you)"} disabled={mediaActionBusy} onClick={() => void toggleFavorite(item)}><Star size={16} fill={item.isFavorite ? "currentColor" : "none"} /></button>}
                {canEditFile(item) && filter !== "trash" && <button className="icon-button" aria-label="Rename" title="Rename" disabled={mediaActionBusy} onClick={() => setRenameItems([item])}><Pencil size={16} /></button>}
                {canEditFile(item) && (filter === "trash" ? <><button className="icon-button" aria-label="Restore" title="Restore" disabled={mediaActionBusy} onClick={() => void changeMedia(item, "restore")}><Undo2 size={17} /></button>{isOwner && <button className="icon-button item-trash" aria-label="Delete permanently" title="Delete permanently" disabled={mediaActionBusy} onClick={event => { event.currentTarget.focus(); void changeMedia(item, "delete"); }}><Trash2 size={17} /></button>}</> : <button className="icon-button item-trash" aria-label="Move to Trash" title="Move to Trash" disabled={mediaActionBusy} onClick={() => void changeMedia(item, "archive")}><Trash2 size={17} /></button>)}
              </div></div></article>)}</div>{nextCursor && <div className="load-more"><button className="button secondary" disabled={feedBusy} onClick={() => void loadMore()}>{feedBusy ? "Loading…" : "Load more files"}</button></div>}</> : <section className="empty-feed"><div className="empty-art" aria-hidden="true"><span className="art-card back"><Clapperboard size={31} strokeWidth={1.2} /></span><span className="art-card front"><FileImage size={35} strokeWidth={1.2} /><span /><span /></span><span className="art-arrow"><ArrowDown size={18} /></span></div><h2>{search ? "No matching files." : filter === "trash" ? "Nothing in Trash." : libraryQuery.album || libraryQuery.from || libraryQuery.to || libraryQuery.batch || libraryQuery.type || libraryQuery.uploader || libraryQuery.favorites ? "No files in this view." : filter === "final" ? "Ready for the final touch." : "A fresh space for your next idea."}</h2><p>{search ? "Try a different filename or clear your search." : filter === "trash" ? "Removed files appear here until you restore or permanently delete them." : libraryQuery.from || libraryQuery.to || libraryQuery.batch || libraryQuery.type || libraryQuery.uploader || libraryQuery.favorites ? "Try another filter, or clear filters to see all files. Your favourites are visible only to you." : !canUpload ? "Files shared with this library will appear here. You can browse and save originals." : libraryQuery.album ? "Add files here, or select existing files in All files and add them to an album." : filter === "final" ? "Drop your finished edits here. People with audience access can save the original export." : (session.space.kind === "personal" ? "Your originals, in your own space. Shared-library members cannot see files here." : libraryQuery.scope ? "Add originals for the explicitly granted account memberships. Paired devices cannot access this audience." : "Add your first photos or videos. They'll be right here for every connected device.")}</p>{search || libraryQuery.from || libraryQuery.to || libraryQuery.batch || libraryQuery.type || libraryQuery.uploader || libraryQuery.favorites ? <button className="button secondary empty-primary" onClick={() => { setSearch(""); changeLibraryQuery({ ...libraryQuery, from: "", to: "", batch: "", type: "", uploader: "", favorites: "" }); }}>Clear search and filters</button> : filter !== "trash" && canUpload && <button className="button primary empty-primary" disabled={session.transport === "unconfigured" || Boolean(currentAlbum?.archivedAt)} onClick={() => fileInput.current?.click()}><Plus size={18} />{currentAlbum ? `Add files to ${currentAlbum.name}` : "Add your first files"}</button>}<span className="empty-footnote"><ShieldCheck size={14} />No compression. No extra steps.</span></section>}
          <footer className="feed-footer"><span><ArrowLeftRight size={14} />A simple handoff. A little more flow.</span><span>Originals in. Originals out.</span></footer>
        </>}
      </main>
    </div>

    <input ref={fileInput} tabIndex={-1} className="visually-hidden" type="file" multiple aria-label="Choose original files" onChange={event => { if (event.target.files) void selectOriginals(event.target.files); event.target.value = ""; }} />
    <input ref={resumeInput} tabIndex={-1} className="visually-hidden" type="file" aria-label="Choose file to resume" onChange={event => { const file = event.target.files?.[0]; const target = resumeTarget.current; if (file && target) { if (file.size !== target.size) setError("Choose the same original file to resume."); else scheduleTransfer(file, target); } event.target.value = ""; }} />
    {dragging && canUpload && filter !== "trash" && <div className="drop-overlay"><Upload size={52} /><h2>Let it drop.</h2><p>{filter === "final" ? "Send your final cuts" : "Send your originals"}</p></div>}
    {(transfers.length > 0 || download) && <section id="file-transfers" tabIndex={-1} className="transfer-tray" aria-label="File transfers"><div className="tray-heading"><strong>{activeTransfers.length ? <><Radio size={16} />{activeTransfers.length} {activeTransfers.length === 1 ? "transfer" : "transfers"}</> : <><CheckCheck size={17} />{download ? "Saving original" : "All files delivered"}</>}</strong><button className="icon-button" aria-label="Dismiss completed transfers" onClick={() => { for (const transfer of transfers.filter(item => item.state === "complete")) void forgetTransfer(transfer.id); setTransfers(current => current.filter(item => item.state !== "complete")); }}><X size={16} /></button></div><div className="transfer-list">{download && <div className="transfer-row"><ArrowDownToLine size={21} /><div className="transfer-information"><strong>{download.name}</strong><div><span>Saving and verifying</span><span>{download.progress}%</span></div><progress max={100} value={download.progress} aria-label="Download progress" /></div><button className="icon-button" aria-label="Cancel download" onClick={() => download.controller.abort()}><X size={17} /></button></div>}{transfers.map(transfer => <div className="transfer-row" key={transfer.id}><div className="transfer-file-icon"><FileImage size={21} /></div><div className="transfer-information"><strong>{transfer.name}</strong><p>To: {transfer.spaceName || "Library"}{transfer.audienceName ? ` / ${transfer.audienceName}` : ""}{transfer.albumName ? ` / ${transfer.albumName}` : ""}{transfer.sectionName ? ` / ${transfer.sectionName}` : ""}{transfer.accountSpaceId && transfer.accountSpaceId !== accountSpaceId && <> &middot; <a className="text-button" href={`/?space=${encodeURIComponent(transfer.accountSpaceId)}`}>Open destination</a></>}</p><div><span>{transfer.state === "complete" ? "Available in destination library" : statusLabels[transfer.state]}</span><span>{transfer.state === "preparing" ? `${transfer.preparationProgress ?? 0}%` : transfer.state === "sending" ? `${transfer.progress}%` : formatBytes(transfer.size)}</span></div><progress max={100} value={transfer.state === "preparing" ? transfer.preparationProgress ?? 0 : transfer.progress} aria-label={`${transfer.name} ${transfer.state === "preparing" ? "preparation " : ""}progress`} />{transfer.message && <p>{transfer.message}</p>}</div>{transfer.state === "complete" ? <Check size={19} className="success-icon" /> : ["sending", "preparing", "queued"].includes(transfer.state) ? <button className="icon-button" aria-label={`Pause ${transfer.name}`} onClick={() => controllers.current.get(transfer.id)?.abort()}><Pause size={17} /></button> : <div className="transfer-actions"><button className="icon-button" aria-label={`Resume ${transfer.name}`} onClick={() => resumeTransfer(transfer)}><Play size={17} /></button>{transfer.state === "error" && <button className="icon-button" aria-label={`Restart ${transfer.name}`} onClick={event => { event.currentTarget.focus(); void restartTransfer(transfer); }}><RefreshCw size={16} /></button>}<button className="icon-button" aria-label={`Cancel ${transfer.name}`} onClick={event => { event.currentTarget.focus(); void cancelUpload(transfer.id, transfer.name); }}><X size={15} /></button></div>}</div>)}</div>{activeTransfers.length > 0 && <p className="tray-note">Keep this tab open while sending.</p>}</section>}
    {confirmation}
    {notice && <div className="toast" role="status"><Check size={17} />{notice}</div>}

    {(modal === "deliveries" || modal === "delivery-create") && accountSpaceId && session?.deliveries && isOwner && <DeliveryManager key={modal} spaceId={accountSpaceId} spaceName={session.space.name} personal={session.space.kind === "personal"} files={visibleItems.filter(item => selectedIds.has(item.id))} create={modal === "delivery-create"} onClose={() => setModal(null)} />}
    {modal === "upload-requests" && accountSpaceId && session?.uploadRequests && isOwner && <UploadRequests spaceId={accountSpaceId} spaceName={session.space.name} restricted={Boolean(session.restrictedScopes)} onClose={() => { setModal(null); void refreshLibrary().catch(failure => setError(failure.message)); }} />}
    {scopeCopyItem && accountSpaceId && <ScopeCopyDialog item={scopeCopyItem} spaceId={accountSpaceId} onClose={() => { setScopeCopyItem(null); void refreshLibrary().catch(failure => setError(failure.message)); }} />}
    {publicationItem && accountSpaceId && <PublicationDialog item={publicationItem} sourceSpaceId={accountSpaceId} libraries={accountLibraries} onClose={() => { setPublicationItem(null); setScopeCopyItem(null); void refreshStorage().catch(failure => setError(failure.message)); }} />}
    {modal === "devices" && <ModalFrame title="Your connected devices" onClose={() => setModal(null)}>
      {error && <p role="alert" className="error-banner">{error}</p>}
      <p className="modal-intro">{isOwner ? "You are an owner. Manage who can use this shared space." : "You are a member. Upload, browse, and save files; an owner manages access and shared-file removal."}</p>
      <div className="device-list">{devices.map(device => <div key={device.id} className="device-row">
        <span className="device-symbol">{/phone|iphone|android/i.test(device.name) ? <Smartphone size={22} /> : <Laptop size={22} />}</span>
        <div><strong>{device.name}</strong><p>{device.role === "owner" ? "Owner" : "Member"}{device.current ? " · This device" : ""}</p></div>
        {device.current ? <span className="pill">YOU</span> : isOwner && <div className="device-actions">
          <button className="text-button" disabled={deviceAccessBusy} onClick={event => { event.currentTarget.focus(); void changeDeviceRole(device); }}>{device.role === "owner" ? "Make member" : "Make owner"}</button>
          <button className="text-button danger" disabled={deviceAccessBusy} onClick={event => { event.currentTarget.focus(); void disconnectDevice(device.id); }}>Disconnect</button>
        </div>}
      </div>)}</div>
      {isOwner && <div className="pair-panel"><Link2 size={22} /><h3>Bring another device along.</h3>
        <p>Invited devices join as members. They can upload and save every file in this space. Only owners manage access and remove shared files.</p>
        {qr ? <><img className={clock >= inviteExpiresAt ? "expired-qr" : ""} src={qr} width={200} height={200} alt="Scan to join this shared space" />
          <p className="small-muted">{clock >= inviteExpiresAt ? "Invitation expired. Create a new one below." : `Single use · ${Math.ceil((inviteExpiresAt - clock) / 60000)} min remaining`}</p>
          <button className="button secondary" disabled={clock >= inviteExpiresAt} onClick={() => { void navigator.clipboard.writeText(inviteLink).then(() => setNotice("Invitation link copied.")).catch(() => setError("Couldn't copy. Select the invitation link below.")); }}><Copy size={16} />Copy invitation link</button>
          <input className="invite-url" readOnly value={inviteLink} aria-label="Invitation link" onFocus={event => event.target.select()} />
          <button className="text-button" disabled={inviteBusy} onClick={() => void createInvitation()}><RefreshCw size={13} />Create a new invitation</button>
        </> : <button className="button primary" disabled={inviteBusy} onClick={() => void createInvitation()}>{inviteBusy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}Pair a device</button>}
        {session?.transport === "local" && <p className="small-muted">This local link works only on this computer. Phone pairing needs a hosted address.</p>}
      </div>}
      <div className="device-access-note"><p className="small-muted">Original files keep their metadata, which may include location. Disconnecting a device blocks new access; download links already issued may work for up to one hour.</p>
        {isLastOwner && <p className="small-muted">Keep another trusted device as an owner before disconnecting this one. It can help you recover access if this browser is lost or cleared.</p>}
        <button className="button secondary full-width" disabled={deviceAccessBusy || isLastOwner} onClick={event => { event.currentTarget.focus(); void disconnectThisDevice(); }}>{deviceAccessBusy ? "Updating access…" : "Disconnect this device"}</button>
      </div>
    </ModalFrame>}
    {modal === "storage" && <ModalFrame title={storage?.pooled ? "Your combined storage" : session?.space.kind === "personal" ? "Your personal storage" : "Your shared storage"} onClose={() => setModal(null)}>{error && <p role="alert" className="error-banner">{error}</p>}{storage ? <><p className="modal-intro">{storage.pooled ? storage.poolUsed !== undefined ? `${formatBytes(storage.poolUsed)} of ${formatBytes(storage.limit)} used across your personal and shared spaces.` : `${formatBytes(storage.used)} used in this library. Its ${formatBytes(storage.limit)} allowance is shared with another library.` : `${formatBytes(storage.used)} of ${formatBytes(storage.limit)} used.`} Originals stay until you choose to remove them.</p><progress className="storage-meter" max={storage.limit} value={storage.poolUsed ?? storage.used} aria-label={storage.poolUsed !== undefined ? "Combined storage used" : "This library storage used"} /><p className="small-muted">{formatBytes(storage.reserved)} reserved for unfinished uploads · {formatBytes(storage.trash)} in Trash. Trash continues to use storage.</p><button className="button secondary" onClick={() => { setModal(null); setFilter("trash"); }}>Open Trash</button><p className="small-muted">{storage.pooled ? "Files remain private to their own library. The shared allowance counts originals, previews, Trash and unfinished uploads. The details below apply only to this library." : session?.space.kind === "personal" ? "Only your personal files are included." : storage.allScopeBilling ? "Owner billing totals include every audience in this space. File lists show only content you can access." : "Usage shows content you can access; the limit applies to the whole space."}</p><h3 className="storage-heading">Unfinished uploads you can access</h3>{storage.uploads.length ? storage.uploads.map(upload => <div className="device-row" key={upload.id}><div><strong>{upload.name}</strong><p>{formatBytes(upload.size)} · {upload.deviceName}</p></div>{Boolean(upload.canCancel) && <button className="text-button danger" onClick={event => { event.currentTarget.focus(); void cancelUpload(upload.id, upload.name); }}>{upload.publication ? "Cancel publication" : "Cancel upload"}</button>}</div>) : <p className="small-muted">No unfinished transfers are available to you.</p>}</> : <p>Loading storage…</p>}</ModalFrame>}
    {modal === "help" && <ModalFrame title="A simple way to pass it on." onClose={() => setModal(null)}><div className="help-step"><span>01</span><div><h3>Drop your originals.</h3><p>Add files or drag them into your shared space. Relay sends the original bytes, without re-encoding.</p></div></div><div className="help-step"><span>02</span><div><h3>Save. Then make it yours.</h3><p>Save to device starts an original-file download. Edit locally in whichever tools you love.</p></div></div><div className="help-step"><span>03</span><div><h3>Drop the final cut.</h3><p>Open Final cuts and add your export. It is immediately available once the transfer finishes.</p></div></div><p className="modal-intro">Everyone paired to a space can view and save its files. Originals keep their metadata, including any embedded location. Albums group files without making copies. Removing a file from an album keeps it in the library. Owners and account editors can organise shared files. Only owners manage access or permanently delete files.</p><div className="help-note"><ShieldCheck size={20} /><p>Keep this browser tab open during uploads. After a reload, choose the same file to resume. Browser downloads go to Downloads or the location you select. Direct saving to Photos requires the native mobile app.</p></div></ModalFrame>}
    {modal && typeof modal === "object" && <MediaViewer item={modal} items={visibleItems} saving={savingVerified} onNavigate={setModal} onClose={() => setModal(null)} onSave={() => void saveOriginal(modal)} onCopyAudience={session?.restrictedScopes && session.role === "owner" && !modal.archivedAt ? () => { setScopeCopyItem(modal); setModal(null); } : undefined} onPublish={session?.space.kind === "personal" && !modal.archivedAt ? () => { setPublicationItem(modal); setModal(null); } : undefined} preview={<MediaPreview key={modal.id} item={modal} large />} thumbnail={item => <MediaPreview item={item} />}>
      <div className="detail-metadata"><span>{modal.category === "final" ? "Final cut" : "Original"}</span><span>{formatBytes(modal.size)}</span><span>{modal.mime}</span></div><p className="small-muted">Shared by {modal.deviceName}</p><dl className="file-details"><dt>Uploaded name</dt><dd>{modal.originalName || modal.name}</dd><dt>Uploaded</dt><dd>{new Date(modal.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC</dd><dt>Date taken</dt><dd>{modal.capturedAt?.replace("T", " ") || "Unknown - browsing uses upload date"}</dd></dl><div className="detail-actions">{canEditFile(modal) && !modal.archivedAt && <><button className="button secondary compact" onClick={() => { setRenameItems([modal]); setModal(null); }}>Rename file</button><button className="text-button" onClick={() => { setDateItem(modal); setModal(null); }}>Correct capture date</button></>}{modal.uploadBatch && <button className="text-button" onClick={() => { changeLibraryQuery({ ...emptyLibraryQuery, scope: libraryQuery.scope, batch: modal.uploadBatch! }); setFilter("all"); setSearch(""); setModal(null); }}>View upload batch</button>}</div><details className="integrity-details"><summary>Original file fingerprint</summary><code>{modal.sha256}</code><p>SHA-256 of the file selected for upload. Browser-managed downloads do not verify this automatically.</p></details>
      {/* The earlier inline preview dialog is superseded by MediaViewer; its styles are removal candidates after release approval. */}
    </MediaViewer>}
  </div>;
}
