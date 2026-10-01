"use client";

import { createLibraryApi, RequestError } from "./api-client";
import type { Session } from "./contracts";
import { forgetDeviceTransfers, forgetTransfer, hashOriginal, persistTransfer, readTransfer, rememberUploadIntent, restoreTransfers, uploadOriginal, type Transfer } from "./transfers";
import { readOriginalHandle, recoverOriginal, releaseActorOriginals, releaseOriginal, retainOriginal } from "./upload-sources";

type Identity = { id?: string; actorId?: string | null; role?: string };
type UploadStatus = { status: string; uploadId: string; partSize: number; size: number; sha256: string };
export const runningUploadStates = ["queued", "preparing", "sending", "finalizing"];
const emptyUploads: Transfer[] = [];

// This client-only store owns file objects and tasks independently of mounted pages and panels.
class UploadManager {
  private jobs: Transfer[] = emptyUploads;
  private listeners = new Set<() => void>();
  private originals = new Map<string, File>();
  private tasks = new Map<string, Promise<void>>();
  private controllers = new Map<string, AbortController>();
  private identities: Identity[] = [];
  private restoring = new Set<string>();
  private cancelling = new Set<string>();
  private serial: Promise<unknown> = Promise.resolve();
  private generation = 0;
  private retryCounts = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.jobs;
  serverSnapshot = () => emptyUploads;
  private allowed = (job: Transfer) => this.identities.some(identity => identity.id === job.accountSpaceId && identity.actorId === job.deviceId);
  private publish() { this.listeners.forEach(listener => listener()); }
  private update(job: Transfer) {
    if (!this.allowed(job)) return;
    this.jobs = this.jobs.some(entry => entry.id === job.id) ? this.jobs.map(entry => entry.id === job.id ? job : entry) : [...this.jobs, job];
    this.publish();
  }
  private patch(id: string, patch: Partial<Transfer>) { const job = this.jobs.find(entry => entry.id === id); if (job) this.update({ ...job, ...patch }); }
  private async save(job: Transfer) {
    try { await persistTransfer(job); }
    catch { this.patch(job.id, { storageWarning: true }); }
  }

  // Only server-resolved actor/workspace pairs may restore local names or access retained sources.
  async authorize(identities: Identity[], mode: "account" | "legacy" | "all" = "all") {
    this.identities = [...identities, ...(mode === "all" ? [] : this.identities.filter(identity => mode === "account" ? identity.id === undefined : identity.id !== undefined))];
    for (const actor of this.restoring) if (!this.identities.some(identity => identity.actorId === actor)) this.restoring.delete(actor);
    for (const job of this.jobs) if (!this.allowed(job)) { this.controllers.get(job.id)?.abort(); this.originals.delete(job.id); }
    this.jobs = this.jobs.filter(job => this.allowed(job)); this.publish();
    const generation = this.generation;
    for (const identity of identities) {
      if (!identity.actorId || this.restoring.has(identity.actorId)) continue;
      this.restoring.add(identity.actorId);
      try {
        const saved = await restoreTransfers(identity.actorId, identity.id ? [{ id: identity.id, actorId: identity.actorId }] : undefined);
        if (generation !== this.generation) return;
        for (const job of saved) {
          if (!this.allowed(job) || this.jobs.some(entry => entry.id === job.id)) continue;
          this.update({ ...job, state: "paused", userPaused: job.userPaused ?? job.state === "paused", message: "Checking saved progress" });
          void this.restore(job.id).catch(failure => this.patch(job.id, { state: "error", message: failure instanceof Error ? failure.message : "Could not recover upload" }));
        }
      } catch { /* New in-session uploads remain usable when recovery storage is unavailable. */ }
    }
  }

  async registerSession(session: Session, accountSpaceId?: string, accountSpaces?: { id: string; actorId?: string | null; role?: string }[]) {
    if (accountSpaces) await this.authorize(accountSpaces.map(identity => identity.id === accountSpaceId ? { ...identity, actorId: session.deviceId, role: session.role } : identity), "account");
    else await this.authorize([...this.identities.filter(identity => identity.id !== accountSpaceId), { id: accountSpaceId, actorId: session.deviceId, role: session.role }]);
  }

