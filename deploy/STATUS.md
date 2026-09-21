# Direct Cloudflare deployment

## Current web library release — 18 September 2026

User approved production deployment of the tested library release. Worker version `16ec7bee-77c3-47db-b142-1bde072af82c` is live at 100%, verified by deployment read-back. The immediately preceding live version was `f48b60d3-a077-4d7f-bcac-22fe4bf5553e`.

Production already had migration 0003. Only migration `0004_confused_magik.sql` was applied in this release, after capturing a recovery bookmark/export and verifying an isolated restore. Existing resource IDs and secrets were preserved. Live health, library/rename browser checks, original-byte saves and cross-session multipart transfers passed. All seven pre-release media records were checked for unchanged names, storage keys and integrity metadata. Details are in [WEB-LIBRARY.md](../docs/WEB-LIBRARY.md). The source commit was approved after production verification. Release commit `051ee68` was pushed to `origin/main` after user approval.

The earlier release notes below are retained as historical evidence; their version and schema statements describe those earlier deployments.

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

## Custom domain ? 20 September 2026

Primary web URL: https://relayalbums.com. Bound to the existing live Worker version `76609db5-810c-4c08-8968-6c8b4dcd97d7`; no code deployment in this change. The workers.dev URL remains available. R2 CORS permits both exact origins. Both health endpoints and hosted custom-domain upload/download/section workflows passed. Browser sessions must be paired separately at the new origin. Account sign-in is not yet enabled. External uptime monitors still use the original origin.

## Account email setup ? 20 September 2026

`mail.relayalbums.com` is verified in Resend after publishing one DKIM TXT and two DNS-only CNAME records. Receiving remains disabled. A sending-only API key restricted to this domain is created. User saved Auth0 Resend provider with `Relay <accounts@mail.relayalbums.com>`; enabled provider and sender were verified after reload. One explicitly authorized Auth0 provider test email was sent to the account owner; Resend reports Delivered (message `01a0bdc5-7ae1-7512-bf5f-d1e2ceb686b8`). The user confirmed inbox receipt. Actual account recovery remains unverified and account login has not been enabled. No Worker deployment or identity migration was performed.

## Account/session code prepared - 20 September 2026

Local only: additive migration 0008, person/session persistence, Auth0 route integration and `/account` UI. Lint, TypeScript, build, protocol, D1/API/security, restore and account UI checks pass. Account UI tests use mocked identities; no live sign-in is claimed. Neither migration 0007 nor 0008 has been applied to production. Worker version is unchanged. User approved committing and pushing this tested source increment. This does not activate production sign-in.

## Membership and claim preparation - 20 September 2026

Local only: membership storage, explicit owner-claim API/UI and additive migration 0009. Real-D1 claim race/revocation tests, existing API regressions, restore checks and responsive UI checks pass. Production remains on the previously recorded Worker; migrations 0007-0009 are not applied. Live provider sign-up/sign-in and email verification are complete (Auth0 VERIFIED); person-based file access is still under implementation.


## Verification email authentication - 20 September 2026

User completed email verification, but found the message in Spam. Gmail shows SPF/DKIM PASS and DMARC FAIL. Published the missing sending-domain DMARC TXT (`_dmarc.mail.relayalbums.com`, `v=DMARC1; p=none;`) and verified Cloudflare readback plus authoritative and Google public DNS. Fresh-message authentication and inbox placement still need verification. No additional email, Worker release or identity migration occurred.


## Account library integration prepared - 20 September 2026

Local only: migration `0010_gifted_pandemic.sql`, stable non-authenticating attribution actors, explicit account-space API access and scoped library UI/transfer paths. Real D1/R2 route tests verify cross-person/space denial, stable uploader identity, exact original bytes, CSRF, role changes and revocation. Production still has no account activation; migrations 0007-0010 remain unapplied. Existing Worker version is unchanged. Personal spaces, switcher, lifecycle and live recovery/callback verification remain outstanding.

