import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { build } from "esbuild";

const compiled = await build({ entryPoints: ["lib/downloads.ts"], bundle: true, platform: "node", format: "esm", write: false });
const { saveVerifiedOriginal } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const original = new TextEncoder().encode("Original bytes, including metadata: EXIF HDR 60fps.");
const item = { id: "fixture", name: "original.mov", size: original.length, sha256: createHash("sha256").update(original).digest("hex") };

// A destination is committed only after the full streaming hash and byte count match.
async function exerciseVerifiedSave(mode) {
  const events = [];
  const chunks = [];
  let committed = false;
  let aborted = false;
  const controller = new AbortController();
  globalThis.window = { showSaveFilePicker: async () => {
    events.push("picker");
    return { createWritable: async () => ({ write: async chunk => { chunks.push(new Uint8Array(chunk)); if (mode === 'cancel') controller.abort(); }, close: async () => { committed = true; }, abort: async () => { aborted = true; } }) };
  } };
  globalThis.fetch = async url => {
    events.push("network");
    if (url.startsWith("/api/")) return Response.json({ url: "https://storage.example/original" });
    const payload = mode === 'oversize' ? new Uint8Array(original.length + 1) : original.slice();
    if (mode === 'corrupt') payload[0] ^= 1;
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(payload.slice(0, 8)); controller.enqueue(payload.slice(8)); controller.close(); } }));
  };
  const save = () => saveVerifiedOriginal(item, { signal: controller.signal });
  if (mode === 'corrupt') await assert.rejects(save(), /didn't match/);
  else if (mode === 'oversize') await assert.rejects(save(), /larger/);
  else if (mode === 'cancel') await assert.rejects(save(), { name: 'AbortError' });
  else await save();
  assert.equal(events[0], "picker", "Picker must run before asynchronous network work");
  assert.equal(committed, mode === 'valid');
  assert.equal(aborted, mode !== 'valid');
  if (mode === 'valid') assert.deepEqual(Buffer.concat(chunks), Buffer.from(original));
}
for (const mode of ['valid', 'corrupt', 'oversize', 'cancel']) await exerciseVerifiedSave(mode);
console.log("PASS: streamed original save, picker activation order, hash mismatch, oversize and cancellation abort without committing destination.");
