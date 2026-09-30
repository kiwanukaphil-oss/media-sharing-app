import { ApiError, requireMedia, type ActiveDevice } from "./server";
import { portableFilePath } from "./portable-file-path";
import { validatePackageManifest, writeOriginalPackage } from "./original-package";

// Validate the complete selection before response bytes, then recheck current authority for each original.
export async function bulkDownload(request: Request, device: ActiveDevice, storage: R2Bucket, refreshAccess: () => Promise<ActiveDevice>) {
  const query = new URL(request.url).searchParams;
  const ids = (query.get("ids") || "").split(",");
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(id))) throw new ApiError(400, "Choose between 1 and 100 different files.");
  const originals: Awaited<ReturnType<typeof requireMedia>>[] = [];
  for (const id of ids) {
    const file = await requireMedia(device, id);
    if (file.status !== "ready" || file.archived_at) throw new ApiError(409, "A selected file is unavailable. Refresh your selection.");
    originals.push(file);
  }
  const manifest = { format: "relay-originals", formatVersion: 1, files: originals.map(file => ({ id: file.id, name: file.name, size: file.size, sha256: file.sha256, suggestedPath: portableFilePath(file.id, file.name) })) };
  try { validatePackageManifest(manifest); } catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "Choose a smaller selection."); }
  if (query.get("check") === "1") return Response.json({ ready: true });
  const abort = new AbortController();
  const cancel = () => abort.abort();
  request.signal.addEventListener("abort", cancel, { once: true });
  if (request.signal.aborted) cancel();
  const stream = new TransformStream<Uint8Array, Uint8Array>();
  const writer = stream.writable.getWriter();
  void writer.closed.catch(cancel);
  const checkOriginal = async (id: string) => {
    const access = await refreshAccess();
    if (access.id !== device.id || access.space_id !== device.space_id) throw new ApiError(403, "Library access changed.");
    const current = await requireMedia(access, id);
    const initial = originals.find(file => file.id === id)!;
    if (current.status !== "ready" || current.archived_at || current.object_key !== initial.object_key || current.sha256 !== initial.sha256 || current.size !== initial.size || current.name !== initial.name) throw new ApiError(409, "A selected file changed. Retry the download.");
    return current;
  };
  // Backpressure bounds memory; a cancelled or failed response never receives a complete ZIP directory.
  void writeOriginalPackage(manifest, { write: bytes => writer.write(bytes), close: () => writer.close(), abort: () => writer.abort(new Error("The ZIP download was interrupted. Please retry.")) }, {
    flatNames: true, signal: abort.signal,
    read: async file => {
      const current = await checkOriginal(file.id);
      const original = await storage.get(current.object_key);
      if (!original) throw new ApiError(404, "An original is unavailable.");
      return new Response(original.body);
    },
    revalidate: async () => { for (const id of ids) await checkOriginal(id); },
  }).catch(() => {}).finally(() => request.signal.removeEventListener("abort", cancel));
  return new Response(stream.readable, { headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="relay-originals.zip"', "Cache-Control": "private, no-store" } });
}
