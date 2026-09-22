import { storageQuota } from "./storage-pool";
import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
import { z } from "zod";
import { validCaptureDate } from "./library-names";
import { MAX_FILE_SIZE, PART_SIZE, formatBytes } from "./contracts";
import { transferAuthority } from "./transfer-authority";
import { reviewSharedAction } from "./collaboration-policy";
import type { LibraryRole } from "./contracts";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function database() {
  if (!env.DB) throw new ApiError(503, "The shared space is unavailable. Try again shortly.");
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET) throw new ApiError(503, "File storage is unavailable. Your originals are still on your device.");
  return env.BUCKET;
}
export function isLocal(request: Request) {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(request.url).hostname);
}
export function storageMode(request: Request) {
  if (isLocal(request)) return "local" as const;
  return process.env.R2_ACCOUNT_ID && process.env.R2_BUCKET_NAME && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY ? "direct" as const : "unconfigured" as const;
}
export async function tokenHash(token: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function newToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function sessionCookie(request: Request, token: string) {
  return `relay_device=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${isLocal(request) ? "" : "; Secure"}`;
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("Origin") !== new URL(request.url).origin) throw new ApiError(403, "Please send this request from Relay.");
}
// Bound metadata bodies while reading so oversized requests cannot exhaust the Worker heap.
export async function readJson<T extends z.ZodTypeAny>(request: Request, schema: T): Promise<z.infer<T>> {
  if (Number(request.headers.get("Content-Length")) > 1024 * 1024) throw new ApiError(413, "This request is too large.");
  if (!request.body) throw new ApiError(400, "Request details are missing.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 1024 * 1024) { reader.releaseLock(); throw new ApiError(413, "This request is too large."); }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  try { return schema.parse(JSON.parse(raw)); }
  catch { throw new ApiError(400, "Some details are missing or invalid. Please try again."); }
}
// Legacy name retained for compatibility; account actors derive authority from live membership.
// closureAdmissionId is assigned by the server request boundary, never read from client input.
export type ActiveDevice = { id: string; space_id: string; name: string; space_name: string; role: LibraryRole; authentication?: "account"; personId?: string; sessionId?: string; closureAdmissionId?: string; storage_limit_bytes?: number | null; space_kind?: "personal" | "shared" };
export function requireOwner(device: ActiveDevice) {
  if (device.role !== "owner") throw new ApiError(403, "Only a space owner can do this.");
}
// Shared Editor is account-only. This is preflight; each mutation also uses current SQL authority.
export function requireOrganiser(device: ActiveDevice) {
  const actor = { kind: device.authentication === "account" ? "account" as const : "legacy" as const,
    id: device.id, spaceId: device.space_id, role: device.role, active: true };
  if (!reviewSharedAction(actor, "organise-albums").allowed) throw new ApiError(403, "An owner or editor can organise this library.");
}
// Authenticate every API request against a revocable, hashed device credential.
export async function requireDevice(request: Request): Promise<ActiveDevice> {
  const authorization = request.headers.get("Authorization");
  const token = authorization ? authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1] : request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("relay_device="))?.slice(13);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "Connect this device to continue.");
  const device = await database().prepare(`SELECT devices.id, devices.space_id, devices.name, devices.role, spaces.name AS space_name
    FROM devices JOIN spaces ON spaces.id = devices.space_id
    WHERE devices.token_hash = ? AND devices.role IN ('owner','member') AND devices.revoked_at IS NULL AND devices.expires_at > ?
    AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = devices.space_id)`)
    .bind(await tokenHash(token), Date.now()).first<ActiveDevice>();
  if (!device) throw new ApiError(401, "This device has been disconnected. Pair it again to continue.");
  return device;
}
export type UploadRow = { id: string; space_id: string; device_id: string; name: string; mime: string; size: number; sha256: string; category: string; object_key: string; upload_id: string; part_size: number; status: string; created_at: number; archived_at: number | null; preview_ready: number };
export function spaceLimitBytes(device: ActiveDevice) { return storageQuota(device.space_id, device.storage_limit_bytes ?? 100 * 1024 ** 3).limit; }
// Byte-producing operations need current upload permission before storage dispatch or URL signing.
export async function requireUploadAccess(device: ActiveDevice) {
  const authority = transferAuthority(device);
  if (!await database().prepare(`SELECT 1 WHERE ${authority.sql}`).bind(...authority.bindings).first())
    throw new ApiError(403, "Upload access changed. Refresh this library; viewers can browse and save files.");
}
export async function requireMedia(device: ActiveDevice, id: string, ownerOnly = false) {
  const item = await database().prepare("SELECT * FROM media WHERE id = ? AND space_id = ?").bind(id, device.space_id).first<UploadRow>();
  if (!item || (ownerOnly && item.device_id !== device.id)) throw new ApiError(404, "This file is not available.");
  if (ownerOnly) await requireUploadAccess(device);
  return item;
}
export function attachmentName(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
}
// Sign only the server-selected object and operation; callers cannot choose a bucket or key.
export async function signedObjectUrl(key: string, method: "GET" | "PUT", parameters: Record<string, string> = {}, expectedBytes?: number, signedAt?: number) {
  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new ApiError(503, "Direct transfers are not connected yet.");
  }
  const url = new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(R2_BUCKET_NAME)}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", "3600");
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  // Signing Content-Length binds each upload URL to its reserved part size; browsers supply this header for Blob bodies.
  return (await client.sign(url, { method, ...(expectedBytes === undefined ? {} : { headers: { "Content-Length": String(expectedBytes) } }), aws: { signQuery: true, allHeaders: expectedBytes !== undefined, ...(signedAt === undefined ? {} : { datetime: new Date(signedAt).toISOString().replace(/[:-]|\.\d{3}/g, "") }) } })).url;
}
export const uploadSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(240).refine(name => !/[\u0000-\u001f/\\]/.test(name)),
  mime: z.string().max(150).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  size: z.number().int().positive().max(MAX_FILE_SIZE), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.enum(["original", "final"]),
  albumId: z.string().uuid().optional(), sectionId: z.string().uuid().optional(), capturedAt: z.string().refine(validCaptureDate).optional(), uploadBatch: z.string().uuid().optional(),
});
// Reuse a caller's stable upload ID after interrupted requests rather than creating duplicates.
export async function initializeUpload(device: ActiveDevice, input: z.infer<typeof uploadSchema>, storage: R2Bucket = bucket()) {
  await requireUploadAccess(device);
  const existing = await database().prepare("SELECT * FROM media WHERE id = ?").bind(input.id).first<UploadRow>();
  if (existing) {
    if (existing.space_id !== device.space_id || existing.device_id !== device.id || existing.sha256 !== input.sha256 || existing.size !== input.size) throw new ApiError(409, "That transfer belongs to a different file.");
    if (!["ready", "uploading"].includes(existing.status) || existing.archived_at) throw new ApiError(409, "This original was removed from the feed.");
    return { id: existing.id, partSize: existing.part_size, status: existing.status, uploadId: existing.upload_id };
  }
  if (input.albumId) {
    const album = await database().prepare("SELECT id FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND archived_at IS NULL").bind(input.albumId, device.space_id).first();
    if (!album) throw new ApiError(409, "The upload album is unavailable or archived. Choose an active album.");
  }
  if (input.sectionId) {
    const section = input.albumId && await database().prepare("SELECT id FROM album_sections WHERE album_id = ? AND id = ? AND deleted_at IS NULL").bind(input.albumId, input.sectionId).first();
    if (!section) throw new ApiError(409, "The upload section is unavailable. Choose a destination before retrying.");
  }
  const key = `${device.space_id}/${input.id}/original`;
  const upload = await storage.createMultipartUpload(key, {
    httpMetadata: { contentType: input.mime, contentDisposition: attachmentName(input.name) },
    customMetadata: { sha256: input.sha256, filename: input.name },
  });
  try {
    const authority = transferAuthority(device);
    const quota = storageQuota(device.space_id, spaceLimitBytes(device));
    const reservation = database().prepare(`INSERT INTO media (id, space_id, device_id, name, mime, size, sha256, category, object_key, upload_id, part_size, status, created_at, original_name, captured_at, upload_batch)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?, ?, ?, ?
      WHERE (SELECT COALESCE(SUM(size + preview_size), 0) FROM media WHERE ${quota.sql}) + ? <= ?
      AND (? IS NULL OR EXISTS (SELECT 1 FROM albums WHERE id = ? AND space_id = ? AND deleted_at IS NULL AND archived_at IS NULL))
      AND (? IS NULL OR EXISTS (SELECT 1 FROM album_sections WHERE album_id = ? AND id = ? AND deleted_at IS NULL))
      AND ${authority.sql}`)
      .bind(input.id, device.space_id, device.id, input.name, input.mime, input.size, input.sha256, input.category, key, upload.uploadId, PART_SIZE, Date.now(), input.name, input.capturedAt || null, input.uploadBatch || null, ...quota.bindings, input.size, quota.limit, input.albumId || null, input.albumId || null, device.space_id, input.sectionId || null, input.albumId || null, input.sectionId || null,...authority.bindings);
    const statements = [reservation];
    if (input.albumId) statements.push(database().prepare("INSERT INTO album_media (album_id, media_id, section_id) SELECT ?, id, ? FROM media WHERE id = ? AND space_id = ?").bind(input.albumId, input.sectionId || null, input.id, device.space_id));
    const [reserved] = await database().batch(statements);
    if (!reserved.meta.changes) {
      const current = transferAuthority(device);
      if (!await database().prepare(`SELECT 1 WHERE ${current.sql}`).bind(...current.bindings).first())
        throw new ApiError(403, "Library access changed. Sign in again before continuing this transfer.");
      throw new ApiError(507, `This space has reached its ${formatBytes(spaceLimitBytes(device))} limit. Empty Trash or cancel unfinished uploads in Storage to make room.`);
    }
  } catch (error) {
    await upload.abort();
    // Two retries may initialize the same UUID concurrently; reuse the winning immutable manifest.
    const current = transferAuthority(device);
    const winner = await database().prepare(`SELECT * FROM media WHERE id = ? AND ${current.sql}`).bind(input.id,...current.bindings).first<UploadRow>();
    if (winner && winner.space_id === device.space_id && winner.device_id === device.id && winner.sha256 === input.sha256 && winner.size === input.size && ["uploading", "ready"].includes(winner.status) && !winner.archived_at) {
      return { id: winner.id, partSize: winner.part_size, status: winner.status, uploadId: winner.upload_id };
    }
    throw error;
  }
  return { id: input.id, partSize: PART_SIZE, status: "uploading", uploadId: upload.uploadId };
}