  // A ready server receipt is authoritative even when the local completion response was lost.
  private async reconcile(job: Transfer, signal?: AbortSignal) {
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
    const api = createLibraryApi(job.accountSpaceId);
    const session = await api.requestJson<Session>("session", { signal, cache: "no-store" });
    if (session.deviceId !== job.deviceId || session.role === "viewer") throw new RequestError("Upload access changed. Open its destination to review access.", 403);
    if (!job.hash && !job.uploadId) return false;
    try {
      const receipt = await api.requestJson<UploadStatus>(`uploads/${job.id}`, { signal, cache: "no-store" });
      if (receipt.status === "ready") { await this.complete(job); return true; }
      if (receipt.status !== "uploading") throw new RequestError("This upload is no longer available. Review its destination.", 409);
      if (job.hash && receipt.sha256 !== job.hash) throw new RequestError("The saved original no longer matches this upload.", 409);
      if (receipt.uploadId !== job.uploadId) this.patch(job.id, { uploadId: receipt.uploadId, partSize: receipt.partSize, parts: [], progress: 0, sentBytes: 0 });
    } catch (failure) {
      if (!(failure instanceof RequestError && failure.status === 404 && !job.uploadId)) throw failure;
    }
    return false;
  }

  private async complete(job: Transfer) {
    const complete = { ...job, state: "complete" as const, progress: 100, sentBytes: job.size, message: undefined, userPaused: false };
    this.update(complete); await this.save(complete);
    this.originals.delete(job.id); await releaseOriginal(job.id);
    window.dispatchEvent(new CustomEvent("relay-upload-complete", { detail: { accountSpaceId: job.accountSpaceId } }));
  }

  // Recover source access without prompting; deliberate pauses survive reload and network recovery.
  async restore(id: string) {
    const job = this.jobs.find(entry => entry.id === id);
    if (!job || this.tasks.has(id)) return;
    try {
      if (!navigator.onLine) { this.patch(id, { state: "offline", message: undefined }); return; }
      if (await this.reconcile(job)) return;
      if (!this.allowed(job) || !this.jobs.some(entry => entry.id === id)) return;
      const source = this.originals.has(id) ? { file: this.originals.get(id) } : await recoverOriginal(job);
      if (!this.allowed(job) || !this.jobs.some(entry => entry.id === id)) return;
      if (source.file) {
        this.originals.set(id, source.file);
        this.patch(id, { state: job.userPaused ? "paused" : "queued", message: undefined });
        if (!job.userPaused) this.schedule(id);
      } else this.patch(id, { state: source.permission ? "needs-access" : "needs-file", message: undefined });
    } catch (failure) { this.patch(id, { state: navigator.onLine ? "error" : "offline", errorStatus: failure instanceof RequestError ? failure.status : undefined, message: failure instanceof Error ? failure.message : "Could not recover upload" }); }
  }

  // Metadata similarity is advisory; distinct same-named originals are never skipped or blocked.
  enqueue(file: File, job: Transfer) {
    if (!this.allowed(job)) return false;
    // Suppress repeated selection of the same still-pending source in the same destination only.
    if (this.jobs.some(entry => entry.state !== "complete" && entry.accountSpaceId === job.accountSpaceId && entry.albumId === job.albumId && entry.sectionId === job.sectionId && entry.category === job.category && entry.accessScopeId === job.accessScopeId && this.originals.get(entry.id) === file)) return false;
    this.originals.set(job.id, file);
    const similar = this.jobs.some(entry => entry.state !== "complete" && entry.accountSpaceId === job.accountSpaceId && entry.albumId === job.albumId && entry.sectionId === job.sectionId && entry.name === file.name && entry.size === file.size && entry.lastModified === file.lastModified);
    this.update({ ...job, lastModified: file.lastModified, createdAt: Date.now(), recovery: "session", state: "queued", userPaused: false, message: similar ? "Similar filename queued. Both originals are kept." : undefined });
    const initial = this.jobs.find(entry => entry.id === job.id); if (initial) void this.save(initial);
    this.schedule(job.id); return true;
  }

