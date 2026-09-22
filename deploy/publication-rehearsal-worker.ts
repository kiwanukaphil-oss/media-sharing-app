import { createAccountSession, readAccountSession } from "../lib/account-sessions";
import { requireAccountSpaceAccess, type AccountSpaceAccess } from "../lib/account-space-access";
import { reservePublication, finishPublication, cancelPublication } from "../lib/publications";

type Environment = { DB: D1Database; BUCKET: R2Bucket; REHEARSAL_KEY?: string; REHEARSAL_EXPIRES_AT?: string; REHEARSAL_RUN_ENABLED?: string };
type Scenario = "copy" | "interruption" | "revocation" | "cancellation" | "multipart";
type Fixture = { source: AccountSpaceAccess; destination: AccountSpaceAccess; sourceId: string; sourceKey: string;
  membershipId: string; jobId: string; sha256: string };
const scenarios: Scenario[] = ["copy", "interruption", "revocation", "cancellation", "multipart"];
const settings = { issuer: "https://synthetic-rehearsal.invalid/", clientId: "synthetic-rehearsal",
  clientSecret: "unused-fixture", appOrigin: "https://synthetic-rehearsal.invalid", callbackUrl: "https://synthetic-rehearsal.invalid/callback" };
const bytes = new TextEncoder().encode("Relay isolated publication rehearsal. Generated test bytes only.");
const assert = (condition: unknown) => { if (!condition) throw new Error("Rehearsal invariant failed."); };
const fingerprint = async (value: BufferSource) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", value)), byte => byte.toString(16).padStart(2, "0")).join("");

// Accept only a short, signed operation name, with five-minute delivery freshness and a fixed deployment expiry.
// No SQL, object key, provider identity, URL or production credential can be supplied by the caller.
async function authenticateOperation(request: Request, env: Environment) {
  const operation = request.headers.get("X-Rehearsal-Operation") || "";
  const timestamp = request.headers.get("X-Rehearsal-Time") || "";
  const signature = request.headers.get("X-Rehearsal-Signature") || "";
  const expiry = Number(env.REHEARSAL_EXPIRES_AT);
  if (request.method !== "POST" || request.headers.has("Origin") || !/^[a-f0-9]{64}$/.test(env.REHEARSAL_KEY || "") ||
    !Number.isSafeInteger(expiry) || Date.now() >= expiry || !/^(seed|run):(copy|interruption|revocation|cancellation|multipart)$/.test(operation) ||
    (operation.startsWith("run:") && env.REHEARSAL_RUN_ENABLED !== "true") ||
    !/^\d{13}$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 300000 || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.REHEARSAL_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const proof = Uint8Array.from(signature.match(/../g)!, byte => parseInt(byte, 16));
  return await crypto.subtle.verify("HMAC", key, proof, new TextEncoder().encode(`${timestamp}.${operation}`)) ? operation : null;
}

// Refuse to initialise any populated application database or bucket: the live Relay resources cannot pass.
// After initialisation the explicit marker and fixed fixture identifiers bind every subsequent operation.
async function ensureIsolatedStorage(env: Environment) {
  const marker = await env.DB.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='publication_rehearsal_state'").first();
  if (!marker) {
    const occupied = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM spaces)+(SELECT COUNT(*) FROM people)+(SELECT COUNT(*) FROM media) AS n").first<{ n: number }>();
    assert(occupied?.n === 0);
    assert((await env.BUCKET.list({ limit: 1 })).objects.length === 0);
    await env.DB.prepare("CREATE TABLE publication_rehearsal_state (id TEXT PRIMARY KEY, fixture TEXT NOT NULL)").run();
    await env.DB.prepare("INSERT INTO publication_rehearsal_state VALUES ('marker','isolated-generated-content-only-v1')").run();
  }
  const value = await env.DB.prepare("SELECT fixture FROM publication_rehearsal_state WHERE id='marker'").first<{ fixture: string }>();
  assert(value?.fixture === "isolated-generated-content-only-v1");
}

