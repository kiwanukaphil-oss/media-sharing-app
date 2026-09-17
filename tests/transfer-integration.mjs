import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

const origin = process.env.RELAY_TEST_ORIGIN || "http://localhost:5173";
if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("This test creates isolated fixtures and may only run against a local server.");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function api(path, cookie = "", method = "GET", body) {
  return fetch(`${origin}/api/${path}`, { method, headers: { Origin: origin, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
}
async function createSpace(name) {
  const response = await api("connect", "", "POST", { name, spaceName: `Test ${randomUUID()}` });
  assert.equal(response.status, 200, await response.clone().text());
  return response.headers.get("set-cookie").split(";")[0];
}

// Exercise real local D1/R2 routes, including ownership, multipart recovery, and byte equality.
async function verifyTransferPipeline() {
  assert.equal((await api("feed")).status, 401);
  const owner = await createSpace("Test desktop");
  const stranger = await createSpace("Unrelated device");
  const csrf = await fetch(`${origin}/api/invitations`, { method: "POST", headers: { Cookie: owner, Origin: "https://untrusted.example" } });
  assert.equal(csrf.status, 403);

  const bytes = randomBytes(16 * 1024 * 1024 + 8192);
  const id = randomUUID();
  const file = { id, name: "Original HDR — test.mov", mime: "video/quicktime", size: bytes.length, sha256: digest(bytes), category: "original" };
  const begin = await api("uploads", owner, "POST", file);
  assert.equal(begin.status, 200, await begin.clone().text());
  const upload = await begin.json();
  assert.equal((await api("feed", owner).then(response => response.json())).items.length, 0, "Unfinished originals must not be listed");
  assert.equal((await api(`uploads/${id}/part`, stranger, "POST", { number: 1 })).status, 404);
  assert.equal((await api(`uploads/${id}/part`, owner, "POST", { number: 3 })).status, 400);
  const parts = [];
  for (let number = 1; number <= 2; number++) {
    const signed = await api(`uploads/${id}/part`, owner, "POST", { number });
    const { url } = await signed.json();
    const part = bytes.subarray((number - 1) * upload.partSize, number * upload.partSize);
    const sent = await fetch(new URL(url, origin), { method: "PUT", headers: { Cookie: owner, Origin: origin }, body: part });
    assert.equal(sent.status, 200, await sent.clone().text());
    parts.push({ partNumber: number, etag: sent.headers.get("ETag").replace(/^"|"$/g, "") });
    if (number === 1) {
      const resume = await api("uploads", owner, "POST", file).then(response => response.json());
      assert.equal(resume.id, id, "Resume must retain the same upload");
      assert.equal((await api(`uploads/${id}/complete`, owner, "POST", { parts })).status, 400, "Missing parts must fail");
    }
  }
  const finished = await api(`uploads/${id}/complete`, owner, "POST", { parts });
  assert.equal(finished.status, 200, await finished.clone().text());
  assert.equal((await api(`uploads/${id}/complete`, owner, "POST", { parts })).status, 200, "Completion must be idempotent");
  const download = await api(`media/${id}/download`, owner);
  assert.equal(download.status, 200);
  assert.match(download.headers.get("content-disposition"), /attachment/);
  assert.equal(digest(Buffer.from(await download.arrayBuffer())), file.sha256, "The downloaded bytes must match the original");
  const range = await fetch(`${origin}/api/media/${id}/download`, { headers: { Cookie: owner, Range: "bytes=12-42" } });
  assert.equal(range.status, 206);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), bytes.subarray(12, 43));
  assert.equal((await api(`media/${id}/download`, stranger)).status, 404);
  assert.equal((await api("feed", stranger).then(response => response.json())).items.length, 0);

  const invitation = await api("invitations", owner, "POST").then(response => response.json());
  const pairedResponse = await api("connect", "", "POST", { name: "Test phone", invitation: invitation.token });
  assert.equal(pairedResponse.status, 200, await pairedResponse.clone().text());
  const paired = pairedResponse.headers.get("set-cookie").split(";")[0];
  assert.equal((await api("feed", paired).then(response => response.json())).items[0].id, id);
  assert.equal((await api("connect", "", "POST", { name: "Replay", invitation: invitation.token })).status, 410);
  const pairedSession = await api("session", paired).then(response => response.json());
  assert.equal((await api(`devices/${pairedSession.deviceId}`, owner, "DELETE")).status, 200);
  assert.equal((await api("feed", paired)).status, 401, "Revoked devices must lose access");

  const racingInvitation = await api("invitations", owner, "POST").then(response => response.json());
  const competing = await Promise.all(["A", "B"].map(name => api("connect", "", "POST", { name, invitation: racingInvitation.token })));
  assert.deepEqual(competing.map(response => response.status).sort(), [200, 410], "Exactly one concurrent redemption may succeed");
  console.log("PASS: multipart resume, missing-part rejection, byte-identical download, range download, space isolation, CSRF, pairing, invitation replay/race, device revocation.");
}
await verifyTransferPipeline();