  // One bounded transfer lane, with immediate queued-item controls and an exclusive cross-tab lock.
  private schedule(id: string) {
    if (this.tasks.has(id)) return;
    const generation = this.generation;
    const task = this.serial.catch(() => {}).then(async () => {
      const job = this.jobs.find(entry => entry.id === id);
      if (!job || job.state !== "queued" || this.cancelling.has(id) || generation !== this.generation) return;
      if (!navigator.onLine) { this.patch(id, { state: "offline" }); return; }
      const run = async () => {
        const controller = new AbortController(); this.controllers.set(id, controller);
        try {
          const saved = await readTransfer(id).catch(() => undefined);
          if (saved && saved.deviceId === job.deviceId && saved.uploadId === job.uploadId && saved.hash === job.hash) this.patch(id, { parts: saved.parts, progress: saved.progress, sentBytes: saved.sentBytes });
          if (await this.reconcile(job, controller.signal)) return;
          const current = this.jobs.find(entry => entry.id === id);
          const file = this.originals.get(id);
          if (!current || current.userPaused || !file || !this.allowed(current) || controller.signal.aborted) return;
          if (!current.recovery || current.recovery === "session") this.patch(id, { recovery: await retainOriginal(current, file) });
          const prepared = this.jobs.find(entry => entry.id === id);
          if (!prepared || prepared.userPaused || controller.signal.aborted) return;
          let sampleTime = Date.now(), sampleBytes = prepared.sentBytes ?? 0, speed = 0;
          const reconcileIntent = (next: Transfer): Transfer => {
            const latest = this.jobs.find(entry => entry.id === id);
            return { ...next, userPaused: latest?.userPaused, intentVersion: latest?.intentVersion, ...(controller.signal.aborted && next.state !== "complete" ? { state: latest?.userPaused ? "paused" : "offline" } : {}) };
          };
          const result = await uploadOriginal(file, prepared, controller.signal, next => {
            const elapsed = (Date.now() - sampleTime) / 1000;
            if (next.state === "sending" && elapsed >= 2 && (next.sentBytes ?? 0) > sampleBytes) {
              const measured = ((next.sentBytes ?? 0) - sampleBytes) / elapsed;
              speed = speed ? speed * .65 + measured * .35 : measured;
              sampleTime = Date.now(); sampleBytes = next.sentBytes ?? 0;
            }
            next = { ...next, bytesPerSecond: next.state === "sending" ? speed : undefined };
            if (this.jobs.some(entry => entry.id === id) && !this.cancelling.has(id)) this.update(reconcileIntent(next));
          }, reconcileIntent);
          if (result.state === "complete") await this.complete(result);
          else if (result.state === "needs-file") this.originals.delete(id);
          else if (result.state === "error") this.retryTransient(result);
        } catch (failure) {
          if (!controller.signal.aborted) {
            this.patch(id, { state: navigator.onLine ? "error" : "offline", errorStatus: failure instanceof RequestError ? failure.status : undefined, message: failure instanceof Error ? failure.message : "Upload interrupted" });
            const failed = this.jobs.find(entry => entry.id === id); if (failed) this.retryTransient(failed);
          }
        } finally {
          const latest = this.jobs.find(entry => entry.id === id); if (latest) await this.save(latest);
          this.controllers.delete(id);
        }
      };
      if (navigator.locks) await navigator.locks.request(`relay-upload:${id}`, { ifAvailable: true }, async lock => {
        if (lock) await run(); else this.patch(id, { state: "elsewhere", message: "Open the other Relay tab to manage this upload." });
      });
      else await run();
    }).finally(() => this.tasks.delete(id));
    this.tasks.set(id, task); this.serial = task;
  }

