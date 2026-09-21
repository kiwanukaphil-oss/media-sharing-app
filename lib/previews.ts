import { createLibraryApi } from "./api-client";

// Wait for a decodable frame without leaving listeners behind on errors, cancellation or timeout.
function waitForVideoFrame(video: HTMLVideoElement, event: "loadeddata" | "seeked", signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const finish = (failure?: unknown) => {
      video.removeEventListener(event, ready); video.removeEventListener("error", failed);
      signal.removeEventListener("abort", aborted);
      if (failure) reject(failure); else resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error("Video preview unavailable."));
    const aborted = () => finish(signal.reason);
    video.addEventListener(event, ready, { once: true }); video.addEventListener("error", failed, { once: true });
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
  });
}

// Decode a short local frame only; never upload video bytes through the thumbnail endpoint.
async function createVideoPoster(file: File, signal: AbortSignal) {
  const video = document.createElement("video");
  const url = URL.createObjectURL(file);
  try {
    video.muted = true; video.playsInline = true; video.preload = "auto";
    const loaded = waitForVideoFrame(video, "loadeddata", signal);
    video.src = url;
    await loaded;
    if (Number.isFinite(video.duration) && video.duration > .1) {
      const seeked = waitForVideoFrame(video, "seeked", signal);
      video.currentTime = Math.min(1, video.duration / 4);
      await seeked;
    }
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d"); if (!context) return null;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", .76));
  } finally {
    video.pause(); video.removeAttribute("src"); video.load(); URL.revokeObjectURL(url);
  }
}

// Keep posters optional and bounded so unsupported media never holds up the original-file queue.
async function publishVideoPoster(file: File, id: string, signal: AbortSignal, accountSpaceId?: string) {
  if (file.size > 256 * 1024 * 1024) return;
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 6000);
  try {
    const previewSignal = AbortSignal.any([signal, deadline.signal]);
    const blob = await createVideoPoster(file, previewSignal);
    if (blob && blob.size <= 250000 && !previewSignal.aborted) {
      await fetch(createLibraryApi(accountSpaceId).apiUrl(`media/${id}/thumbnail`), { method: "PUT", signal: previewSignal, headers: { "Content-Type": "image/jpeg" }, body: blob });
    }
  } catch { /* An unsupported codec or preview timeout does not affect the completed original. */ }
  finally { clearTimeout(timeout); }
}

// Generate only a disposable display copy. The upload and save paths always use original bytes.
export async function publishPreview(file: File, id: string, signal: AbortSignal, accountSpaceId?: string) {
  if (/^video\/(mp4|webm|quicktime)$/.test(file.type)) return publishVideoPoster(file, id, signal, accountSpaceId);
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
    await fetch(createLibraryApi(accountSpaceId).apiUrl(`media/${id}/thumbnail`), { method: "PUT", signal, headers: { "Content-Type": "image/jpeg" }, body: blob });
  } catch { /* Preview failure must never prevent a completed original from being available. */ }
  finally { bitmap?.close(); }
}