// Create only generated identities and a tiny original in the separate rehearsal resources; no Auth0 calls.
// The production session and membership boundary supplies both actor contexts used by the copy implementation.
async function seedFixture(env: Environment, scenario: Scenario) {
  await ensureIsolatedStorage(env);
  const existing = await env.DB.prepare("SELECT fixture FROM publication_rehearsal_state WHERE id=?").bind(scenario).first();
  if (existing) return;
  const now = Date.now();
  const login = await createAccountSession(env.DB, settings, { issuer: settings.issuer, subject: scenario,
    displayName: "Generated rehearsal", verifiedEmail: `${scenario}@example.test`, authenticatedAt: now, credentialsChangedAt: 0 }, null, now);
  const session = await readAccountSession(env.DB, settings, login.token, now);
  assert(session);
  const personal = crypto.randomUUID(), shared = crypto.randomUUID(), membershipId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO spaces(id,name,created_at) VALUES (?,?,?)").bind(personal, "Generated personal", now),
    env.DB.prepare("INSERT INTO spaces(id,name,created_at) VALUES (?,?,?)").bind(shared, "Generated shared", now),
    env.DB.prepare("INSERT INTO personal_spaces VALUES (?,?,?)").bind(personal, session!.personId, 1073741824),
    env.DB.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES (?,?,?,'owner',?)").bind(crypto.randomUUID(), session!.personId, personal, now),
    env.DB.prepare("INSERT INTO space_memberships(id,person_id,space_id,role,created_at) VALUES (?,?,?,'owner',?)").bind(membershipId, session!.personId, shared, now),
  ]);
  const access = async (space: string) => requireAccountSpaceAccess(new Request(`${settings.appOrigin}/api/session?space=${space}`,
    { headers: { Cookie: `__Host-relay_account=${login.token}` } }), env.DB, settings);
  const source = await access(personal), destination = await access(shared);
  assert(source && destination);
  const sourceId = crypto.randomUUID(), sourceKey = `${personal}/${sourceId}/original`, sha256 = await fingerprint(bytes);
  await env.BUCKET.put(sourceKey, bytes, { httpMetadata: { contentType: "text/plain" } });
  await env.DB.prepare(`INSERT INTO media(id,space_id,device_id,name,mime,size,sha256,category,object_key,upload_id,part_size,status,created_at)
    VALUES (?,?,?,'Generated rehearsal.txt','text/plain',?,?,'original',?,'fixture',16,'ready',?)`)
    .bind(sourceId, personal, source!.id, bytes.length, sha256, sourceKey, now).run();
  const fixture: Fixture = { source: source!, destination: destination!, sourceId, sourceKey, membershipId, jobId: crypto.randomUUID(), sha256 };
  await env.DB.prepare("INSERT INTO publication_rehearsal_state VALUES (?,?)").bind(scenario, JSON.stringify(fixture)).run();
}

