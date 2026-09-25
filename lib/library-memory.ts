import type { FeedPage } from "./contracts";

type FeedSnapshot = { page: FeedPage; depth: number; savedAt: number };
type Thumbnail = { url: string; bytes: number; savedAt: number };
type Invalidation = "lists" | "access";

// One mounted workspace owns this bounded memory cache. Nothing is persisted or publicly cached.
export class LibraryMemory {
  identity = "";
  private feeds = new Map<string, FeedSnapshot>();
  private thumbnails = new Map<string, Thumbnail>();
  private pendingFeeds = new Map<string, Promise<FeedPage>>();
  private pendingThumbnails = new Map<string, Promise<string>>();
  private controllers = new Set<AbortController>();
  private listeners = new Set<(reason: Invalidation) => void>();
  private epoch = 0;
  private accessEpoch = 0;
  private thumbnailBytes = 0;
  private activeThumbnails = 0;
  private thumbnailQueue: (() => void)[] = [];
  private warming = false;
  private intentTimer: ReturnType<typeof setTimeout> | undefined;
  readonly albumPositions = new Map<string, { section: string; y: number }>();
  warmView: ((album: string | undefined, section?: string) => void) | undefined;

  setIdentity(identity: string) {
    if (this.identity !== identity) { this.invalidate("access"); this.identity = identity; }
  }
  setWarmView(callback: LibraryMemory["warmView"]) { this.warmView = callback; }
  subscribe(listener: (reason: Invalidation) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  peek(query: string) {
    const entry = this.feeds.get(query);
    return entry && Date.now() - entry.savedAt < 30_000 ? entry : undefined;
  }
  // Writes expire lists; authority changes additionally revoke blobs, cancel work and forget navigation.
  invalidate(reason: Invalidation = "lists") {
    this.epoch++; this.feeds.clear(); this.pendingFeeds.clear();
    clearTimeout(this.intentTimer);
    if (reason === "access") {
      this.accessEpoch++;
      this.controllers.forEach(controller => controller.abort());
      this.thumbnails.forEach(entry => URL.revokeObjectURL(entry.url));
      this.thumbnails.clear(); this.pendingThumbnails.clear(); this.thumbnailBytes = 0;
      this.albumPositions.clear();
    }
    this.listeners.forEach(listener => listener(reason));
  }

  // Identical concurrent reads share a request. Epochs reject responses predating mutations/revocation.
  readFeed(query: string, depth: number, load: (signal: AbortSignal) => Promise<FeedPage>, signal?: AbortSignal) {
    const key = `${depth}:${query}`;
    const existing = this.pendingFeeds.get(key);
    if (existing) return existing;
    const epoch = this.epoch, controller = new AbortController();
    this.controllers.add(controller);
    const request = load(AbortSignal.any([controller.signal, AbortSignal.timeout(20_000), ...(signal ? [signal] : [])])).then(page => {
      if (epoch !== this.epoch || controller.signal.aborted || signal?.aborted) throw new DOMException("Superseded", "AbortError");
      const previous = this.feeds.get(query);
      if (previous && JSON.stringify(previous.page) !== JSON.stringify(page)) { this.epoch++; this.feeds.clear(); this.pendingFeeds.clear(); }
      this.feeds.delete(query);
      if (page.items.length <= 500) this.feeds.set(query, { page, depth, savedAt: Date.now() });
      while (this.feeds.size > 12 || [...this.feeds.values()].reduce((sum, entry) => sum + entry.page.items.length, 0) > 1200) this.feeds.delete(this.feeds.keys().next().value!);
      return page;
    }).finally(() => { this.controllers.delete(controller); if (this.pendingFeeds.get(key) === request) this.pendingFeeds.delete(key); });
    this.pendingFeeds.set(key, request);
    return request;
  }
  thumbnail(url: string) {
    const entry = this.thumbnails.get(url);
    if (!entry) return undefined;
    if (Date.now() - entry.savedAt > 120_000) { this.removeThumbnail(url); return undefined; }
    return entry.url;
  }
  private removeThumbnail(key: string) {
    const entry = this.thumbnails.get(key);
    if (entry) { URL.revokeObjectURL(entry.url); this.thumbnailBytes -= entry.bytes; this.thumbnails.delete(key); }
  }

  // Lazy consumers and intent preloads share four download slots and at most 24 MiB of thumbnails.
  loadThumbnail(url: string): Promise<string> {
    const cached = this.thumbnail(url);
    if (cached) { const entry = this.thumbnails.get(url)!; this.thumbnails.delete(url); this.thumbnails.set(url, entry); return Promise.resolve(cached); }
    const pending = this.pendingThumbnails.get(url);
    if (pending) return pending;
    const epoch = this.accessEpoch;
    const request = (async () => {
      if (this.activeThumbnails >= 4) await new Promise<void>(resolve => this.thumbnailQueue.push(resolve));
      else this.activeThumbnails++;
      const controller = new AbortController(); this.controllers.add(controller);
      try {
        if (epoch !== this.accessEpoch) throw new DOMException("Superseded", "AbortError");
        const response = await fetch(url, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]), cache: "no-store" });
        if ([401, 403].includes(response.status)) { this.invalidate("access"); throw new Error("Preview no longer available"); }
        if (!response.ok) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (epoch !== this.accessEpoch || controller.signal.aborted) throw new DOMException("Superseded", "AbortError");
        if (blob.size > 2 * 1024 ** 2 || !blob.type.startsWith("image/")) throw new Error("Invalid thumbnail");
        const objectUrl = URL.createObjectURL(blob);
        this.thumbnails.set(url, { url: objectUrl, bytes: blob.size, savedAt: Date.now() }); this.thumbnailBytes += blob.size;
        while (this.thumbnails.size > 160 || this.thumbnailBytes > 24 * 1024 ** 2) this.removeThumbnail(this.thumbnails.keys().next().value!);
        return objectUrl;
      } finally { this.controllers.delete(controller); const next = this.thumbnailQueue.shift(); if (next) next(); else this.activeThumbnails--; }
    })().finally(() => { if (this.pendingThumbnails.get(url) === request) this.pendingThumbnails.delete(url); });
    this.pendingThumbnails.set(url, request);
    return request;
  }

  // Intent warming is deliberately small, delayed and disabled on data-saving/slow connections.
  cancelWarm() { clearTimeout(this.intentTimer); }
  scheduleWarm(action: () => Promise<void>) {
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType || "") || !navigator.onLine || this.warming) return;
    clearTimeout(this.intentTimer);
    this.intentTimer = setTimeout(() => {
      this.warming = true;
      void action().catch(() => {}).finally(() => { this.warming = false; });
    }, 180);
  }
}
