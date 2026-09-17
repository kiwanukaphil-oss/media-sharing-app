import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const origin = process.env.RELAY_TEST_ORIGIN;
const invitation = process.env.RELAY_TEST_INVITATION;
if (!origin || !invitation || new URL(origin).protocol !== "https:") {
  throw new Error("Set RELAY_TEST_ORIGIN to the hosted HTTPS origin and RELAY_TEST_INVITATION to a fresh invitation. Never commit either device credentials or invitation tokens.");
}

async function requestApi(path, cookie, method = "GET", body) {
  return fetch(new URL(`/api/${path}`, origin), {
    method, redirect: "manual",
    headers: { Origin: origin, Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Validate a real R2 handoff using two independently paired sessions and a multipart fixture.
async function verifyHostedHandoff() {
  let sender = "";
  try { const saved = JSON.parse(await readFile(".sites-runtime/cloud-test-session.json", "utf8")); if (saved.origin === origin) sender = saved.cookie; } catch {}
  if (!sender) {
    const connect = await requestApi("connect", "", "POST", { name: "Relay cloud test sender", invitation });
    assert.equal(connect.status, 200, "Sender pairing failed; create a fresh invitation.");
    sender = connect.headers.get("set-cookie").split(";")[0];
    await writeFile(".sites-runtime/cloud-test-session.json", JSON.stringify({ origin, cookie: sender }), { mode: 0o600 });
  }
  const session = await requestApi("session", sender).then(response => response.json());
  assert.equal(session.transport, "direct", "Cloud tests must exercise direct-to-bucket transport.");
  const inviteResponse = await requestApi("invitations", sender, "POST");
  assert.equal(inviteResponse.status, 200);
  const { token } = await inviteResponse.json();
  const receiverResponse = await requestApi("connect", "", "POST", { name: "Relay cloud test receiver", invitation: token });
  assert.equal(receiverResponse.status, 200);
  const receiver = receiverResponse.headers.get("set-cookie").split(";")[0];
  const original = randomBytes(16 * 1024 * 1024 + 4096);
  const id = randomUUID();
  const hash = createHash("sha256").update(original).digest("hex");
  const uploadResponse = await requestApi("uploads", sender, "POST", { id, name: `relay-cloud-test-${id}.bin`, mime: "application/octet-stream", size: original.length, sha256: hash, category: "original" });
  assert.equal(uploadResponse.status, 200, "Multipart initialization failed.");
  const { partSize } = await uploadResponse.json();
  const parts = [];
  for (let number = 1; number <= Math.ceil(original.length / partSize); number++) {
    const signingResponse = await requestApi(`uploads/${id}/part`, sender, "POST", { number });
    assert.equal(signingResponse.status, 200);
    const { url } = await signingResponse.json();
    assert.ok(new URL(url).hostname.endsWith(".r2.cloudflarestorage.com"), "Upload must go directly to R2.");
    const preflight = await fetch(url, { method: "OPTIONS", headers: { Origin: origin, "Access-Control-Request-Method": "PUT" } });
    assert.ok(preflight.ok, "R2 CORS preflight failed.");
    assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    const uploaded = await fetch(url, { method: "PUT", headers: { Origin: origin }, body: original.subarray((number - 1) * partSize, number * partSize) });
    assert.ok(uploaded.ok, `R2 part ${number} was rejected (${uploaded.status}).`);
    assert.match(uploaded.headers.get("access-control-expose-headers") || "", /etag/i);
    const etag = uploaded.headers.get("etag");
    assert.ok(etag, "R2 must expose ETag for resumable uploads.");
    parts.push({ partNumber: number, etag: etag.replace(/^"|"$/g, "") });
  }
  assert.equal((await requestApi(`uploads/${id}/complete`, sender, "POST", { parts })).status, 200);
  const receiverFeed = await requestApi("feed", receiver).then(response => response.json());
  assert.ok(receiverFeed.items.some(item => item.id === id), "Completed file must appear for the other device.");
  const linkResponse = await requestApi(`media/${id}/link`, receiver);
  assert.equal(linkResponse.status, 200);
  const { url } = await linkResponse.json();
  assert.ok(new URL(url).hostname.endsWith(".r2.cloudflarestorage.com"), "Download must go directly to R2.");
  const download = await fetch(url, { headers: { Origin: origin } });
  assert.ok(download.ok);
  assert.equal(download.headers.get("access-control-allow-origin"), origin);
  assert.match(download.headers.get("content-disposition") || "", /attachment/i);
  assert.equal(createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"), hash);
  const receiverSession = await requestApi("session", receiver).then(response => response.json());
  assert.equal((await requestApi(`devices/${receiverSession.deviceId}`, sender, "DELETE")).status, 200);
  assert.equal((await requestApi("feed", receiver)).status, 401);
  console.log("PASS: hosted pairing, cross-session visibility, direct R2 multipart upload, CORS, byte-identical direct download, and revocation.");
  console.log("The named test original and sender device are retained in the shared space; no user media was removed.");
}

await verifyHostedHandoff();
