import { z } from "zod";
import { ApiError, assertSameOrigin, attachmentName, bucket, database, initializeUpload, isLocal, newToken, readJson, requireDevice, requireMedia, sessionCookie, signedObjectUrl, storageMode, tokenHash, uploadSchema } from "@/lib/server";

export const dynamic = "force-dynamic";
const deviceName = z.string().trim().min(1).max(60);

// One boundary applies consistent errors and private caching to all device-scoped endpoints.
async function serveRequest(request: Request) {
  try {
    const segments = new URL(request.url).pathname.slice(5).split("/");
    // Native clients have no browser Origin; browser mutations retain strict CSRF checks.
    const nativePairing = segments[0] === "native" && segments[1] === "connect";
    if (request.method !== "GET" && (request.headers.has("Origin") || (!nativePairing && !request.headers.has("Authorization")))) assertSameOrigin(request);
    const response = await routeRequest(request, segments);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (!(error instanceof ApiError)) console.error("relay_request_failed", error);
    return Response.json({ error: error instanceof ApiError ? error.message : "Couldn't complete that request. Your files are safe; please retry." }, { status: error instanceof ApiError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}

// Create a private space or atomically redeem an invitation; tokens are stored only as hashes.
async function connectDevice(request: Request, nativeClient = false) {
  const input = await readJson(request, z.object({ name: deviceName, spaceName: deviceName.optional(), invitation: z.string().regex(/^[a-f0-9]{64}$/).optional() }));
  const deviceId = crypto.randomUUID();
  const token = newToken();
  const hash = await tokenHash(token);
  const now = Date.now();
  let spaceId = crypto.randomUUID();
  if (input.invitation) {
    const invitationHash = await tokenHash(input.invitation);
    const invitation = await database().prepare("SELECT space_id FROM invitations WHERE token_hash = ? AND expires_at > ? AND redeemed_at IS NULL").bind(invitationHash, now).first<{ space_id: string }>();
    if (!invitation) throw new ApiError(410, "This invitation expired or was already used. Get a new link from a connected device.");
    spaceId = invitation.space_id;
    const results = await database().batch([
      database().prepare(`INSERT INTO devices (id, space_id, name, token_hash, created_at, expires_at)
        SELECT ?, space_id, ?, ?, ?, ? FROM invitations WHERE token_hash = ? AND expires_at > ? AND redeemed_at IS NULL`)
        .bind(deviceId, input.name, hash, now, now + 31536000000, invitationHash, now),
      database().prepare("UPDATE invitations SET redeemed_at = ? WHERE token_hash = ? AND redeemed_at IS NULL").bind(now, invitationHash),
    ]);
    if (!results[0].meta.changes) throw new ApiError(410, "This invitation was already used. Request a new one.");
  } else {
    if (nativeClient) throw new ApiError(403, "Pair this device using an invitation.");
    if (!isLocal(request) && process.env.ALLOW_SPACE_CREATION !== "true") throw new ApiError(403, "Use an invitation from a connected device.");
    await database().batch([
      database().prepare("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)").bind(spaceId, input.spaceName || "Our shared space", now),
      database().prepare("INSERT INTO devices (id, space_id, name, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").bind(deviceId, spaceId, input.name, hash, now, now + 31536000000),
    ]);
  }
  if (nativeClient) return Response.json({ connected: true, token });
  return Response.json({ connected: true }, { headers: { "Set-Cookie": sessionCookie(request, token) } });
}

// Dispatch metadata, pairing, and multipart actions while enforcing space and device ownership.
async function routeRequest(request: Request, [resource, id, action, part]: string[]): Promise<Response> {
  const method = request.method;
  if (resource === "native" && id === "connect" && method === "POST") return connectDevice(request, true);
  if (resource === "access" && method === "GET") return Response.json({ canCreateSpace: isLocal(request) });
  if (resource === "connect" && method === "POST") return connectDevice(request);
  const device = await requireDevice(request);
  if (resource === "session" && method === "GET") return Response.json({ space: { id: device.space_id, name: device.space_name }, deviceId: device.id, transport: storageMode(request) });
  if (resource === "feed" && method === "GET") {
    const result = await database().prepare(`SELECT media.id, media.name, media.mime, media.size, media.sha256, media.category,
      media.created_at AS createdAt, devices.name AS deviceName FROM media JOIN devices ON devices.id = media.device_id
      WHERE media.space_id = ? AND media.status = 'ready' ORDER BY media.created_at DESC LIMIT 200`).bind(device.space_id).all();
    return Response.json({ items: result.results });
  }
  if (resource === "devices" && method === "GET") {
    const result = await database().prepare("SELECT id, name, created_at AS createdAt FROM devices WHERE space_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at").bind(device.space_id, Date.now()).all<{ id: string; name: string; createdAt: number }>();
    return Response.json({ devices: result.results.map(item => ({ ...item, current: item.id === device.id })) });
  }
  if (resource === "devices" && id && method === "DELETE") {
    if (id === device.id) throw new ApiError(400, "Keep this device connected while managing other devices.");
    await database().prepare("UPDATE devices SET revoked_at = ? WHERE id = ? AND space_id = ?").bind(Date.now(), id, device.space_id).run();
    return Response.json({ disconnected: true });
  }
  if (resource === "invitations" && method === "POST") {
    const token = newToken();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    await database().prepare("INSERT INTO invitations (token_hash, space_id, expires_at) VALUES (?, ?, ?)").bind(await tokenHash(token), device.space_id, expiresAt).run();
    return Response.json({ token, expiresAt });
  }
  if (resource === "uploads" && !id && method === "POST") {
    if (storageMode(request) === "unconfigured") throw new ApiError(503, "Direct transfers are not connected yet.");
    return Response.json(await initializeUpload(device, await readJson(request, uploadSchema)));
  }
  if (resource === "uploads" && id) {
    const item = await requireMedia(device, id, true);
    if (action === "part" && method === "POST") {
      if (item.status === "ready") throw new ApiError(409, "This file is already available.");
      const { number } = await readJson(request, z.object({ number: z.number().int().min(1).max(Math.ceil(item.size / item.part_size)) }));
      const url = storageMode(request) === "local" ? `/api/uploads/${id}/bytes/${number}` : await signedObjectUrl(item.object_key, "PUT", { uploadId: item.upload_id, partNumber: String(number) });
      return Response.json({ url });
    }
    if (action === "bytes" && method === "PUT" && isLocal(request)) {
      const number = Number(part);
      if (item.status !== "uploading" || !Number.isInteger(number) || number < 1 || number > Math.ceil(item.size / item.part_size)) throw new ApiError(400, "Invalid transfer part.");
      const expected = Math.min(item.part_size, item.size - (number - 1) * item.part_size);
      if (Number(request.headers.get("Content-Length")) !== expected || !request.body) throw new ApiError(400, "Incomplete transfer part. Please retry.");
      const uploaded = await bucket().resumeMultipartUpload(item.object_key, item.upload_id).uploadPart(number, request.body);
      return Response.json(uploaded, { headers: { ETag: uploaded.etag } });
    }
    if (action === "complete" && method === "POST") {
      if (item.status === "ready") return Response.json({ ready: true });
      const { parts } = await readJson(request, z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) })).max(10000) }));
      const ordered = parts.sort((a, b) => a.partNumber - b.partNumber);
      if (ordered.length !== Math.ceil(item.size / item.part_size) || ordered.some((value, index) => value.partNumber !== index + 1)) throw new ApiError(400, "Some parts are missing. Resume this transfer.");
      let object = await bucket().head(item.object_key);
      if (!object) object = await bucket().resumeMultipartUpload(item.object_key, item.upload_id).complete(ordered);
      if (object.size !== item.size) throw new ApiError(409, "File size did not match. This transfer has not been published.");
      await database().prepare("UPDATE media SET status = 'ready' WHERE id = ? AND device_id = ?").bind(item.id, device.id).run();
      return Response.json({ ready: true });
    }
  }
  if (resource === "media" && id && method === "GET") {
    const item = await requireMedia(device, id);
    if (item.status !== "ready") throw new ApiError(409, "This file is still arriving.");
    if (action === "link") {
      if (storageMode(request) === "unconfigured") throw new ApiError(503, "Direct downloads are not connected yet.");
      const url = storageMode(request) === "direct" ? await signedObjectUrl(item.object_key, "GET", { "response-content-disposition": attachmentName(item.name) }) : `/api/media/${id}/download`;
      return Response.json({ url });
    }
    const inline = action === "preview" && /^(image\/(jpeg|png|webp|gif|avif)|video\/(mp4|webm|quicktime))$/.test(item.mime);
    const disposition = inline ? "inline" : attachmentName(item.name);
    if (storageMode(request) === "direct") return new Response(null, { status: 302, headers: { Location: await signedObjectUrl(item.object_key, "GET", { "response-content-disposition": disposition }) } });
    if (!isLocal(request)) throw new ApiError(503, "Direct downloads are not connected yet.");
    const rangeRequested = request.headers.has("Range");
    const object = await bucket().get(item.object_key, rangeRequested ? { range: request.headers } : undefined);
    if (!object) throw new ApiError(404, "This file is not available.");
    const headers = new Headers({ "Content-Type": inline ? item.mime : "application/octet-stream", "Content-Disposition": disposition, "Accept-Ranges": "bytes", ETag: object.httpEtag });
    if (rangeRequested && object.range && "offset" in object.range && "length" in object.range && object.range.offset !== undefined && object.range.length !== undefined) {
      headers.set("Content-Range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
      headers.set("Content-Length", String(object.range.length));
    } else headers.set("Content-Length", String(object.size));
    return new Response(object.body, { headers, status: rangeRequested && object.range ? 206 : 200 });
  }
  throw new ApiError(404, "This action is not available.");
}
export const GET = serveRequest;
export const POST = serveRequest;
export const PUT = serveRequest;
export const DELETE = serveRequest;
