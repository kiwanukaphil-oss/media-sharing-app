import type { Transfer } from "./transfers";

export type OriginalHandle = FileSystemFileHandle & {
  queryPermission(options: { mode: "read" }): Promise<PermissionState>;
  requestPermission(options: { mode: "read" }): Promise<PermissionState>;
};
type SourceRecord = { id: string; deviceId: string; handle?: OriginalHandle; file?: File; data?: ArrayBuffer; name?: string; mime?: string; lastModified?: number; bytes: number };
const selectedHandles = new WeakMap<File, OriginalHandle>();
export const rememberOriginalHandle = (file: File, handle: OriginalHandle) => selectedHandles.set(file, handle);
const copyLimit = 32 * 1024 * 1024;
const cacheLimit = 256 * 1024 * 1024;

// A separate database keeps old manifest readers compatible and avoids blocked version upgrades.
async function sourceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open("relay-upload-sources", 2);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; reject(new Error("Recovery storage unavailable")); }, 3000);
    opening.onupgradeneeded = () => {
      const store = opening.result.objectStoreNames.contains("sources") ? opening.transaction!.objectStore("sources") : opening.result.createObjectStore("sources", { keyPath: "id" });
      if (!store.indexNames.contains("bytes")) store.createIndex("bytes", "bytes");
      if (!store.indexNames.contains("deviceId")) store.createIndex("deviceId", "deviceId");
    };
    opening.onsuccess = () => { clearTimeout(timeout); if (timedOut) { opening.result.close(); return; } opening.result.onversionchange = () => opening.result.close(); resolve(opening.result); };
    opening.onerror = () => { clearTimeout(timeout); reject(opening.error); };
  });
}

// Read/write transactions await commit, so an aborted copy is never reported as recoverable.
async function sourceTransaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await sourceDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction("sources", mode);
      const request = operation(transaction.objectStore("sources"));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally { db.close(); }
}

// Copy only small originals within a shared bounded budget; large selections never fill the device.
async function retainOriginalWithinBudget(transfer: Transfer, file: File): Promise<Transfer["recovery"]> {
  const handle = selectedHandles.get(file);
  try {
    if (handle) { await sourceTransaction("readwrite", store => store.put({ id: transfer.id, deviceId: transfer.deviceId, handle, bytes: 0 })); return "handle"; }
    if (file.size > copyLimit || !navigator.storage?.estimate) return "session";
    const estimate = await navigator.storage.estimate();
    if ((estimate.quota ?? 0) - (estimate.usage ?? 0) < file.size + cacheLimit) return "session";
    if (await retainedByteCount() + file.size > cacheLimit) return "session";
    // Bounded ArrayBuffers also work on WebKit builds where IndexedDB cannot commit File/Blob values.
    const data = await file.arrayBuffer();
    await sourceTransaction("readwrite", store => store.put({ id: transfer.id, deviceId: transfer.deviceId, data, name: file.name, mime: file.type, lastModified: file.lastModified, bytes: file.size }));
    return "copy";
  } catch { return "session"; }
}

export async function retainOriginal(transfer: Transfer, file: File): Promise<Transfer["recovery"]> {
  return navigator.locks ? navigator.locks.request("relay-upload-cache-budget", () => retainOriginalWithinBudget(transfer, file)) : retainOriginalWithinBudget(transfer, file);
}

// Count indexed sizes without loading recovery bytes into memory merely to check the cache budget.
async function retainedByteCount() {
  const db = await sourceDatabase();
  try {
    return await new Promise<number>((resolve, reject) => {
      let total = 0;
      const cursor = db.transaction("sources").objectStore("sources").index("bytes").openKeyCursor();
      cursor.onsuccess = () => { const entry = cursor.result; if (!entry) resolve(total); else { total += Number(entry.key); entry.continue(); } };
      cursor.onerror = () => reject(cursor.error);
    });
  } finally { db.close(); }
}

export async function readOriginalHandle(transfer: Transfer) {
  const source = await sourceTransaction<SourceRecord | undefined>("readonly", store => store.get(transfer.id)).catch(() => undefined);
  return source?.deviceId === transfer.deviceId ? source : undefined;
}

// Check retained sources silently; a permission prompt belongs to an explicit UI action.
export async function recoverOriginal(transfer: Transfer): Promise<{ file?: File; permission?: boolean }> {
  const source = await readOriginalHandle(transfer);
  if (source?.file) return { file: source.file };
  if (source?.data) return { file: new File([source.data], source.name || transfer.name, { type: source.mime || transfer.mime, lastModified: source.lastModified }) };
  if (!source?.handle) return {};
  try {
    if (await source.handle.queryPermission({ mode: "read" }) !== "granted") return { permission: true };
    return { file: await source.handle.getFile() };
  } catch { return {}; }
}

export async function releaseOriginal(id: string) {
  await sourceTransaction("readwrite", store => store.delete(id)).catch(() => {});
}

// Sign-out clears only this actor's cached bytes and handles, including orphaned source records.
export async function releaseActorOriginals(deviceId: string) {
  const ids = await sourceTransaction<IDBValidKey[]>("readonly", store => store.index("deviceId").getAllKeys(deviceId)).catch(() => []);
  for (const id of ids) await releaseOriginal(String(id));
}
