import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['lib/previews.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { publishPreview, createVideoPoster } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const requests = [];
let decoded = 0;
let released = 0;
let failDecode = false;
// Model metadata-only preload: no loadeddata is fired, and only seeking makes a frame available.
class MetadataOnlyVideo extends EventTarget {
  duration = 2; videoWidth = 1920; videoHeight = 1080; readyState = 1;
  set src(value) { this.source = value; queueMicrotask(() => this.dispatchEvent(new Event(failDecode ? 'error' : 'loadedmetadata'))); }
  set currentTime(value) { assert.ok(value > 0); this.readyState = 2; queueMicrotask(() => this.dispatchEvent(new Event('seeked'))); }
  pause() {} removeAttribute() {} load() { released++; }
}
globalThis.document = { createElement: tag => tag === 'video' ? new MetadataOnlyVideo() : {
  width: 0, height: 0,
  getContext: () => ({ drawImage: () => decoded++ }),
  toBlob: callback => callback(new Blob([new Uint8Array([255,216,255,217])], { type: 'image/jpeg' })),
} };
globalThis.fetch = async (url, options) => { requests.push({ url, options }); return Response.json({ ready: true }); };
const file = new File(['original fixture'], 'iPhone.MOV', { type: 'application/octet-stream' });
// Expose a large-file size without allocating 257 MiB: poster code must never reject by size.
Object.defineProperty(file, 'size', { value: 257 * 1024 * 1024 });
await publishPreview(file, 'fixture', new AbortController().signal, 'workspace');
assert.equal(requests.length, 1);
assert.match(requests[0].url, /media\/fixture\/thumbnail\?space=workspace/);
assert.equal(requests[0].options.body.type, 'image/jpeg');
assert.equal(decoded, 1);
assert.equal(released, 1);
failDecode = true;
await publishPreview(file, 'unsupported', new AbortController().signal);
assert.equal(requests.length, 1, 'Unsupported media never publishes a false preview');
assert.equal(released, 2);
const controller = new AbortController(); controller.abort();
await assert.rejects(createVideoPoster(file, controller.signal), { name: 'AbortError' });
assert.equal(released, 3);
console.log('PASS: metadata-first seek, large MOV and missing MIME eligibility, scoped JPEG-only writes, unsupported decode and abort cleanup.');