// Change authority or interrupt only after a real R2 write, then let the unchanged production code reconcile it.
// Run operations clean up generated temporary attempts while verifying that every generated source survives.
async function runFixture(env: Environment, scenario: Scenario) {
  await ensureIsolatedStorage(env);
  const record = await env.DB.prepare("SELECT fixture FROM publication_rehearsal_state WHERE id=?").bind(scenario).first<{ fixture: string }>();
  assert(record);
  const fixture: Fixture = JSON.parse(record!.fixture);
  const input = { id: fixture.jobId, sourceId: fixture.sourceId, sourceRevision: 0, destinationSpaceId: fixture.destination.space_id };
  const job = await reservePublication(env.DB, fixture.source, fixture.destination, input, 1073741824);
  let injected = false;
  const intercepted = new Proxy(env.BUCKET, { get(target, property) {
    if (property === "put") return async (...args: Parameters<R2Bucket["put"]>) => {
      const result = await target.put(...args);
      if (!injected) {
        injected = true;
        if (scenario === "interruption") throw new Error("Generated interrupted-copy fixture.");
        if (scenario === "revocation") await env.DB.prepare("UPDATE space_memberships SET revoked_at=? WHERE id=?").bind(Date.now(), fixture.membershipId).run();
        if (scenario === "cancellation") await cancelPublication(env.DB, env.BUCKET, fixture.source, fixture.jobId);
      }
      return result;
    };
    const value = Reflect.get(target, property, target);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  let failed = false;
  try { await finishPublication(env.DB, intercepted, fixture.source, job); } catch { failed = true; }
  if (scenario !== "copy") {
    assert(failed && injected);
    assert(!await env.DB.prepare("SELECT id FROM media WHERE id=? AND status='ready'").bind(fixture.jobId).first());
    const attempts = await env.DB.prepare("SELECT object_key FROM publication_attempts WHERE publication_id=?").bind(fixture.jobId).all<{ object_key: string }>();
    for (const attempt of attempts.results) assert(await env.BUCKET.head(attempt.object_key) === null);
    if (scenario === "interruption") {
      const retry = await reservePublication(env.DB, fixture.source, fixture.destination, input, 1073741824);
      await finishPublication(env.DB, env.BUCKET, fixture.source, retry);
    } else await cancelPublication(env.DB, env.BUCKET, fixture.source, fixture.jobId);
  } else assert(!failed);
  const original = await env.BUCKET.get(fixture.sourceKey);
  assert(original && await fingerprint(await original.arrayBuffer()) === fixture.sha256);
  if (["copy", "interruption"].includes(scenario)) {
    const media = await env.DB.prepare("SELECT object_key,sha256,status FROM media WHERE id=?").bind(fixture.jobId).first<{ object_key: string; sha256: string; status: string }>();
    assert(media?.status === "ready" && media.object_key !== fixture.sourceKey && media.sha256 === fixture.sha256);
    const copied = await env.BUCKET.get(media!.object_key);
    assert(copied && await fingerprint(await copied.arrayBuffer()) === fixture.sha256);
  } else assert(!await env.DB.prepare("SELECT id FROM media WHERE id=?").bind(fixture.jobId).first());
}

const multipartKey = "closure-multipart-rehearsal/2026-09-22/20ce059c-53bd-48ae-94fb-31efc0e55122";

// Persist the exact generated upload before any abort can run. The caller cannot choose a storage target.
// A failed allocation acknowledgement is retained as review-required; it is never silently reseeded.
async function seedMultipartFixture(env: Environment) {
  await ensureIsolatedStorage(env);
  const existing = await env.DB.prepare("SELECT fixture FROM publication_rehearsal_state WHERE id='multipart'").first();
  if (existing) return;
  assert(await env.BUCKET.head(multipartKey) === null);
  await env.DB.prepare("INSERT INTO publication_rehearsal_state VALUES ('multipart','allocation-pending')").run();
  const upload = await env.BUCKET.createMultipartUpload(multipartKey);
  await env.DB.prepare("UPDATE publication_rehearsal_state SET fixture=? WHERE id='multipart'")
    .bind(JSON.stringify({ key: multipartKey, uploadId: upload.uploadId, phase: "seeded" })).run();
}

// Rehearse only generated multipart bytes in the separate bucket. This tests rejection after an awaited
// abort; it deliberately does not claim to settle a direct URL or a remotely in-flight upload request.
async function runMultipartFixture(env: Environment) {
  await ensureIsolatedStorage(env);
  const record = await env.DB.prepare("SELECT fixture FROM publication_rehearsal_state WHERE id='multipart'").first<{ fixture: string }>();
  assert(record);
  const fixture = JSON.parse(record!.fixture);
  assert(fixture.key === multipartKey && typeof fixture.uploadId === "string" && fixture.uploadId.length > 0);
  if (fixture.phase === "passed") return;
  assert(fixture.phase === "seeded");
  const claimed = await env.DB.prepare("UPDATE publication_rehearsal_state SET fixture=? WHERE id='multipart' AND fixture=?")
    .bind(JSON.stringify({ ...fixture, phase: "running" }), record!.fixture).run();
  assert(claimed.meta.changes === 1);
  const upload = env.BUCKET.resumeMultipartUpload(multipartKey, fixture.uploadId);
  const part = await upload.uploadPart(1, bytes);
  await upload.abort();
  let latePartRejected = false, completionRejected = false;
  try { await upload.uploadPart(1, bytes); } catch { latePartRejected = true; }
  try { await upload.complete([part]); } catch { completionRejected = true; }
  assert(latePartRejected && completionRejected && await env.BUCKET.head(multipartKey) === null);
  await env.DB.prepare("UPDATE publication_rehearsal_state SET fixture=? WHERE id='multipart'")
    .bind(JSON.stringify({ ...fixture, phase: "passed", latePartRejected, completionRejected, verifiedAt: Date.now(), quiescenceProven: false })).run();
}

const publicationRehearsalWorker = {
  // This is a separate, expiring test Worker, never part of the production application route tree.
  async fetch(request: Request, env: Environment) {
    const operation = await authenticateOperation(request, env);
    if (!operation) return new Response(null, { status: 403 });
    const [action, scenario] = operation.split(":") as [string, Scenario];
    if (!scenarios.includes(scenario)) return new Response(null, { status: 400 });
    try {
      if (scenario === "multipart") {
        if (action === "seed") await seedMultipartFixture(env); else await runMultipartFixture(env);
      } else if (action === "seed") await seedFixture(env, scenario);
      else await runFixture(env, scenario);
      return Response.json({ status: "passed", operation }, { headers: { "Cache-Control": "no-store" } });
    } catch { return Response.json({ status: "failed", operation }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
  },
};
export default publicationRehearsalWorker;
