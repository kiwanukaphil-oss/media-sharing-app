import assert from "node:assert/strict";

const origin = "https://relay-media-exchange.kiwanukaphil.workers.dev";
assert.equal((await fetch(origin)).status, 200);
for (const path of ["session", "feed", "devices"]) {
  assert.equal((await fetch(`${origin}/api/${path}`)).status, 401, `${path} must reject an unpaired device`);
}
const connect = await fetch(`${origin}/api/connect`, {
  method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
  body: JSON.stringify({ name: "Unauthorized test" }),
});
assert.equal(connect.status, 403, "A visitor without an invitation must not create a space");
console.log("PASS: hosted entry point, private feed/devices/session, and invitation-only space access.");
