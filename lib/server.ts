import { env } from "cloudflare:workers";
import { AwsClient } from "aws4fetch";
import { z } from "zod";
import { MAX_FILE_SIZE, PART_SIZE } from "./contracts";

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
export type ActiveDevice = { id: string; space_id: string; name: string; space_name: string };
// Authenticate every API request against a revocable, hashed device credential.
export async function requireDevice(request: Request): Promise<ActiveDevice> {
  const authorization = request.headers.get("Authorization");
  const token = authorization ? authorization.match(/^Bearer ([a-f0-9]{64})$/)?.[1] : request.headers.get("Cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("relay_device="))?.slice(13);
  if (!token || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(401, "Connect this device to continue.");
  const device = await database().prepare(`SELECT devices.id, devices.space_id, devices.name, spaces.name AS space_name
    FROM devices JOIN spaces ON spaces.id = devices.space_id
    WHERE devices.token_hash = ? AND devices.revoked_at IS NULL AND devices.expires_at > ?`)
    .bind(await tokenHash(token), Date.now()).first<ActiveDevice>();
  if (!device) throw new ApiError(401, "This device has been disconnected. Pair it again to continue.");
  return device;
}
export type UploadRow = { id: string; space_id: string; device_id: string; name: string; mime: string; size: number; sha256: string; category: string; object_key: string; upload_id: string; part_size: number; status: string; created_at: number; archived_at: number | null; preview_ready: number };
export function spaceLimitBytes() { return 100 * 1024 * 1024 * 1024; }
export async function requireMedia(device: ActiveDevice, id: string, ownerOnly = false) {
  const item = await database().prepare("SELECT * FROM media WHERE id = ? AND space_id = ?").bind(id, device.space_id).first<UploadRow>();
  if (!item || (ownerOnly && item.device_id !== device.id)) throw new ApiError(404, "This file is not available.");
  return item;
}
export function attachmentName(name: string) {
  const fallback = name.replace(/[^a-zA-Z0-9._ -]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`;
}
// Sign only the server-selected object and operation; callers cannot choose a bucket or key.
export async function signedObjectUrl(key: string, method: "GET" | "PUT", parameters: Record<string, string> = {}, expectedBytes?: number) {
  const { R2_ACCOUNT_ID, R2_BUCKET_NAME, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = process.env;
  if (!R2_ACCOUNT_ID || !R2_BUCKET_NAME || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new ApiError(503, "Direct transfers are not connected yet.");
  }
  const url = new URL(`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${encodeURIComponent(R2_BUCKET_NAME)}/${key.split("/").map(encodeURIComponent).join("/")}`);
  url.searchParams.set("X-Amz-Expires", "3600");
  for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
  const client = new AwsClient({ accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY, service: "s3", region: "auto" });
  // Signing Content-Length binds each upload URL to its reserved part size; browsers supply this header for Blob bodies.
  return (await client.sign(url, { method, ...(expectedBytes === undefined ? {} : { headers: { "Content-Length": String(expectedBytes) } }), aws: { signQuery: true, allHeaders: expectedBytes !== undefined } })).url;
}
export const uploadSchema = z.object({
  id: z.string().uuid(), name: z.string().min(1).max(240).refine(name => !/[\u0000-\u001f/\\]/.test(name)),
  mime: z.string().max(150).regex(/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/),
  size: z.number().int().positive().max(MAX_FILE_SIZE), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  category: z.enum(["original", "final"]),
});
// Reuse a caller's stable upload ID after interrupted requests rather than creating duplicates.
export async function initializeUpload(device: ActiveDevice, input: z.infer<typeof uploadSchema>) {
  const existing = await database().prepare("SELECT * FROM media WHERE id = ?").bind(input.id).first<UploadRow>();
  if (existing) {
    if (existing.device_id !== device.id || existing.sha256 !== input.sha256 || existing.size !== input.size) throw new ApiError(409, "That transfer belongs to a different file.");
    if (!["ready", "uploading"].includes(existing.status) || existing.archived_at) throw new ApiError(409, "This original was removed from the feed.");
    return { id: existing.id, partSize: existing.part_size, status: existing.status, uploadId: existing.upload_id };
  }
  const key = `${device.space_id}/${input.id}/original`;
  const upload = await bucket().createMultipartUpload(key, {
    httpMetadata: { contentType: input.mime, contentDisposition: attachmentName(input.name) },
    customMetadata: { sha256: input.sha256, filename: input.name },
  });
  try {
    const reserved = await database().prepare(`INSERT INTO media (id, space_id, device_id, name, mime, size, sha256, category, object_key, upload_id, part_size, status, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?
      WHERE (SELECT COALESCE(SUM(size + preview_size), 0) FROM media WHERE space_id = ?) + ? <= ?`)
      .bind(input.id, device.space_id, device.id, input.name, input.mime, input.size, input.sha256, input.category, key, upload.uploadId, PART_SIZE, Date.now(), device.space_id, input.size, spaceLimitBytes()).run();
    if (!reserved.meta.changes) throw new ApiError(507, "This space has reached its 100 GB limit. Empty Trash or cancel unfinished uploads in Storage to make room.");
  } catch (error) {
    await upload.abort();
    // Two retries may initialize the same UUID concurrently; reuse the winning immutable manifest.
    const winner = await database().prepare("SELECT * FROM media WHERE id = ?").bind(input.id).first<UploadRow>();
    if (winner && winner.device_id === device.id && winner.sha256 === input.sha256 && winner.size === input.size && ["uploading", "ready"].includes(winner.status) && !winner.archived_at) {
      return { id: winner.id, partSize: winner.part_size, status: winner.status, uploadId: winner.upload_id };
    }
    throw error;
  }
  return { id: input.id, partSize: PART_SIZE, status: "uploading", uploadId: upload.uploadId };
}
