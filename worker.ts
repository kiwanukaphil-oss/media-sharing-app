import handler from "vinext/server/fetch-handler";
import { responseSecurityHeaders } from "./lib/http-policy";
import { limitPublicRequest, privateResponseHeaders } from "./lib/request-security";
import { ApiError } from "./lib/server";

// Enforce headers and close unused framework endpoints before the framework handles a request.
const relayWorker = {
  async fetch(request: Request, environment: Cloudflare.Env, context: ExecutionContext) {
    const url = new URL(request.url);
    let response: Response;
    try {
      const metadataLimit = url.pathname.endsWith("/thumbnail") ? 250000 : 1024 * 1024;
      const localPart = /^\/api\/uploads\/[^/]+\/bytes\/\d+$/.test(url.pathname) && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      // Reject declared oversized metadata before invoking the framework; original bytes go directly to R2.
      if (!localPart && Number(request.headers.get("Content-Length")) > metadataLimit) response = Response.json({ error: "This request is too large." }, { status: 413, headers: privateResponseHeaders(crypto.randomUUID()) });
      else if (url.pathname.startsWith("/_next/image")) response = new Response(null, { status: 404 });
      else if (!url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method)) response = new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
      else {
        if (!url.pathname.startsWith("/api/")) await limitPublicRequest(request, "page");
        response = await handler.fetch(request, environment, context);
      }
    } catch (failure) {
      const status = failure instanceof ApiError ? failure.status : 500;
      const requestId = crypto.randomUUID();
      if (status >= 500) console.error(JSON.stringify({ event: "relay_worker_failed", status, requestId }));
      response = Response.json({ error: "Service temporarily unavailable. Please retry.", requestId }, { status, headers: { ...privateResponseHeaders(requestId), ...(status === 429 ? { "Retry-After": "60" } : {}) } });
    }
    const secured = new Response(response.body, response);
    for (const [name, value] of Object.entries(responseSecurityHeaders)) {
      if (name === "Content-Security-Policy" && process.env.NODE_ENV !== "production") continue;
      secured.headers.set(name, value);
    }
    if (url.protocol === "https:") secured.headers.set("Strict-Transport-Security", "max-age=31536000");
    return secured;
  },
};
export default relayWorker;
