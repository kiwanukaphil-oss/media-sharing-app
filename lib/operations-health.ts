import { AccountError } from "./account-sessions";

const statusKey = "operations/identity-monitor-v1.json";
const freshnessMs = 90 * 60 * 1000;
const encoder = new TextEncoder();
type MonitorRecord = { status: "success" | "failure"; eventAt: number; receivedAt: number };
const denyReport = () => new AccountError(403, "Monitoring report could not be verified.");

function validRecord(value: unknown): value is MonitorRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as MonitorRecord;
  return ["success", "failure"].includes(record.status) && Number.isSafeInteger(record.eventAt) &&
    Number.isSafeInteger(record.receivedAt) && record.eventAt > 0 && record.receivedAt > 0;
}

// Publish only a coarse health signal. Missing, corrupt, failed and stale runs all fail closed.
export async function readOperationsHealth(storage: R2Bucket, secret: string | undefined, now = Date.now()) {
  let healthy = false;
  if (/^[a-f0-9]{64}$/.test(secret || "")) {
    const object = await storage.get(statusKey);
    if (object && object.size <= 1024) {
      let record: unknown;
      try { record = await object.json(); } catch { record = null; }
      healthy = validRecord(record) && record.status === "success" && record.receivedAt <= now && now - record.receivedAt <= freshnessMs;
    }
  }
  return Response.json({ status: healthy ? "ok" : "degraded" }, { status: healthy ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

// A hard streaming bound applies before parsing or signature verification, including chunked requests.
async function readMonitorBody(request: Request) {
  if (!request.body) throw denyReport();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      length += result.value.byteLength;
      if (length > 1024) { await reader.cancel(); throw denyReport(); }
      chunks.push(result.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

// The dedicated key can report health only; it grants no account, media or recovery-event access.
// Conditional R2 writes prevent delayed/concurrent reports from replacing newer outcomes.
export async function acceptOperationsReport(request: Request, storage: R2Bucket, secret: string | undefined, now = Date.now()) {
  if (request.method !== "POST" || request.headers.has("Origin") || !/^[a-f0-9]{64}$/.test(secret || "")) throw denyReport();
  const timestamp = request.headers.get("X-Relay-Monitor-Time") || "";
  const signature = request.headers.get("X-Relay-Monitor-Signature") || "";
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature)) throw denyReport();
  let body: string;
  try { body = await readMonitorBody(request); } catch { throw denyReport(); }
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const proof = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  if (!await crypto.subtle.verify("HMAC", key, proof, encoder.encode(`${timestamp}.${body}`))) throw denyReport();
  let report: { status?: unknown };
  try { report = JSON.parse(body); } catch { throw denyReport(); }
  if (!report || Object.keys(report).length !== 1 || (report.status !== "success" && report.status !== "failure")) throw denyReport();
  const status = report.status as MonitorRecord["status"];
  for (let attempt = 0; attempt < 3; attempt++) {
    const previous = await storage.get(statusKey);
    let record: unknown = null;
    if (previous && previous.size <= 1024) {
      try { record = await previous.json(); } catch { record = null; }
    }
    if (validRecord(record) && (record.eventAt > Number(timestamp) ||
      (record.eventAt === Number(timestamp) && (record.status === "failure" || status === "success")))) return new Response(null, { status: 204 });
    const onlyIf = previous ? { etagMatches: previous.etag } : { etagDoesNotMatch: "*" };
    const written = await storage.put(statusKey, JSON.stringify({ status, eventAt: Number(timestamp), receivedAt: now }),
      { onlyIf, httpMetadata: { contentType: "application/json", cacheControl: "no-store" } });
    if (written) return new Response(null, { status: 204 });
  }
  throw new AccountError(503, "Monitoring report could not be recorded. Retry shortly.");
}
