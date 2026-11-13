import { ApiError, database, type ActiveDevice } from "./server";
import { resourceAudienceAuthority } from "./asset-scope-authority";
import { portableFilePath } from "./portable-file-path";
import { originalPackageLength, validatePackageManifest, writeOriginalPackage } from "./original-package";

type SelectedOriginal = { id: string; name: string; size: number; sha256: string; status: string; archived_at: number | null; object_key: string };
// Authority is rechecked when a file starts if this long has passed, and always before the directory.
const accessRecheckIntervalMs = 15_000;

// One query reads the whole selection under the caller's current audience, in the requested order.
// A missing row means the file is absent or outside this library, exactly as a single lookup reports it.
async function readSelectedOriginals(device: ActiveDevice, ids: string[]) {
  const audience = resourceAudienceAuthority(device);
  const { results } = await database().prepare(`SELECT id, name, size, sha256, status, archived_at, object_key FROM media
    WHERE space_id = ? AND id IN (SELECT value FROM json_each(?)) AND ${audience.sql}`)
    .bind(device.space_id, JSON.stringify(ids), ...audience.bindings).all<SelectedOriginal>();
  const found = new Map(results.map(file => [file.id, file]));
  return ids.map(id => {
    const file = found.get(id);
    if (!file) throw new ApiError(404, "This file is not available.");
    return file;
  });
}

// R2 hands JavaScript small chunks, and each one costs promise and stream bookkeeping in every
// stage of the response. Reading at least 1 MiB at a time natively keeps Worker CPU time
// proportional to bytes (the CRC) instead of to chunk count, which previously exhausted the limit.
const archiveChunkBytes = 1024 * 1024;
function readInLargeChunks(body: ReadableStream<Uint8Array>) {
  let reader: ReadableStreamBYOBReader;
  try { reader = body.getReader({ mode: "byob" }); } catch { return body; }
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const target = new Uint8Array(archiveChunkBytes);
      // readAtLeast is a Workers extension; a plain BYOB read still fills the large buffer where it is absent.
      const filling = reader as ReadableStreamBYOBReader & { readAtLeast?: (minimum: number, view: Uint8Array) => Promise<ReadableStreamReadResult<Uint8Array>> };
      const { value, done } = filling.readAtLeast ? await filling.readAtLeast(archiveChunkBytes, target) : await reader.read(target);
      if (value?.byteLength) controller.enqueue(value);
      if (done || !value?.byteLength) controller.close();
    },
    cancel: reason => reader.cancel(reason),
  }, { highWaterMark: 0 });
}

const sameOriginal = (current: SelectedOriginal, initial: SelectedOriginal) => current.status === "ready" && !current.archived_at
  && current.object_key === initial.object_key && current.sha256 === initial.sha256 && current.size === initial.size && current.name === initial.name;

// Validate the complete selection before response bytes, then stream a fixed-length stored ZIP.
// Query count stays far below the per-request platform ceiling: one read for the selection, one R2
// read per file, time-bounded authority rechecks, and one batched recheck before the directory.
// The Worker does not re-hash originals (pure-JS SHA-256 over gigabytes exhausted CPU time and
// truncated archives); size and CRC-32 are still checked for every original.
export async function bulkDownload(request: Request, device: ActiveDevice, storage: R2Bucket, refreshAccess: () => Promise<ActiveDevice>) {
  const query = new URL(request.url).searchParams;
  const ids = (query.get("ids") || "").split(",");
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))) throw new ApiError(400, "Choose between 1 and 100 different files.");
  const originals = await readSelectedOriginals(device, ids);
  if (originals.some(file => file.status !== "ready" || file.archived_at)) throw new ApiError(409, "A selected file is unavailable. Refresh your selection.");
  const initialById = new Map(originals.map(file => [file.id, file]));
  const manifest = { format: "relay-originals", formatVersion: 1, files: originals.map(file => ({ id: file.id, name: file.name, size: file.size, sha256: file.sha256, suggestedPath: portableFilePath(file.id, file.name) })) };
  const packaging = { flatNames: true, verifyHashes: false };
  let archiveLength: number;
  try { validatePackageManifest(manifest); archiveLength = originalPackageLength(manifest, packaging); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Choose a smaller selection."); }
  if (query.get("check") === "1") return Response.json({ ready: true });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  // A declared length lets the browser show progress and reject a truncated archive.
  const stream = new FixedLengthStream(archiveLength);
  const writer = stream.writable.getWriter();
  void writer.closed.catch(cancel);
  let access = device, accessCheckedAt = Date.now();
  const recheckAccess = async () => {
    access = await refreshAccess();
    accessCheckedAt = Date.now();
    if (access.id !== device.id || access.space_id !== device.space_id) throw new ApiError(403, "Library access changed.");
  };
  const started = Date.now();
  // Backpressure bounds memory; a cancelled or failed response never receives a complete ZIP directory.
  void writeOriginalPackage(manifest, { write: bytes => writer.write(bytes), close: () => writer.close(), abort: () => writer.abort(new Error("The ZIP download was interrupted. Please retry.")) }, {
    ...packaging, signal: abort.signal,
    read: async file => {
      if (Date.now() - accessCheckedAt >= accessRecheckIntervalMs) await recheckAccess();
      const [current] = await readSelectedOriginals(access, [file.id]);
      if (!sameOriginal(current, initialById.get(file.id)!)) throw new ApiError(409, "A selected file changed. Retry the download.");
      const original = await storage.get(current.object_key);
      if (!original) throw new ApiError(404, "An original is unavailable.");
      return new Response(readInLargeChunks(original.body));
    },
    revalidate: async () => {
      await recheckAccess();
      const current = await readSelectedOriginals(access, ids);
      if (current.some(file => !sameOriginal(file, initialById.get(file.id)!))) throw new ApiError(409, "A selected file changed. Retry the download.");
    },
  }).catch(error => {
    // Never log names, identifiers or raw exceptions; record only enough to diagnose truncated archives.
    if (!abort.signal.aborted) console.error(JSON.stringify({ event: "relay_bulk_download_failed", files: ids.length, bytes: archiveLength, durationMs: Date.now() - started, status: error instanceof ApiError ? error.status : 500 }));
  }).finally(() => request.signal.removeEventListener("abort", cancel));
  return new Response(stream.readable, { headers: { "Content-Type": "application/zip", "Content-Length": String(archiveLength), "Content-Disposition": 'attachment; filename="relay-originals.zip"', "Cache-Control": "private, no-store" } });
}
