import { hashOriginalChunks } from "./hash-original";

// A dedicated worker keeps hashing large originals from freezing album controls and progress.
self.onmessage = async ({ data: file }: MessageEvent<File>) => {
  try {
    self.postMessage({ progress: 0 });
    // Native hashing accelerates typical photos while the chunked path bounds memory for videos.
    const hash = file.size <= 32 * 1024 * 1024 && self.crypto?.subtle
      ? Array.from(new Uint8Array(await self.crypto.subtle.digest("SHA-256", await file.arrayBuffer())), byte => byte.toString(16).padStart(2, "0")).join("")
      : await hashOriginalChunks(file, new AbortController().signal, progress => self.postMessage({ progress }));
    self.postMessage({ progress: 100 });
    self.postMessage({ hash });
  } catch {
    self.postMessage({ error: "Could not read this original. Choose the file again." });
  }
};
