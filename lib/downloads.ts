import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { createLibraryApi } from "./api-client";
import type { MediaItem } from "./contracts";

type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle> };
export function supportsVerifiedSave() { return typeof (window as SavePickerWindow).showSaveFilePicker === "function"; }

// Open the picker before awaiting network work to preserve the user's transient activation.
export async function saveVerifiedOriginal(item: Pick<MediaItem, "id" | "name" | "size" | "sha256">, options: { accountSpaceId?: string; linkPath?: string; signal?: AbortSignal; onProgress?: (percent: number) => void } = {}) {
  const { requestJson } = createLibraryApi(options.accountSpaceId);
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) throw new Error("Use Save to device in this browser.");
  const handle = await picker.call(window, { suggestedName: item.name });
  options.signal?.throwIfAborted();
  const { url } = await requestJson<{ url: string }>(options.linkPath || `media/${item.id}/link`, { signal: options.signal });
  const response = await fetch(url, { signal: options.signal });
  if (!response.ok || !response.body) throw new Error("Couldn't download this original. Please try again.");
  const writer = await handle.createWritable().catch(async error => { await response.body!.cancel().catch(() => {}); throw error; });
  const reader = response.body.getReader();
  const hash = sha256.create();
  let written = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      options.signal?.throwIfAborted();
      hash.update(value); written += value.byteLength;
      if (written > item.size) throw new Error("This download is larger than its original. Please retry.");
      await writer.write(new Uint8Array(value).buffer);
      options.onProgress?.(Math.min(99, Math.round(written / item.size * 100)));
    }
    options.signal?.throwIfAborted();
    if (written !== item.size || bytesToHex(hash.digest()) !== item.sha256) throw new Error("The downloaded file didn't match the original. Please retry; the destination was not committed.");
    await writer.close();
    options.onProgress?.(100);
  } catch (error) {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    throw error;
  }
}
