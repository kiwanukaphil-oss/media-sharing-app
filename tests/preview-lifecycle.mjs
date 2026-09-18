import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({ entryPoints: ['lib/previews.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { publishPreview } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const original = new File(['local video fixture'], 'fixture.webm', { type: 'video/webm' });
// Cancellation and codec failures must release local media resources without writing a thumbnail.
async function verifyPreviewExit(mode) {
  let revoked = false; let stopped = false; let writes = 0;
  const controller = new AbortController();
  const video = new EventTarget();
  Object.assign(video, { pause: () => { stopped = true; }, removeAttribute: () => {}, load: () => {} });
  Object.defineProperty(video, 'src', { set: () => queueMicrotask(() => {
    if (mode === 'unsupported') video.dispatchEvent(new Event('error'));
    else if (mode === 'cancel') controller.abort();
  }) });
  globalThis.document = { createElement: kind => { assert.equal(kind, 'video'); return video; } };
  const revoke = URL.revokeObjectURL;
  URL.revokeObjectURL = url => { revoked = true; revoke(url); };
  globalThis.fetch = async () => { writes++; throw new Error('Unexpected preview upload'); };
  try {
    await publishPreview(original, 'fixture', controller.signal);
    assert.equal(revoked, true);
    assert.equal(stopped, true);
    assert.equal(writes, 0);
  } finally { URL.revokeObjectURL = revoke; }
}
await verifyPreviewExit('unsupported');
await verifyPreviewExit('cancel');
await verifyPreviewExit('timeout');
console.log('PASS: cancelled, timed-out and unsupported video previews release resources without interrupting completed originals.');
