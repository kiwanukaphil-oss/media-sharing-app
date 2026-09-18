import { validCaptureDate } from "./library-names";

// Inspect at most 256 KiB of JPEG metadata; unsupported files retain an explicit unknown capture date.
export async function readCaptureDate(file: File): Promise<string | undefined> {
  if (file.type !== "image/jpeg" && !/\.jpe?g$/i.test(file.name)) return undefined;
  try {
    const bytes = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer());
    if (bytes[0] !== 255 || bytes[1] !== 216) return undefined;
    const view = new DataView(bytes.buffer);
    for (let offset = 2; offset + 4 < bytes.length;) {
      if (bytes[offset] !== 255 || bytes[offset + 1] === 218) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (bytes[offset + 1] === 225 && new TextDecoder().decode(bytes.subarray(offset + 4, offset + 10)) === "Exif\0\0") {
        const result = readExifDate(view, offset + 10, offset + 2 + length);
        if (result) return result;
      }
      offset += length + 2;
    }
  } catch { /* Malformed or missing camera metadata must never prevent an original upload. */ }
  return undefined;
}

// Follow only the bounded EXIF directory and DateTimeOriginal ASCII value, preserving camera wall time.
function readExifDate(view: DataView, base: number, end: number): string | undefined {
  const little = view.getUint16(base) === 0x4949;
  if ((!little && view.getUint16(base) !== 0x4d4d) || view.getUint16(base + 2, little) !== 42) return;
  const findTag = (directory: number, tag: number) => {
    if (directory < base || directory + 2 > end) return;
    const count = view.getUint16(directory, little);
    if (directory + 2 + count * 12 > end) return;
    for (let i = 0; i < count; i++) {
      const entry = directory + 2 + i * 12;
      if (view.getUint16(entry, little) === tag) return entry;
    }
  };
  const pointer = findTag(base + view.getUint32(base + 4, little), 0x8769);
  if (pointer === undefined) return;
  const entry = findTag(base + view.getUint32(pointer + 8, little), 0x9003);
  if (entry === undefined || view.getUint16(entry + 2, little) !== 2 || view.getUint32(entry + 4, little) !== 20) return;
  const start = base + view.getUint32(entry + 8, little);
  if (start < base || start + 20 > end) return;
  const date = new TextDecoder().decode(new Uint8Array(view.buffer, start, 19)).replace(/^(\d{4}):(\d{2}):(\d{2}) /, "$1-$2-$3T");
  return validCaptureDate(date) ? date : undefined;
}
