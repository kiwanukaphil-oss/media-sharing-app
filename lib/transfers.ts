import { hashOriginalChunks } from "./hash-original";
import { createLibraryApi, RequestError } from "./api-client";
import { readCaptureDate } from "./capture-date";
import { publishPreview } from "./previews";
import type { Category, UploadSession } from "./contracts";

export type Transfer = {
  id: string; deviceId: string; accountSpaceId?: string; spaceName?: string; name: string; size: number; mime: string; category: Category;
  accessScopeId?: string | null; audienceName?: string; albumId?: string; albumName?: string; sectionId?: string; sectionName?: string; capturedAt?: string; uploadBatch?: string;
  hash?: string; partSize?: number; uploadId?: string; parts: { partNumber: number; etag: string }[];
  state: "queued" | "preparing" | "sending" | "finalizing" | "paused" | "offline" | "elsewhere" | "needs-access" | "needs-file" | "error" | "complete";
  recovery?: "session" | "copy" | "handle"; storageWarning?: boolean; userPaused?: boolean; createdAt?: number;
  intentVersion?: number;
  lastModified?: number; errorStatus?: number; retryAfterMs?: number; sentBytes?: number;
  bytesPerSecond?: number;
  progress: number; preparationProgress?: number; message?: string;
};

// Tiny synchronous intent records close the reload gap before IndexedDB commits a pause/resume.
export function rememberUploadIntent(transfer: Transfer) {
  try { localStorage.setItem(`relay-upload-intent:${transfer.id}`, JSON.stringify({ deviceId: transfer.deviceId, userPaused: transfer.userPaused, intentVersion: transfer.intentVersion })); }
  catch { /* Storage-denied sessions retain in-memory intent only. */ }
}

function restoreUploadIntent(transfer: Transfer): Transfer {
  try {
    const intent = JSON.parse(localStorage.getItem(`relay-upload-intent:${transfer.id}`) || "null") as Pick<Transfer, "deviceId" | "userPaused" | "intentVersion"> | null;
    if (intent?.deviceId === transfer.deviceId && (intent.intentVersion ?? 0) >= (transfer.intentVersion ?? 0)) return { ...transfer, ...intent };
  } catch { /* IndexedDB remains the fallback when optional intent storage is unavailable. */ }
  return transfer;
}

