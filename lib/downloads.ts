import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { requestJson } from "./api-client";
import type { MediaItem } from "./contracts";

type SavePickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string }) => Promise<FileSystemFileHandle> };
export function supportsVerifiedSave() { return typeof (window as SavePickerWindow).showSaveFilePicker === "function"; }

// Open the picker before awaiting network work to preserve the user's transient activation.
export async function saveVerifiedOriginal(item: MediaItem) {
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (!picker) throw new Error("Use Save to device in this browser.");
  const handle = await picker.call(window, { suggestedName: item.name });
  const { url } = await requestJson<{ url: string }>(`media/${item.id}/link`);
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error("Couldn't download this original. Please try again.");
  const writer = await handle.createWritable();
  const reader = response.body.getReader();
  const hash = sha256.create();
  let written = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      hash.update(value); written += value.byteLength;
      await writer.write(new Uint8Array(value).buffer);
    }
    if (written !== item.size || bytesToHex(hash.digest()) !== item.sha256) throw new Error("The downloaded file didn't match the original. Please retry; the destination was not committed.");
    await writer.close();
  } catch (error) {
    await reader.cancel().catch(() => {});
    await writer.abort().catch(() => {});
    throw error;
  }
}