  // Update the UI immediately and durably record intent without mutating a job owned by another tab.
  async pause(id: string) {
    const job = this.jobs.find(entry => entry.id === id);
    if (!job || ["complete", "elsewhere"].includes(job.state)) return;
    clearTimeout(this.retryTimers.get(id)); this.retryTimers.delete(id);
    const intentVersion = Math.max(Date.now(), (job.intentVersion ?? 0) + 1);
    this.patch(id, { state: "paused", userPaused: true, intentVersion, message: undefined }); this.controllers.get(id)?.abort();
    const paused = { ...job, state: "paused" as const, userPaused: true, intentVersion, message: undefined };
    if (this.controllers.has(id) || !navigator.locks) { rememberUploadIntent(paused); void this.save(paused); }
    else await navigator.locks.request(`relay-upload:${id}`, { ifAvailable: true }, async lock => {
      if (lock) { rememberUploadIntent(paused); await this.save(paused); } else this.patch(id, { state: "elsewhere", userPaused: false, message: "Manage this upload in the other Relay tab." });
    });
  }

  // Resume keeps acknowledged parts and original destination, after the previous task has settled.
  async resume(id: string) {
    const job = this.jobs.find(entry => entry.id === id); if (!job || job.state === "complete") return;
    clearTimeout(this.retryTimers.get(id)); this.retryTimers.delete(id); this.retryCounts.delete(id);
    const intentVersion = Math.max(Date.now(), (job.intentVersion ?? 0) + 1);
    rememberUploadIntent({ ...job, userPaused: false, intentVersion });
    if (this.tasks.has(id) && !this.controllers.has(id)) { this.patch(id, { userPaused: false, intentVersion, state: "queued", message: undefined }); return; }
    await this.tasks.get(id);
    this.patch(id, { userPaused: false, intentVersion });
    await this.restore(id);
  }

  // Permission renewal is only invoked by the user's button; ordinary restore never opens a prompt.
  async allowAccess(id: string) {
    const job = this.jobs.find(entry => entry.id === id); if (!job) return;
    const source = await readOriginalHandle(job);
    if (!this.allowed(job)) return;
    if (source?.handle && await source.handle.requestPermission({ mode: "read" }) === "granted") await this.resume(id);
  }

  // Hash each candidate once and match an entire selection; unrelated originals are never enqueued.
  async locateOriginals(selected: File[], targetId?: string) {
    let matched = 0;
    const candidates = this.jobs.filter(job => ["needs-file", "needs-access", "error"].includes(job.state) && (!targetId || job.id === targetId));
    for (const file of selected) {
      const possible = candidates.filter(job => job.size === file.size && job.hash && !this.originals.has(job.id));
      if (!possible.length) continue;
      const hash = await hashOriginal(file, new AbortController().signal);
      for (const job of possible.filter(entry => entry.hash === hash)) {
        if (!this.allowed(job) || !this.jobs.some(entry => entry.id === job.id)) continue;
        this.originals.set(job.id, file); this.patch(job.id, { userPaused: false, state: "queued", recovery: "session" }); this.schedule(job.id); matched++;
      }
    }
    return matched;
  }

  // Legacy jobs with no recorded digest require an explicit replacement, never a size-only silent match.
  async replaceUnstartedOriginal(id: string, file: File) {
    const job = this.jobs.find(entry => entry.id === id);
    if (!job || job.hash || job.uploadId || job.size !== file.size) throw new Error("Choose a matching unstarted original.");
    this.originals.set(id, file); this.patch(id, { state: "queued", userPaused: false, recovery: "session", lastModified: file.lastModified }); this.schedule(id);
  }

  async restart(id: string) {
    const job = this.jobs.find(entry => entry.id === id); if (!job) return;
    await this.exclusiveChange(id, async () => {
      if (await this.reconcile(job)) return;
      const result = await createLibraryApi(job.accountSpaceId).requestJson<{ uploadId: string }>(`uploads/${id}/restart`, { method: "POST" });
      this.patch(id, { uploadId: result.uploadId, parts: [], progress: 0, sentBytes: 0 });
    });
    await this.resume(id);
  }