// Bound storage startup so a blocked browser database becomes an actionable error.
function openTransferDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("relay-transfers", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("transfers", { keyPath: "id" });
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; reject(new Error("Browser storage is taking too long. Close other Relay tabs and retry.")); }, 10000);
    opening.onsuccess = () => { clearTimeout(timeout); if (timedOut) opening.result.close(); else resolve(opening.result); };
    opening.onerror = () => { clearTimeout(timeout); reject(new Error("Allow browser storage to keep transfer progress.")); };
  });
}
// Persist manifests separately from the bounded optional source-recovery database.
export async function persistTransfer(transfer: Transfer) {
  const db = await openTransferDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("transfers", "readwrite");
      const store = transaction.objectStore("transfers");
      const previous = store.get(transfer.id);
      previous.onsuccess = () => {
        const saved = previous.result as Transfer | undefined;
        // Late progress writes cannot undo a newer explicit pause or resume, even across reloads.
        const newerIntent = saved && (saved.intentVersion ?? 0) > (transfer.intentVersion ?? 0);
        store.put(newerIntent && transfer.state !== "complete" ? { ...transfer, intentVersion: saved.intentVersion, userPaused: saved.userPaused, ...(saved.userPaused ? { state: "paused" } : {}) } : transfer);
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function restoreTransfers(deviceId: string, accountSpaces?: { id: string; actorId?: string | null }[]): Promise<Transfer[]> {
  const db = await openTransferDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const reading = db.transaction("transfers").objectStore("transfers").getAll();
      reading.onsuccess = () => resolve((reading.result as Transfer[]).filter(item => (accountSpaces ? accountSpaces.some(space => space.id === item.accountSpaceId && space.actorId === item.deviceId) : item.accountSpaceId === undefined && item.deviceId === deviceId) && item.state !== "complete").map(restoreUploadIntent));
      reading.onerror = () => reject(reading.error);
    });
  } finally { db.close(); }
}
export async function readTransfer(id: string): Promise<Transfer | undefined> {
  const db = await openTransferDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("transfers").objectStore("transfers").get(id);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
// Remove a manifest only after explicit cancellation or dismissing a completed transfer.
export async function forgetTransfer(id: string) {
  try { localStorage.removeItem(`relay-upload-intent:${id}`); } catch { /* Optional intent storage. */ }
  const db = await openTransferDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("transfers", "readwrite");
      transaction.objectStore("transfers").delete(id);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
// Remove this device's private queue metadata after sign-out without touching other device manifests.
export async function forgetDeviceTransfers(deviceId: string) {
  try {
    for (const key of Object.keys(localStorage).filter(key => key.startsWith("relay-upload-intent:"))) {
      const intent = JSON.parse(localStorage.getItem(key) || "null");
      if (intent?.deviceId === deviceId) localStorage.removeItem(key);
    }
  } catch { /* Revocation still clears the supported IndexedDB store. */ }
  const db = await openTransferDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("transfers", "readwrite");
      const cursor = transaction.objectStore("transfers").openCursor();
      cursor.onsuccess = () => {
        const record = cursor.result;
        if (!record) return;
        if ((record.value as Transfer).deviceId === deviceId) record.delete();
        record.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

// Move integrity checks off the UI thread; terminate promptly when a transfer is paused.
export async function hashOriginal(file: File, signal: AbortSignal, onProgress?: (progress: number) => void): Promise<string> {
  signal.throwIfAborted();
  if (typeof Worker === "undefined") return hashOriginalChunks(file, signal, onProgress);
  try {
    return await new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL("./hash-original.worker.ts", import.meta.url), { type: "module" });
      const cleanup = () => { worker.terminate(); signal.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); reject(new DOMException("Transfer paused", "AbortError")); };
      worker.onmessage = ({ data }: MessageEvent<{ progress?: number; hash?: string; error?: string }>) => {
        if (data.progress !== undefined) onProgress?.(data.progress);
        if (data.hash) { cleanup(); resolve(data.hash); }
        if (data.error) { cleanup(); reject(new Error(data.error)); }
      };
      worker.onerror = event => { event.preventDefault(); cleanup(); reject(new Error("File preparation unavailable.")); };
      signal.addEventListener("abort", abort, { once: true });
      worker.postMessage(file);
    });
  } catch (error) {
    if (signal.aborted) throw error;
    // Restricted browsers can still prepare originals with bounded, yielding chunks.
    return hashOriginalChunks(file, signal, onProgress);
  }
}
// XMLHttpRequest exposes real bytes sent; aborting leaves completed multipart parts reusable.
export function sendPart(url: string, blob: Blob, signal: AbortSignal, onProgress: (sent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    let stalled = false;
    let activityTimer: ReturnType<typeof setTimeout>;
    const trackActivity = () => { clearTimeout(activityTimer); activityTimer = setTimeout(() => { stalled = true; xhr.abort(); }, 45000); };
    const abort = () => xhr.abort();
    const finish = (error?: Error, etag?: string) => {
      clearTimeout(activityTimer);
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(etag!);
    };
    xhr.open("PUT", url);
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = event => { trackActivity(); onProgress(event.loaded); };
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag")?.replace(/^"|"$/g, "");
      if (xhr.status >= 200 && xhr.status < 300 && etag) finish(undefined, etag);
      else finish(new RequestError("That part didn't arrive. Retry to continue where you left off.", xhr.status));
    };
    xhr.onerror = () => finish(new Error("Connection interrupted. Retry when you're back online."));
    xhr.ontimeout = () => finish(new Error("The connection timed out. Retry to resume."));
    xhr.onabort = () => finish(stalled ? new Error("Upload stalled. Retrying the connection.") : new DOMException("Transfer paused", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { finish(new DOMException("Transfer paused", "AbortError")); return; }
    trackActivity(); xhr.send(blob);
  });
}
// Confirm file identity before resuming, save each ETag, and publish only after completion.
export async function uploadOriginal(file: File, initial: Transfer, signal: AbortSignal, onChange: (transfer: Transfer) => void, beforePersist: (transfer: Transfer) => Transfer = transfer => transfer) {
  const { requestJson } = createLibraryApi(initial.accountSpaceId);
  let current: Transfer = { ...initial, parts: [...initial.parts], state: "preparing", message: undefined };
  const update = (patch: Partial<Transfer>) => { current = { ...current, ...patch }; onChange(current); };
  const save = async () => { try { await persistTransfer(beforePersist(current)); } catch { update({ storageWarning: true }); } };
  update({ state: "preparing", preparationProgress: 0 });
  try {
    const hash = await hashOriginal(file, signal, preparationProgress => update({ preparationProgress }));
    if (current.hash && current.hash !== hash) {
      update({ state: "needs-file", message: "This is a different file. Choose the original file to resume." });
      await save(); return current;
    }
    update({ hash, capturedAt: current.capturedAt || await readCaptureDate(file) });
    await save();
    const session = await requestJson<UploadSession>("uploads", { method: "POST", signal, body: JSON.stringify({ id: current.id, name: current.name, mime: current.mime, size: current.size, category: current.category, sha256: hash, accessScopeId: current.accessScopeId ?? null, albumId: current.albumId, sectionId: current.sectionId, capturedAt: current.capturedAt, uploadBatch: current.uploadBatch }) });
    update({ partSize: session.partSize, state: "sending", uploadId: session.uploadId, ...(current.uploadId && session.uploadId && current.uploadId !== session.uploadId ? { parts: [], progress: 0 } : {}) });
    await save();
    const total = Math.ceil(file.size / session.partSize);
    if (session.status !== "ready") {
      for (let number = 1; number <= total; number++) {
        signal.throwIfAborted();
        if (current.parts.some(part => part.partNumber === number)) continue;
        const blob = file.slice((number - 1) * session.partSize, number * session.partSize);
        const completedBytes = current.parts.reduce((sum, part) => sum + Math.min(session.partSize, file.size - (part.partNumber - 1) * session.partSize), 0);
        let etag = "";
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const { url } = await requestJson<{ url: string }>(`uploads/${current.id}/part`, { method: "POST", signal, body: JSON.stringify({ number }) });
            etag = await sendPart(url, blob, signal, sent => update({ sentBytes: completedBytes + sent, progress: Math.min(99, Math.round((completedBytes + sent) / file.size * 100)) }));
            break;
          } catch (error) {
            if (signal.aborted || attempt === 2 || (error instanceof RequestError && error.status < 500 && ![408, 429].includes(error.status))) throw error;
            const delay = error instanceof RequestError && error.retryAfterMs ? error.retryAfterMs : 750 * 2 ** attempt + Math.random() * 400;
            if (delay > 30000) throw error;
            await new Promise<void>((resolve, reject) => {
              const abort = () => { clearTimeout(timer); reject(new DOMException("Paused", "AbortError")); };
              const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, delay);
              signal.addEventListener("abort", abort, { once: true });
            });
          }
        }
        current.parts.push({ partNumber: number, etag });
        await save();
      }
      signal.throwIfAborted();
      update({ state: "finalizing", sentBytes: file.size });
      await requestJson(`uploads/${current.id}/complete`, { method: "POST", signal, body: JSON.stringify({ parts: current.parts }) });
    }
    update({ state: "complete", progress: 100, sentBytes: file.size, message: undefined });
    await save();
    await publishPreview(file, current.id, signal, initial.accountSpaceId).catch(() => {});
  } catch (error) {
    if (current.state !== "complete") update({ state: signal.aborted ? "paused" : "error", errorStatus: error instanceof RequestError ? error.status : undefined, retryAfterMs: error instanceof RequestError ? error.retryAfterMs : undefined, message: signal.aborted ? undefined : error instanceof Error ? error.message : "Couldn't send this file. Please retry." });
  }
  await save();
  return current;
}
