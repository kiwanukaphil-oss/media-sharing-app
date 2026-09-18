# Relay production operations

This document distinguishes deployed safeguards from operational checks still awaiting activation or real-device access. Production is on Cloudflare Workers, D1 and private R2; the native apps are outside this phase.

The subsequent local owner/member implementation, migration, recovery procedure and pending sign-off are in [PHASE-1-READINESS.md](./PHASE-1-READINESS.md). It is not yet deployed; the deployed-version evidence below remains historical.

Hardening deployed on 17 September 2026 as version `279fd194-3c83-4ea2-8ea4-1ed4bb0199d9`. The deployed version and 100% allocation were read back from Cloudflare. The owner approved committing and publishing this hardening release and its automated checks.

## Request and storage controls

- The Worker applies CSP, anti-framing, no-sniff, no-referrer and HTTPS HSTS headers. Inline scripts/styles remain allowed for framework rendering; this is not a nonce-based CSP.
- Unused framework image optimization and non-API mutation routes are denied. Original downloads continue directly from R2.
- Native rate-limit bindings enforce generous shared-IP ceilings (1,800/minute), pairing limits (30/minute), paired-device limits (600/minute), and sensitive-write limits (120/minute). Rejections return 429 with Retry-After. Missing production bindings fail closed.
- These limits are approximate and per Cloudflare location, not a global billing cap. They reduce abuse but do not replace account billing alerts or edge WAF policies.
- Upload part URLs sign Content-Length so parts match their reserved size. Completion still verifies assembled size; mismatched objects are removed without publishing.
- Existing 100 GiB per-space reservations, persistent pairing, tenant isolation and explicit Trash/permanent deletion remain in effect. No completed-original retention policy has been added.
- Cloudflare reports the hosting account is on Workers Free. A proposed paid-plan CPU ceiling was rejected; the free plan's platform limits remain in effect. No subscription was added. The owner must reconcile this with their existing $5 subscription before paid capacity can be assumed.

## Observability and alerts

Worker logs retain structured 5xx events with request ID, status and timing where available. Raw errors, cookies, bearer tokens, signed URLs, request bodies and filenames are deliberately excluded. Automatic invocation logs and traces are disabled to avoid recording sensitive URL parameters. Cloudflare's request/error metrics remain the first operational dashboard.

`GET /api/health` checks the required media schema, storage access and signing configuration without revealing account details or user files. A healthy response is `{"status":"ok"}`. It does not perform a real upload; the hosted transfer tests cover signing/CORS and byte integrity separately.

Run `node scripts/check-production.mjs` to probe the home page, response headers, dependency health and private-feed protection. The `production-health.yml` workflow is configured to run every 30 minutes and can be run manually. Confirm the intended failure notification recipient separately. Scheduled GitHub runs can be delayed; this is not a five-minute availability SLA. No alert delivery should be claimed until a real workflow run and notification configuration have been verified.

`web-checks.yml` checks dependencies, TypeScript, download integrity, the production build and API integration tests on pushes/PRs. The API suite loads the built modules directly in Miniflare/workerd with disposable D1/R2 stores. This avoids a reproduced Wrangler development-proxy failure on rejected request bodies; static assets and browser behavior are checked separately. Related upstream report: [Workers SDK #15203](https://github.com/cloudflare/workers-sdk/issues/15203). It does not auto-deploy. Git commits and pushes require the owner's explicit confirmation.

## Database recovery

D1 Time Travel is automatic: up to 30 days on Workers Paid, seven on Free. A current production bookmark was retrieved successfully. The exported production database was restored into fresh SQLite and D1 emulator stores; table counts, SQLite integrity and foreign keys passed. No production restore was performed.

1. Capture a bookmark before any future migration using `wrangler d1 time-travel info DB --config dist/server/wrangler.direct.json` with the project's Node/Wrangler wrapper.
2. Export to an ignored local path with `wrangler d1 export DB --remote --config dist/server/wrangler.direct.json --output .sites-runtime/production-recovery.sql`. Capture stdout privately: Wrangler prints a temporary signed export URL. The export contains device-token hashes and private metadata; never commit it or upload it as a public CI artifact.
3. Run `python scripts/verify-database-recovery.py`. This creates fresh, isolated local stores and validates restoration. D1 exports may place child rows before parent tables; the script creates all tables before inserting rows. Keep the generated report with private operational records.
4. For a real incident, stop writes, capture the current bookmark/export, identify the recovery point, and obtain explicit confirmation before restoring production. Use `wrangler d1 time-travel restore` with the chosen bookmark, record the undo bookmark, and run health and cross-device transfer checks afterward.

Database recovery does not recover deleted R2 bytes. Trash is reversible only before permanent deletion. Independent media backups and their retention/cost require the owner's decision. Until then, retain local originals and exports; do not treat Relay as the sole archival copy.

## Deploy and roll back

Run TypeScript, targeted ESLint, dependency audit, security/transfer/browser tests and the build. Stop a local Wrangler production preview before rebuilding on Windows because it holds files in `dist` open. Prepare the direct config and run a deploy dry run. Preserve Worker secrets and resource IDs.

After deployment, run the public production probe, `tests/hosted-web.mjs`, and the bounded hosted transfer test using only the ignored verification-space credential. Never print that credential or presigned URLs. The bounded test removes only its own named fixture.

For a faulty code release, use Wrangler rollback to the recorded previously working version. Rollback restores code/config, not database state. This hardening release has no database migration, so its predecessor remains schema-compatible. Existing release version before hardening: `abb8d007-f788-4393-bc13-11f4e8fb1e58`.

## Evidence and remaining sign-off

- Dependency audit after upgrades: zero reported vulnerabilities, including development dependencies. A scoped esbuild override replaces Drizzle's vulnerable development dependency; schema generation was verified with no changes.
- TypeScript/build/targeted lint and existing transfer/security tests passed.
- Production-build UI passed Chrome, Edge, Firefox and automated WebKit.
- Hosted production probe, anonymous-access protection and Chrome/Firefox direct upload/save flows passed after deployment. Fifty hosted feed requests at concurrency five completed without errors (p95 about 935 ms from this connection).
- Local 1,073,741,947-byte multipart round trip passed incremental SHA-256 verification. A bounded metadata test passed 200 requests at concurrency 20 (p95 about 795 ms on this workstation); this is a smoke load test, not a capacity guarantee.
- Hosted 268,435,579-byte multipart upload/download passed incremental SHA-256 verification. R2 rejected an incorrectly sized signed part with 403. Hosted oversized preview and JSON requests returned 413; subsequent requests and original-byte downloads passed. Test media was explicitly removed from the isolated verification space.
- Production export restoration passed in isolated SQLite and D1, with two spaces, seven devices, nine invitations and five media rows at export time.
- Real Safari/iPhone behavior still requires access to a physical Apple device. Browser uploads require the tab to remain available; web saves cannot silently write to Photos.
- Alert activation/delivery and independent media-backup policy await the owner's input. The framework adapter remains a pinned Vinext prerelease; upgrades require the browser/transfer regression suite.

References: [rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/), [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/), [Worker logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/).
