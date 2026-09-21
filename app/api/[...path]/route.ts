import { z } from "zod";
import { accountAction } from "@/lib/account-api";
import { acceptRecoveryEvent } from "@/lib/account-recovery";
import { acceptOperationsReport, readOperationsHealth } from "@/lib/operations-health";
import { listLegacyAccess, revokeLegacyAccess } from "@/lib/legacy-reconciliation";
import { AccountError } from "@/lib/account-sessions";
import { requireAccountSpaceAccess, scopedTransferUrl } from "@/lib/account-space-access";
import { readAuth0Settings } from "@/lib/auth0-config";
import { changeSpacePerson, createPersonInvitation, listSpacePeople, revokePersonInvitation } from "@/lib/space-people";
import { cancelPublication, finishPublication, reservePublication } from "@/lib/publications";
import { webAction } from "@/lib/web-api";
import { changeDeviceAccess, expiredSessionCookie } from "@/lib/device-access";
import { limitPublicRequest, limitDeviceRequest, privateResponseHeaders } from "@/lib/request-security";
import { ApiError, assertSameOrigin, attachmentName, bucket, database, initializeUpload, isLocal, newToken, readJson, requireDevice, requireMedia, requireOwner, sessionCookie, signedObjectUrl, spaceLimitBytes, storageMode, tokenHash, uploadSchema } from "@/lib/server";
import { transferAuthority } from "@/lib/transfer-authority";

export const dynamic = "force-dynamic";
const deviceName = z.string().trim().min(1).max(60);

// One boundary applies consistent errors and private caching to all device-scoped endpoints.
async function serveRequest(request: Request) {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  try {
    const segments = new URL(request.url).pathname.slice(5).split("/");
    if (segments.length > 4 || new URL(request.url).search.length > 2048) throw new ApiError(400, "Invalid request address.");
    await limitPublicRequest(request, segments[0]);
    if (segments.length === 2 && segments[0] === "operations" && segments[1] === "health") {
      if (!["GET", "POST"].includes(request.method)) throw new ApiError(405, "Method not allowed.");
      const response = request.method === "GET" ? await readOperationsHealth(bucket(), process.env.RELAY_MONITOR_SECRET) :
        await acceptOperationsReport(request, bucket(), process.env.RELAY_MONITOR_SECRET);
      for (const [name, value] of Object.entries(privateResponseHeaders(requestId))) response.headers.set(name, value);
      return response;
    }
    if (segments.length === 2 && segments[0] === "auth" && segments[1] === "recovery-event") {
      const response = await acceptRecoveryEvent(request, database(), readAuth0Settings(process.env), process.env.AUTH0_RECOVERY_SECRET);
      for (const [name, value] of Object.entries(privateResponseHeaders(requestId))) response.headers.set(name, value);
      return response;
    }
    // Native clients have no browser Origin; browser mutations retain strict CSRF checks.
    const nativePairing = segments[0] === "native" && segments[1] === "connect";
    if (request.method !== "GET" && (request.headers.has("Origin") || (!nativePairing && !request.headers.has("Authorization")))) assertSameOrigin(request);
    const response = await routeRequest(request, segments);
    for (const [name, value] of Object.entries(privateResponseHeaders(requestId))) response.headers.set(name, value);
    return response;
  } catch (error) {
    const status = error instanceof ApiError || error instanceof AccountError ? error.status : 500;
    // Never log raw exceptions, URLs, names, credentials, or request bodies; they may contain media details.
    if (status >= 500) console.error(JSON.stringify({ event: "relay_request_failed", requestId, status, method: request.method, durationMs: Date.now() - started }));
    return Response.json({ error: error instanceof ApiError || error instanceof AccountError ? error.message : "Couldn't complete that request. Please retry.", requestId }, { status, headers: { ...privateResponseHeaders(requestId), ...(status === 429 ? { "Retry-After": "60" } : {}) } });
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
    const eligibleInvitation = `token_hash = ? AND expires_at > ? AND redeemed_at IS NULL AND EXISTS (
      SELECT 1 FROM devices AS issuer WHERE issuer.id = invitations.created_by AND issuer.space_id = invitations.space_id
      AND issuer.role = 'owner' AND issuer.revoked_at IS NULL AND issuer.expires_at > ?
      AND NOT EXISTS (SELECT 1 FROM personal_spaces WHERE space_id = issuer.space_id))`;
    const invitation = await database().prepare(`SELECT space_id FROM invitations WHERE ${eligibleInvitation}`).bind(invitationHash, now, now).first<{ space_id: string }>();
    if (!invitation) throw new ApiError(410, "This invitation expired or was already used. Get a new link from a connected device.");
    spaceId = invitation.space_id;
    const results = await database().batch([
      database().prepare(`INSERT INTO devices (id, space_id, name, token_hash, created_at, expires_at)
        SELECT ?, space_id, ?, ?, ?, ? FROM invitations WHERE ${eligibleInvitation}`)
        .bind(deviceId, input.name, hash, now, now + 31536000000, invitationHash, now, now),
      database().prepare("UPDATE invitations SET redeemed_at = ? WHERE token_hash = ? AND redeemed_at IS NULL").bind(now, invitationHash),
    ]);
    if (!results[0].meta.changes) throw new ApiError(410, "This invitation was already used. Request a new one.");
  } else {
    if (nativeClient) throw new ApiError(403, "Pair this device using an invitation.");
    if (!isLocal(request) && String(process.env.ALLOW_SPACE_CREATION) !== "true") throw new ApiError(403, "Use an invitation from a connected device.");
    await database().batch([
      database().prepare("INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)").bind(spaceId, input.spaceName || "Our shared space", now),
      database().prepare("INSERT INTO devices (id, space_id, name, token_hash, role, created_at, expires_at) VALUES (?, ?, ?, ?, 'owner', ?, ?)").bind(deviceId, spaceId, input.name, hash, now, now + 31536000000),
    ]);
  }
  if (nativeClient) return Response.json({ connected: true, token });
  return Response.json({ connected: true }, { headers: { "Set-Cookie": sessionCookie(request, token) } });
}

