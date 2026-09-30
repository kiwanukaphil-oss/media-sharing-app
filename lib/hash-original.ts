import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

// Hash bounded chunks rather than materializing a multi-gigabyte original in memory.
export async function hashOriginalChunks(file: File, signal: AbortSignal, onProgress?: (progress: number) => void) {
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
