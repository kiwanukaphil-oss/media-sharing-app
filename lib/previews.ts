// Generate only a disposable display copy. The upload and save paths always use original bytes.
export async function publishPreview(file: File, id: string, signal: AbortSignal) {
  if (!/^image\/(jpeg|png|webp|avif)$/.test(file.type) || file.size > 24 * 1024 * 1024 || typeof createImageBitmap !== "function") return;
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { resizeWidth: 640, resizeQuality: "medium" });
    if (signal.aborted) return;
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d"); if (!context) return;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .76));
    if (!blob || blob.size > 250000 || signal.aborted) return;
    await fetch(`/api/media/${id}/thumbnail`, { method: "PUT", signal, headers: { "Content-Type": "image/jpeg" }, body: blob });
  } catch { /* Preview failure must never prevent a completed original from being available. */ }
  finally { bitmap?.close(); }
}