// Dispatch metadata, pairing, and multipart actions while enforcing space and device ownership.
async function routeRequest(request: Request, [resource, id, action, part]: string[]): Promise<Response> {
  const method = request.method;
  if (resource === "auth") return accountAction(request, database(), readAuth0Settings(process.env));
  if (resource === "health" && !id && method === "GET") {
    if (storageMode(request) === "unconfigured") throw new ApiError(503, "Service temporarily unavailable.");
    await Promise.all([database().prepare("SELECT id, preview_size FROM media LIMIT 1").all(), database().prepare("SELECT role FROM devices LIMIT 1").all(), database().prepare("SELECT created_by FROM invitations LIMIT 1").all(), bucket().head("_relay_health_probe")]);
    return Response.json({ status: "ok" });
  }
  if (resource === "native" && id === "connect" && method === "POST") return connectDevice(request, true);
  if (resource === "access" && method === "GET") return Response.json({ canCreateSpace: isLocal(request) });
  if (resource === "connect" && method === "POST") return connectDevice(request);
  const accountAccess = await requireAccountSpaceAccess(request, database(), readAuth0Settings(process.env));
  const device = accountAccess || await requireDevice(request);
  // Pairing and device administration remain explicitly legacy until person invitations are implemented.
  if (accountAccess && (["devices", "invitations"].includes(resource) || (resource === "session" && method !== "GET"))) {
    throw new ApiError(409, "Use Account for sign-out. Device pairing is available from a connected device.");
  }
  await limitDeviceRequest(request, device.id, resource, id, action);
  if (resource === "legacy-devices") {
    if (!accountAccess) throw new ApiError(403, "Sign in as a library owner to review paired devices.");
    if (!id && method === "GET") return Response.json(await listLegacyAccess(database(), accountAccess, device.space_id));
    if (method === "DELETE" && id && !action) {
      if (id !== "all" && !z.string().uuid().safeParse(id).success) throw new ApiError(400, "Choose a paired device.");
      const input = await readJson(request, z.object({ confirmed: z.literal(true) }));
      if (input.confirmed) return Response.json(await revokeLegacyAccess(database(), accountAccess, device.space_id, id === "all" ? null : id));
    }
    throw new ApiError(404, "Action not found.");
  }
  if (resource === "publications") {
    if (!accountAccess) throw new ApiError(403, "Sign in with your account to publish a personal file.");
    if (!id && method === "GET") {
      const sourceId = new URL(request.url).searchParams.get("sourceId") || "";
      if (!z.string().uuid().safeParse(sourceId).success || accountAccess.space_kind !== "personal") throw new ApiError(400, "Choose a personal original.");
      const publication = await database().prepare(`SELECT id, source_id AS sourceId, source_revision AS sourceRevision,
        destination_space_id AS destinationSpaceId, album_id AS albumId, section_id AS sectionId, phase FROM publications
        WHERE person_id = ? AND source_space_id = ? AND source_id = ? AND phase IN ('pending','copying','cancelling','ready') ORDER BY created_at DESC LIMIT 1`)
        .bind(accountAccess.personId, accountAccess.space_id, sourceId).first();
      return Response.json({ publication });
    }
    if (id && !action && method === "DELETE") return Response.json(await cancelPublication(database(), bucket(), accountAccess, id));
    if (!id && method === "POST") {
      const input = await readJson(request, z.object({ id: z.string().uuid(), sourceId: z.string().uuid(), sourceRevision: z.number().int().nonnegative(),
        destinationSpaceId: z.string().uuid(), albumId: z.string().uuid().optional(), sectionId: z.string().uuid().optional(), confirmed: z.literal(true) }));
      const destinationRequest = new Request(`${new URL(request.url).origin}/api/session?space=${input.destinationSpaceId}`, {
        headers: { Cookie: request.headers.get("Cookie") || "" } });
      const destination = await requireAccountSpaceAccess(destinationRequest, database(), readAuth0Settings(process.env));
      if (!destination) throw new ApiError(403, "Choose an authorised shared destination.");
      const job = await reservePublication(database(), accountAccess, destination, input, spaceLimitBytes(destination));
      return Response.json(await finishPublication(database(), bucket(), accountAccess, job));
    }
    throw new ApiError(404, "This publication action is unavailable.");
  }
  if (["people", "person-invitations"].includes(resource)) {
    if (!accountAccess) throw new ApiError(403, "Sign in with your account to manage people.");
    if (resource === "people" && !id && method === "GET") return Response.json(await listSpacePeople(database(), accountAccess, device.space_id));
    if (resource === "people" && id && !action && method === "PUT") {
      const input = await readJson(request, z.object({ action: z.enum(["owner", "member", "remove", "leave"]), revision: z.number().int().nonnegative() }));
      return Response.json(await changeSpacePerson(database(), accountAccess, device.space_id, id, input.action, input.revision));
    }
    if (resource === "person-invitations" && !id && method === "POST") {
      const input = await readJson(request, z.object({ email: z.string().trim().email().max(320) }));
      return Response.json(await createPersonInvitation(database(), accountAccess, device.space_id, input.email));
    }
    if (resource === "person-invitations" && id && !action && method === "DELETE") return Response.json(await revokePersonInvitation(database(), accountAccess, device.space_id, id));
    throw new ApiError(404, "This people action is unavailable.");
  }
  const webResponse = await webAction(request, device, resource, id, action);
  if (webResponse) return webResponse;
  if (resource === "session" && !id && method === "GET") return Response.json({ space: { id: device.space_id, name: device.space_name, kind: device.space_kind || "shared" }, deviceId: device.id, role: device.role, transport: storageMode(request), ...(accountAccess ? { authentication: "account", personId: accountAccess.personId } : {}) });
  if (resource === "session" && !id && method === "DELETE") {
    await changeDeviceAccess(device, device.id);
    return Response.json({ disconnected: true }, { headers: { "Set-Cookie": expiredSessionCookie(request) } });
  }
  /* Legacy feed query retained as a removal candidate; paginated reads are served by webAction.
  if (resource === "legacy-feed-disabled" && method === "GET") {
    const result = await database().prepare(`SELECT media.id, media.name, media.mime, media.size, media.sha256, media.category,
      media.created_at AS createdAt, devices.name AS deviceName FROM media JOIN devices ON devices.id = media.device_id
      WHERE media.space_id = ? AND media.status = 'ready' ORDER BY media.created_at DESC LIMIT 200`).bind(device.space_id).all();
    return Response.json({ items: result.results });
  }
  */
  if (resource === "devices" && method === "GET") {
    const result = await database().prepare("SELECT id, name, role, created_at AS createdAt FROM devices WHERE space_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at").bind(device.space_id, Date.now()).all<{ id: string; name: string; role: "owner" | "member"; createdAt: number }>();
    return Response.json({ devices: result.results.map(item => ({ ...item, current: item.id === device.id })) });
  }
  if (resource === "devices" && id && !action && method === "DELETE") {
    if (id === device.id) throw new ApiError(400, "Use Disconnect this device to leave this space.");
    await changeDeviceAccess(device, id);
    return Response.json({ disconnected: true });
  }
  if (resource === "devices" && id && action === "role" && method === "PUT") {
    requireOwner(device);
    const { role } = await readJson(request, z.object({ role: z.enum(["owner", "member"]) }));
    await changeDeviceAccess(device, id, role);
    return Response.json({ changed: true });
  }
  if (resource === "invitations" && method === "POST") {
    requireOwner(device);
    const token = newToken();
    const expiresAt = Date.now() + 10 * 60 * 1000;
    const created = await database().prepare(`INSERT INTO invitations (token_hash, space_id, created_by, expires_at)
      SELECT ?, space_id, id, ? FROM devices WHERE id = ? AND role = 'owner' AND revoked_at IS NULL AND expires_at > ?`)
      .bind(await tokenHash(token), expiresAt, device.id, Date.now()).run();
    if (!created.meta.changes) throw new ApiError(403, "Owner access has changed. Refresh this space.");
    return Response.json({ token, expiresAt });
  }
  if (resource === "uploads" && !id && method === "POST") {
    if (storageMode(request) === "unconfigured") throw new ApiError(503, "Direct transfers are not connected yet.");
    return Response.json(await initializeUpload(device, await readJson(request, uploadSchema)));
  }
  if (resource === "uploads" && id) {
    const item = await requireMedia(device, id, true);
    if (action === "part" && method === "POST") {
      if (item.status !== "uploading") throw new ApiError(409, "This transfer is no longer accepting parts.");
      const { number } = await readJson(request, z.object({ number: z.number().int().min(1).max(Math.ceil(item.size / item.part_size)) }));
      const expectedBytes = Math.min(item.part_size, item.size - (number - 1) * item.part_size);
      const url = storageMode(request) === "local" ? scopedTransferUrl(`/api/uploads/${id}/bytes/${number}`, device) : await signedObjectUrl(item.object_key, "PUT", { uploadId: item.upload_id, partNumber: String(number) }, expectedBytes);
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
      if (item.status !== "uploading") throw new ApiError(409, "This upload was cancelled.");
      const { parts } = await readJson(request, z.object({ parts: z.array(z.object({ partNumber: z.number().int().positive(), etag: z.string().min(1).max(200) })).max(10000) }));
      const ordered = parts.sort((a, b) => a.partNumber - b.partNumber);
      if (ordered.length !== Math.ceil(item.size / item.part_size) || ordered.some((value, index) => value.partNumber !== index + 1)) throw new ApiError(400, "Some parts are missing. Resume this transfer.");
      let object = await bucket().head(item.object_key);
      if (!object) object = await bucket().resumeMultipartUpload(item.object_key, item.upload_id).complete(ordered);
      if (object.size !== item.size) {
        await bucket().delete(item.object_key);
        throw new ApiError(409, "File size did not match. Restart this transfer to send the original again.");
      }
      const authority = transferAuthority(device);
      const published = await database().prepare(`UPDATE media SET status = 'ready' WHERE id = ? AND device_id = ? AND status = 'uploading' AND upload_id = ? AND ${authority.sql}`)
        .bind(item.id, device.id, item.upload_id,...authority.bindings).run();
      if (!published.meta.changes) {
        if (!await database().prepare(`SELECT 1 WHERE ${authority.sql}`).bind(...authority.bindings).first())
          throw new ApiError(403, "Library access changed. This transfer has not been published.");
        const latest = await database().prepare("SELECT status FROM media WHERE id = ?").bind(item.id).first<{ status: string }>();
        if (latest?.status === "ready") return Response.json({ ready: true });
        // Completion can race an explicit cancellation; remove a late R2 object left by that race.
        if (!latest || latest.status === "cancelling") await bucket().delete(item.object_key);
        throw new ApiError(409, "This upload was cancelled or restarted.");
      }
      return Response.json({ ready: true });
    }
  }
  if (resource === "media" && id && method === "GET") {
    const item = await requireMedia(device, id);
    if (item.status !== "ready") throw new ApiError(409, "This file is still arriving.");
    if (action === "link") {
      if (storageMode(request) === "unconfigured") throw new ApiError(503, "Direct downloads are not connected yet.");
      const url = storageMode(request) === "direct" ? await signedObjectUrl(item.object_key, "GET", { "response-content-disposition": attachmentName(item.name) }) : scopedTransferUrl(`/api/media/${id}/download`, device);
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
