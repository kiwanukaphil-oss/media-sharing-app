import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { requestJson } from "./api-client";
import { readCaptureDate } from "./capture-date";
import { publishPreview } from "./previews";
import type { Category, UploadSession } from "./contracts";

export type Transfer = {
  id: string; deviceId: string; name: string; size: number; mime: string; category: Category;
  albumId?: string; albumName?: string; sectionId?: string; sectionName?: string; capturedAt?: string; uploadBatch?: string;
  hash?: string; partSize?: number; uploadId?: string; parts: { partNumber: number; etag: string }[];
  state: "queued" | "preparing" | "sending" | "paused" | "needs-file" | "error" | "complete";
  progress: number; preparationProgress?: number; message?: string;
};

function openTransferDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("relay-transfers", 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore("transfers", { keyPath: "id" });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(new Error("Allow browser storage to keep transfer progress."));
  });
}
// Persist only transfer manifests; source files stay on disk and can be reselected after reload.
export async function persistTransfer(transfer: Transfer) {
  const db = await openTransferDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("transfers", "readwrite");
      transaction.objectStore("transfers").put(transfer);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function restoreTransfers(deviceId: string): Promise<Transfer[]> {
  const db = await openTransferDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const reading = db.transaction("transfers").objectStore("transfers").getAll();
      reading.onsuccess = () => resolve((reading.result as Transfer[]).filter(item => item.deviceId === deviceId && item.state !== "complete").map(item => ({ ...item, state: "needs-file", message: "Choose the same file to resume" })));
      reading.onerror = () => reject(reading.error);
    });
  } finally { db.close(); }
}
// Remove a manifest only after explicit cancellation or dismissing a completed transfer.
export async function forgetTransfer(id: string) {
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

// Hash bounded chunks rather than materializing a multi-gigabyte original in memory.
export async function hashOriginal(file: File, signal: AbortSignal, onProgress?: (progress: number) => void) {
  const hash = sha256.create();
  const chunkSize = 1024 * 1024;
  let reported = -1;
  onProgress?.(0);
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    signal.throwIfAborted();
    hash.update(new Uint8Array(await file.slice(offset, offset + chunkSize).arrayBuffer()));
    const progress = Math.round(Math.min(file.size, offset + chunkSize) / file.size * 100);
    if (progress !== reported) { onProgress?.(progress); reported = progress; }
    if (offset % (8 * chunkSize) === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  signal.throwIfAborted();
  return bytesToHex(hash.digest());
}
// XMLHttpRequest exposes real bytes sent; aborting leaves completed multipart parts reusable.
function sendPart(url: string, blob: Blob, signal: AbortSignal, onProgress: (sent: number) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error, etag?: string) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve(etag!);
    };
    xhr.open("PUT", url);
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = event => onProgress(event.loaded);
    xhr.onload = () => {
      const etag = xhr.getResponseHeader("ETag")?.replace(/^"|"$/g, "");
      if (xhr.status >= 200 && xhr.status < 300 && etag) finish(undefined, etag);
      else finish(new Error("That part didn't arrive. Retry to continue where you left off."));
    };
    xhr.onerror = () => finish(new Error("Connection interrupted. Retry when you're back online."));
    xhr.ontimeout = () => finish(new Error("The connection timed out. Retry to resume."));
    xhr.onabort = () => finish(new DOMException("Transfer paused", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { finish(new DOMException("Transfer paused", "AbortError")); return; }
    xhr.send(blob);
  });
}
// Confirm file identity before resuming, save each ETag, and publish only after completion.
export async function uploadOriginal(file: File, initial: Transfer, signal: AbortSignal, onChange: (transfer: Transfer) => void) {
  let current: Transfer = { ...initial, parts: [...initial.parts], state: "preparing", message: undefined };
  const update = (patch: Partial<Transfer>) => { current = { ...current, ...patch }; onChange(current); };
  update({ state: "preparing", preparationProgress: 0 });
  try {
    const hash = await hashOriginal(file, signal, preparationProgress => update({ preparationProgress }));
    if (current.hash && current.hash !== hash) {
      update({ state: "needs-file", message: "This is a different file. Choose the original file to resume." });
      await persistTransfer(current); return current;
    }
    update({ hash, capturedAt: current.capturedAt || await readCaptureDate(file) });
    await persistTransfer(current);
    const session = await requestJson<UploadSession>("uploads", { method: "POST", signal, body: JSON.stringify({ id: current.id, name: current.name, mime: current.mime, size: current.size, category: current.category, sha256: hash, albumId: current.albumId, sectionId: current.sectionId, capturedAt: current.capturedAt, uploadBatch: current.uploadBatch }) });
    update({ partSize: session.partSize, state: "sending", uploadId: session.uploadId, ...(current.uploadId && session.uploadId && current.uploadId !== session.uploadId ? { parts: [], progress: 0 } : {}) });
    await persistTransfer(current);
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
            etag = await sendPart(url, blob, signal, sent => update({ progress: Math.min(99, Math.round((completedBytes + sent) / file.size * 100)) }));
            break;
          } catch (error) {
            if (signal.aborted || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 750 * (attempt + 1)));
          }
        }
        current.parts.push({ partNumber: number, etag });
        await persistTransfer(current);
      }
      signal.throwIfAborted();
      await requestJson(`uploads/${current.id}/complete`, { method: "POST", signal, body: JSON.stringify({ parts: current.parts }) });
    }
    update({ state: "complete", progress: 100 });
    await publishPreview(file, current.id, signal);
  } catch (error) {
    update({ state: signal.aborted ? "paused" : "error", message: signal.aborted ? "Ready when you are" : error instanceof Error ? error.message : "Couldn't send this file. Please retry." });
  }
  await persistTransfer(current);
  return current;
}
