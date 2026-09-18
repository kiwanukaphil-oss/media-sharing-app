# Phase 1: access and release reliability

Status: implementation complete and approved for repository publication on 2026-09-18. Production migration and deployment remain pending.

## Permission contract

New spaces assign their first device as owner. Invitations always join as members; a caller cannot request an owner role. Owners can explicitly promote a trusted connected device. Members can browse, upload, save files, and cancel their own unfinished uploads. Owners additionally manage Trash, permanent deletion, invitations, device roles, and other devices' unfinished uploads.

Every privileged API checks the role; hidden buttons are not the security boundary. Role changes and revocations check both the actor and the last-active-owner rule within the same SQL write. A sole active owner must establish another owner before demoting or disconnecting itself. Device credentials still expire after one year; keep a second trusted owner and use the operator procedure below if all usable sessions are lost.

Self-disconnection revokes the stored credential and clears the browser cookie. The UI stops transfers, clears this device's local transfer manifests, and reloads the unpaired view. Existing shared media stays intact. Unfinished server reservations remain available for an owner to cancel from Storage. Already-issued object URLs retain their existing one-hour lifetime; local downloads cannot be recalled.

An invitation can be redeemed only while its issuing device remains an active owner. Demotion and revocation invalidate that owner's unused invitations. Browser and native bearer clients use the same permission boundary. The native client UI has not been redesigned in this web phase; older clients must handle the new 403 responses.

## Migration and release sequence

`drizzle/0003_device_roles.sql` is additive. It assigns one owner per existing space: the earliest non-revoked, unexpired device, using ID as a deterministic timestamp tie-breaker. Spaces with no active devices get no automatic owner and require operator recovery. Existing issuerless invitations are invalidated; paired sessions and media records are retained.

Before applying it remotely, review which device will become owner in each space. Do not assume the isolated verification credential belongs to the elected owner. Rotate or promote that test device through a verified owner if needed; hosted owner-only test suites require an owner credential.

1. Obtain approval for the production migration/deployment; pause active writes and take a D1 recovery bookmark/export.
2. Review the owner election with a read-only query over `devices`, filtering `revoked_at IS NULL` and `expires_at > now`, ordered by `created_at, id` within each space.
3. Apply only migration 0003 to the existing database, once. Do not replay earlier migrations.
4. Deploy the tested Worker and client, then run health, owner/member, invitation and original-byte transfer checks in the isolated verification space.
5. Verify the real owner's role and a second trusted owner before resuming normal use.

The previous Worker does not enforce roles. Rolling back to it restores broad peer permissions even though the new columns remain. Prefer a forward fix; do not treat a rollback to pre-role code as security-equivalent. Any such rollback needs explicit approval acknowledging that permission change.

## Operator-assisted access recovery

Recovery is not a public password-reset endpoint. The Cloudflare operator must independently verify the requester and the exact space. A lost cookie alone is not evidence of ownership.

If a trusted member still has access, identify that exact device and, after approval, promote it using a narrowly scoped administrative update matching both device ID and space ID. Do not promote a device based only on its display name. Confirm access, then review/revoke lost devices.

If every usable session is lost:

1. Run `node scripts/prepare-owner-recovery.mjs <verified-space-uuid>`. It only prepares ignored local files: SQL and a private temporary bearer credential. It performs no network requests or database changes.
2. Review and explicitly approve applying the SQL to the correct database. Verify exactly one row was inserted. The recovery device is an owner for thirty minutes from preparation; no existing device or file is removed.
3. Use the temporary credential only with this Relay origin's API to create a one-use invitation. Deliver the invitation only to the verified owner through an approved private channel. Never deliver the temporary bearer credential or publish either secret in logs/issues.
4. The owner pairs as a member. Verify the newly paired device ID and use the temporary owner's `PUT /api/devices/:id/role` with `{"role":"owner"}` to promote that specific device.
5. Confirm the owner's browser works, then revoke the temporary owner using `DELETE /api/session` with its bearer credential. Establish a second trusted owner and review lost devices. Remove recovery credential files through an explicitly approved cleanup.

This recovery path intentionally requires operator approval. It was not executed against production during implementation.

## Release checks

- `npm run lint` and `npm run lint:web` check the web workspace; generated/runtime output is ignored. `npm run lint:native` keeps native checks separate, with existing native errors still outstanding.
- `node tests/device-role-migration.mjs` checks legacy ownership assignment and invitation invalidation in disposable SQLite.
- `node scripts/ci-web-integration.mjs` builds no code: run the production build first. It applies the journal's migrations to disposable D1/R2, then exercises transfer, management, permissions and security APIs.
- `node scripts/ci-web-integration.mjs --browser` uses the built application and static assets in disposable storage. Chrome/Edge/Firefox/WebKit run locally; CI uses Playwright Chromium/Firefox/WebKit. A separate two-browser flow checks role changes and logout.
- `node scripts/ci-web-integration.mjs --capacity` checks 4 spaces with 1,000 metadata records each and 12 concurrent clients. This is a local search/pagination smoke test, not a hosted throughput guarantee or an R2-byte benchmark.
- `node scripts/ci-web-integration.mjs --serve` opens an isolated production preview on loopback port 8787. Stop it to discard its fixture storage.

Repeated testing reproduced the Windows HTTP reset even after response bodies were consumed and pooled connections avoided. The CI security probes therefore dispatch requests directly to the actual built Worker through Miniflare; they still exercise its headers, body limits, authentication and rate bindings without the faulty local HTTP transport. Other API and browser tests continue over HTTP. Status assertions remain strict, with no automatic test retries. This workaround does not claim to fix the upstream Windows transport itself.

## Local verification results

TypeScript, strict web lint, production build, migration/recovery preparation tests, download integrity, and the transfer/management/permission/security API suites passed. The direct-Worker security suite passed five consecutive isolated runs without retries. Chrome, Edge, Firefox and WebKit passed the core browser flows; the two-browser role/pairing/logout flow also passed. Desktop and 390px device dialogs were inspected visually.

The metadata capacity check completed 120 requests with 12 concurrent devices over 4 spaces of 1,000 files each, with zero errors, p50 281ms and p95 331ms on this workstation. Seeding used synthetic metadata in disposable storage. This does not establish a production SLA or paid-plan capacity.

## Operational sign-off still required

The GitHub production-health workflow is active. Its latest inspected run succeeded, but it was manually dispatched; this does not prove scheduled execution or delivery of failure notifications.

Operational setup was subsequently approved and completed: Better Stack email delivery was confirmed, independent Backblaze copies passed full restore checks, and the daily GitHub backup workflow is active. See OPERATIONS-ACTIVATION.md for evidence. The documented Workers Free capacity and physical iPhone boundaries remain unchanged until separately verified.