Validation: lint, TypeScript, production build, full API/security/D1 regression, the four-browser baseline suite, dedicated account-library browser checks, download-integrity/preview checks and eight recovery checks passed. A pairing rate-limit assertion failed on the first full API run; isolated and complete reruns passed without weakening the assertion. Account UI uses fixtures; real provider callback remains outstanding. User approved committing and pushing this tested increment on 21 September 2026. This source publication does not deploy the Worker or apply migrations.


## Personal spaces and switcher prepared - 21 September 2026

Local migration 0011 adds personal-space ownership and recorded quotas. Explicit creation is limited to 1 GiB per account and an operator-configured total allocation budget; default zero prevents public signup from allocating storage. Shared libraries keep their prior quota. Account UI and library switcher preserve destination scope across navigation and queued transfer actions. Isolation and quota tests pass on real D1/R2, and current API/security regression and snapshot restoration pass. Production has not received migrations 0007-0011 or an allocation budget. Worker version and public behaviour remain unchanged.

Validation completed: lint, TypeScript, production build, full API/security/D1 regression, eight recovery checks and the browser regression suite passed. New identity UI uses fixtures; real provider verification is still a separate release gate. The increment is published under the standing project authority.


## Session choices prepared - 21 September 2026

Migration `0012_gorgeous_stellaris.sql` and temporary/trusted session selection are implemented and locally tested. Provider logout uses the configured tenant's OIDC endpoint with an exact registered root return address; live provider logout/recovery verification remains outstanding. No production migration, runtime setting or Worker deployment was performed. Production remains on Phase 1; migrations 0007-0012 are prepared only.


## People and membership lifecycle prepared - 21 September 2026

Migration `0013_concerned_naoko.sql` adds bounded person invitations, membership revisions and durable access events. Shared-library people controls, explicit joins, owner handover, leaving/removal and linked legacy credential revocation are locally verified. Restore sanitization suspends restored memberships pending authority reconciliation. Existing unlinked legacy devices remain a separately disclosed audience; complete live migration and recovery checks are outstanding. No production migration or Worker deployment was performed; migrations 0007-0013 remain prepared only.


## Verified publication prepared - 21 September 2026

Migrations `0014_bizarre_bloodscream.sql` and `0015_romantic_riptide.sql` add durable publication intent and attempt-key history. Explicit private-to-shared copies, quota reservations, checksum validation, retries/cancellation and the web workflow are locally verified. Hosted streaming/interruption checks remain release gates. No production migration, allocation change or Worker release was performed; production remains at Phase 1 and migrations 0007-0015 are prepared only.


## 21 September 2026 - P2 recovery invalidation (local only)

- Added migrations 0016-0017, required signed password-change/authentication claims and authenticated provider recovery notifications. Older Relay sessions are revoked atomically; current identities, memberships and media are preserved.
- Auth0 Action source and installation/monitoring checklist are in `deploy/auth0` and `docs/IDENTITY-AND-SPACES-IMPLEMENTATION.md`. Nothing was installed in the live tenant; no recovery email was sent.
- Passed lint, TypeScript, production build, protocol/Action tests, full API/security and account-access/D1 regressions, and ten backup checks. Hosted CI for the preceding publication commit `22f024e` passed.
- Live Worker remains `76609db5-810c-4c08-8968-6c8b4dcd97d7`; migrations 0007-0017 remain unapplied remotely. Actual provider recovery/logout/callback, notification failure monitoring, lifecycle/legacy reconciliation and release checks remain gates.


## 21 September 2026 - P2 paired-device reconciliation (local only)

- Added owner-only account-scoped paired-device inventory and individual/all retirement in People & access. Explicit confirmation covers native-client access, preserved account memberships/files and non-recallable downloads.
- Real D1 tests passed for owner/member boundaries, claim labels, foreign space and CSRF denial, last paired-owner retirement and concurrent pairing. Lint, TypeScript, build, account-access regression and phone/desktop browser checks passed; updated phone screenshot inspected.
- No migration added by this increment, no live devices revoked and no deployment. Phase 2 production gates remain open.
