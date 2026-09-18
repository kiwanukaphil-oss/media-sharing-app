import assert from 'node:assert/strict';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['lib/capture-date.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { readCaptureDate } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);

// Construct both TIFF byte orders to exercise real EXIF offsets rather than mocking the parser.
function jpegWithCaptureDate(little, date) {
  const bytes = new Uint8Array(78); const view = new DataView(bytes.buffer); const base = 12;
  bytes.set([255, 216, 255, 225]); view.setUint16(4, 72);
  bytes.set(new TextEncoder().encode('Exif\0\0'), 6);
  view.setUint16(base, little ? 0x4949 : 0x4d4d); view.setUint16(base + 2, 42, little); view.setUint32(base + 4, 8, little);
  view.setUint16(base + 8, 1, little); view.setUint16(base + 10, 0x8769, little);
  view.setUint16(base + 12, 4, little); view.setUint32(base + 14, 1, little); view.setUint32(base + 18, 26, little);
  view.setUint16(base + 26, 1, little); view.setUint16(base + 28, 0x9003, little);
  view.setUint16(base + 30, 2, little); view.setUint32(base + 32, 20, little); view.setUint32(base + 36, 44, little);
  bytes.set(new TextEncoder().encode(date), base + 44); bytes.set([255, 217], 76);
  return bytes;
}

for (const little of [true, false]) {
  const bytes = jpegWithCaptureDate(little, '2024:02:29 23:45:12');
  assert.equal(await readCaptureDate(new File([bytes], 'photo.jpg', { type: 'image/jpeg' })), '2024-02-29T23:45:12');
  assert.equal(await readCaptureDate(new File([jpegWithCaptureDate(little, '2023:02:29 23:45:12')], 'photo.jpg', { type: 'image/jpeg' })), undefined);
  const corrupt = bytes.slice(); new DataView(corrupt.buffer).setUint32(16, 0xffffffff, little);
  assert.equal(await readCaptureDate(new File([corrupt], 'broken.jpg', { type: 'image/jpeg' })), undefined);
}
assert.equal(await readCaptureDate(new File(['not a jpeg'], 'photo.jpg', { type: 'image/jpeg' })), undefined);
assert.equal(await readCaptureDate(new File(['video'], 'movie.mp4', { type: 'video/mp4' })), undefined);
let requestedBytes;
await readCaptureDate({ type: 'image/jpeg', name: 'large.jpg', slice: (start, end) => { requestedBytes = end - start; return new Blob(['invalid']); } });
assert.equal(requestedBytes, 256 * 1024);
console.log('PASS: JPEG EXIF in both byte orders, leap dates, wall-clock preservation, corrupt offsets, unsupported formats, bounded metadata reads.');