  // Cancellation awaits in-flight publication and preserves originals which already reached ready state.
  async cancel(id: string) {
    const job = this.jobs.find(entry => entry.id === id); if (!job || job.state === "complete") return;
    this.cancelling.add(id); await this.pause(id); if (this.controllers.has(id)) await this.tasks.get(id);
    try {
      await this.exclusiveChange(id, async () => {
        if (await this.reconcile(job)) return;
        try { if (job.hash || job.uploadId) await createLibraryApi(job.accountSpaceId).requestJson(`uploads/${id}`, { method: "DELETE" }); }
        catch (failure) { if (!(failure instanceof RequestError && failure.status === 404 && !job.uploadId)) throw failure; }
        await forgetTransfer(id); await releaseOriginal(id); this.originals.delete(id);
        this.jobs = this.jobs.filter(entry => entry.id !== id); this.publish();
      });
    } finally { this.cancelling.delete(id); }
  }

  private async exclusiveChange(id: string, operation: () => Promise<void>) {
    if (!navigator.locks) return operation();
    await navigator.locks.request(`relay-upload:${id}`, { ifAvailable: true }, async lock => {
      if (!lock) throw new Error("This upload is active in another Relay tab.");
      await operation();
    });
  }

  async clearCompleted() {
    for (const job of this.jobs.filter(entry => entry.state === "complete")) { await this.tasks.get(job.id); await forgetTransfer(job.id).catch(() => {}); await releaseOriginal(job.id); }
    this.jobs = this.jobs.filter(entry => entry.state !== "complete"); this.publish();
  }

  connectionChanged() {
    if (!navigator.onLine) {
      for (const job of this.jobs.filter(entry => runningUploadStates.includes(entry.state))) { this.patch(job.id, { state: "offline", message: undefined }); this.controllers.get(job.id)?.abort(); }
    } else for (const job of this.jobs.filter(entry => entry.state === "offline" && !entry.userPaused)) void this.resume(job.id);
  }

  // Retry transient failures a bounded number of times; permission and validation failures need review.
  private retryTransient(job: Transfer) {
    const count = this.retryCounts.get(job.id) ?? 0;
    if (job.userPaused || count >= 3 || !navigator.onLine || (job.errorStatus && job.errorStatus < 500 && ![408, 429].includes(job.errorStatus))) return;
    const delay = Math.max(job.retryAfterMs ?? 0, 2000 * 2 ** count + Math.random() * 1000);
    this.retryCounts.set(job.id, count + 1);
    this.patch(job.id, { message: `Connection interrupted. Retrying in ${Math.ceil(delay / 1000)} seconds.` });
    this.retryTimers.set(job.id, setTimeout(() => { this.retryTimers.delete(job.id); void this.restore(job.id); }, Math.min(delay, 2147483647)));
  }

  refreshElsewhere() {
    for (const job of this.jobs.filter(entry => entry.state === "elsewhere")) void this.restore(job.id);
  }

  stopLibrary(accountSpaceId?: string) {
    // Remove private queue names immediately when the mounted library loses authority.
    void this.authorize(this.identities.filter(identity => identity.id !== accountSpaceId));
  }

  async signOut() {
    const actors = [...new Set(this.identities.flatMap(identity => identity.actorId ? [identity.actorId] : []))];
    this.generation++; this.retryTimers.forEach(timer => clearTimeout(timer)); this.retryTimers.clear(); this.retryCounts.clear(); this.identities = []; this.controllers.forEach(controller => controller.abort()); this.jobs = []; this.originals.clear(); this.publish();
    await Promise.allSettled([...this.tasks.values()]);
    for (const actor of actors) { await forgetDeviceTransfers(actor).catch(() => {}); await releaseActorOriginals(actor); }
    this.restoring.clear();
  }
}

export const uploadManager = new UploadManager();
