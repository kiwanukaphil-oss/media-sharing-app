# Direct Cloudflare deployment

Updated 2026-09-17. User selected direct Cloudflare hosting and authorized continued deployment work without phase confirmations. The initial preview was committed and pushed with approval (5ac02fe). The user also approved committing and pushing the tested web release.

- URL: https://relay-media-exchange.kiwanukaphil.workers.dev
- Worker: `relay-media-exchange`
- Current hardening version: `279fd194-3c83-4ea2-8ea4-1ed4bb0199d9` (17 September 2026), 100% deployment verified. Previous web release: `abb8d007-f788-4393-bc13-11f4e8fb1e58`.
- Hosting account is currently Workers Free according to Cloudflare's deployment API. No plan upgrade was made; the owner's existing $5 subscription needs reconciliation before paid-plan capacity is assumed.
- R2: `relay-media-originals` (private)
- D1: `relay-media`, resource identity in `cloudflare.json`
- Schema: `drizzle/0000_purple_chamber.sql` applied remotely once; additive migrations 0001_late_beyonder.sql and 0002_lush_karma.sql are also applied. Never replay these files.
- CORS: `r2-cors.json` applied for the exact Worker origin.
- Initial spaces/invitations: seeded once from ignored `.sites-runtime/cloud-invitations.sql`. Raw invitation material is in ignored `.sites-runtime/cloud-invitations.json`, expires 24 hours after creation, and must not be printed or committed.
- Live access tests: passed (`tests/hosted-access.mjs`). Anonymous users cannot access feeds/devices or create spaces.
- Credential: “Relay media transfers”, Object Read & Write, scoped only to `relay-media-originals`; created after explicit user approval.
- Worker secrets `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are configured. Values were transferred through a loopback-only handoff and Wrangler stdin, without being saved in source or secret files.
- Live direct-transfer tests passed: independent pairing, cross-session feed visibility, multipart R2 uploads, CORS preflight/exposed ETags, direct attachment downloads, matching SHA-256, and device revocation.
- A 16 MiB verification file and test sender device are retained in the isolated `Relay verification` space. The owner's space is separate.

## Web release and handoff

Web validation details and reproducible checks: [docs/WEB-VALIDATION.md](../docs/WEB-VALIDATION.md). Hosted web and direct multipart verification passed after migration and deployment.

Production-hardening controls and recovery instructions are in [PRODUCTION-RUNBOOK.md](../docs/PRODUCTION-RUNBOOK.md). Patched dependencies, rate limits, health checks, security headers, signed part-size enforcement and redacted error logs are deployed. The owner approved publishing the GitHub checks and health workflows; alert delivery is not yet verified. Independent media backups and physical iPhone checks remain outstanding decisions/validation.

The web release adds paginated/searchable feeds, separate image thumbnails, 100 GiB quotas with atomic reservations, Trash/restore/permanent deletion, upload cancellation/restart, download progress/cancellation, and invitation expiry feedback. Local API/integrity tests and Chrome, Edge, Firefox, and WebKit flows passed. Native source is unchanged in this phase.

The owner bootstrap invitation has been opened in the user's Chrome browser to pair “My desktop”. New phones can join through that device's “Pair a device” action. The native Android preview passed real Galaxy S24+ tests for pairing, background multipart uploads, verified gallery/download saving, and force-stop recovery. The test phone is paired to the isolated verification space; use “Pair another space” to join the owner's QR invitation. iOS source requires Mac compilation and device validation. Detailed results: [mobile/VALIDATION.md](../mobile/VALIDATION.md).

The deployed API now supports native bearer sessions through invitation-only `/api/native/connect`. Hosted native access and revocation checks passed. The source repository is `https://github.com/kiwanukaphil-oss/media-sharing-app.git`. The user approved committing and pushing the tested preview on 17 September 2026.

For repeat cloud verification, `tests/hosted-transfer.mjs` reuses its isolated sender session from ignored `.sites-runtime/cloud-test-session.json`. Treat that file as a credential. Verification fixtures and expired bootstrap files are cleanup candidates; they have deliberately not been deleted.

## Redeploy

```sh
node scripts/run-framework.mjs build
node scripts/prepare-cloudflare.mjs
node --import ./scripts/sites-env.mjs node_modules/wrangler/bin/wrangler.js deploy --config dist/server/wrangler.direct.json
```

Do not replay the initial database migration or bootstrap SQL. Preserve existing Worker secrets on redeployment. The Sites manifest is retained as compatibility metadata, not as the current deployment owner.
