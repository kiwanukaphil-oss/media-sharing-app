import { env } from "cloudflare:workers";
import { ApiError, isLocal, tokenHash } from "./server";

// Missing production bindings fail closed rather than silently removing abuse protection.
async function consumeLimit(binding: RateLimit | undefined, key: string, local: boolean) {
  if (!binding) { if (local) return; throw new ApiError(503, "Request protection is unavailable. Please retry shortly."); }
  if (!(await binding.limit({ key })).success) throw new ApiError(429, "Too many requests. Wait a minute, then try again.");
}

// A generous shared-IP ceiling protects authentication queries; tighter limits target paired devices.
export async function limitPublicRequest(request: Request, resource: string) {
  const local = isLocal(request);
  const ip = await tokenHash(request.headers.get("CF-Connecting-IP") || "local");
  await consumeLimit(env.API_RATE_LIMIT, `relay:ip:${ip}`, local);
  if (resource === "connect" || resource === "native" || resource === "auth") await consumeLimit(env.PAIR_RATE_LIMIT, `relay:pair:${ip}`, local);
}

export async function limitDeviceRequest(request: Request, deviceId: string, resource: string, id?: string, action?: string) {
  const local = isLocal(request);
  await consumeLimit(env.DEVICE_RATE_LIMIT, `relay:device:${deviceId}`, local);
  const createsUpload = resource === "uploads" && (!id || action === "restart");
  if (request.method !== "GET" && (createsUpload || resource === "invitations" || resource === "person-invitations" || resource === "people" || resource === "favorites" || resource === "metadata-export" || resource === "import-layout" || resource === "publications" || request.method === "DELETE")) {
    await consumeLimit(env.WRITE_RATE_LIMIT, `relay:write:${deviceId}`, local);
  }
}

export function privateResponseHeaders(requestId: string) {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Request-ID": requestId };
}
