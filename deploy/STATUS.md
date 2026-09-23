## 23 September 2026 - combined capacity live

Worker `37d3cc5f-9811-4ddc-94f0-fa00a82e9767` serves 100% from 05:11 UTC, source `cc8649d` on `fix/combined-capacity-live`. Schema remains 0020. The private operator configuration activates one 100 GiB personal/shared pool. Full backup `35814505652` and incremental `35821232068` passed before deployment; both-origin health/security/anonymous access and signed-in storage displays pass. [Checked evidence](../docs/COMBINED-STORAGE-IMPLEMENTATION.md). Removing pool configuration or reverting to code without enforcement is not a safe rollback after use; prefer a forward fix or admission pause. Historical records follow.

## Pending collaboration release - 22 September, 12:35 UTC

## 22 September 2026 - persistent workspace navigation hotfix

Worker `29137605-6bf6-4c2b-8631-5725b9d0d7c1` is at 100%, independently read back after deployment at 20:04 UTC. Runtime `4aaa73a` branches from verified live `9d81a1c`; schema remains 0020. Both-origin health/security/access probes pass. The signed-in plain homepage now exposes personal/shared choices and persistent account links. [Evidence](../docs/WORKSPACE-NAVIGATION-HOTFIX.md). Earlier records below retain their historical versions.


Favourites source `99ddc0f` passed hosted CI `35726758741` in both jobs. Activity is locally implemented and being verified. Migrations 0021/0022 are not remote; the live Worker remains `b7e1565a-3aa7-402c-acd2-5703cfe57ad4` on schema 0020.

Fresh backup `35726687872` copied 25 originals (321,680,743 bytes) to snapshot `2026-09-22T12-22-13-217Z-89d8fb98-3d1c-4bc8-ba67-6cd3661d24f9`; its independent restore failed with confirmed HTTP 403 `download_cap_exceeded`. Do not describe this snapshot as verified. Hold migration/deployment until a successful independent verification; no spending limits changed. Private live export and combined additive migration rehearsal preserve all 25 current tables and restore quarantine.

# Direct Cloudflare deployment

## Role-aware invitations - 22 September 2026

Worker `b7e1565a-3aa7-402c-acd2-5703cfe57ad4` is at **100%**, deployed at 12:14 UTC. Runtime `402b6e4`, verified follow-up `9d81a1c`; hosted `35725523545` passed both jobs. Migration 0020 adds only the invitation role with default Member for existing records. New web invitations default Contributor and may explicitly grant Viewer, Editor or Member; Owner cannot be invited directly.

A fresh independently restored backup `35724705808`, recovery bookmark and private D1 export preceded the migration. The exact live export passed local upgrade/quarantine rehearsal. Post-migration export comparison confirms all existing data across 25 tables unchanged. Both origins returned health/operations 200 and anonymous feed 401; signed-in People shows Contributor invitation preview and unchanged ownership. No real invitation or role change was made for testing. Migration 0021 remains local work only.


## Scoped collaboration roles - 22 September 2026

Worker `7a64bb09-c235-4958-91d9-b0ce10fd2526` is at **100%**, deployed at 12:02 UTC from `2e2c531`. Editor, Contributor and Viewer are available through explicit owner role changes. Current-authority and exact contribution checks cover file mutations, uploads, publication and legacy credentials. Existing members and devices keep their grants; no real membership was changed during verification.

Hosted CI `35724384084` passed both jobs. Both origins returned health/operations 200 and anonymous feed 401. The signed-in owner library still shows three active files and one in Trash; People shows the unchanged owner and the new role selector. No schema, pilot audience, quota, budget or closure-flag change. Invitations still grant Member until the separate migration release.


## Scoped retrieval and presentation - 22 September 2026

Worker `ebf5e35f-a289-4ec8-ae5e-51b430f8f7d2` is at **100%**, deployed 10:20 UTC from `c4c999d`. Adds file-type/own-upload filters, validated tab-local saved views, recent albums/interrupted-transfer shortcuts and a presentation cover that preserves ongoing transfers. No schema, access, budget or closure-flag change. Migration 0019 and coordinated backups remain active.

Local actual-schema API/authority checks, Chrome/Edge/Firefox/WebKit album workflows, focused presentation/retrieval browser tests, TypeScript, lint, build and dry run pass. Hosted `35715410132` passed both jobs, including the corrected 320px layout; earlier failed `35714770629` is superseded. Both origins return health/operations 200, anonymous feed 401 and unauthenticated coordinator 403. Signed-in filters, recent albums and hide/reveal verified without changing files or memberships. [Scope and evidence](../docs/INDEPENDENT-WEB-IMPROVEMENTS.md).


## Account browser-session feedback - 22 September 2026

Worker `dc3a0d93-4903-4075-a235-6c69be3af11f` is at **100%**, deployed 09:04 UTC from `390140a`. Account now distinguishes loading, sign-out progress, completed revocation and refresh failure; stale controls are hidden after failed refresh. Duplicate email subtitles are omitted. TypeScript, focused lint, build, dry run and delayed/error-response mobile browser tests pass; rendering inspected. Fresh signed-in account, personal/shared links and both retained browser sessions verified live without revoking either. No authentication, schema, quota or permission changes. Hosted CI `35708279076` passed both jobs. Subsequent preparation-only CI `35708556464` also passed both jobs; it changes no live permissions.

## Publication recovery clarity - 22 September 2026

Worker `70b02d61-1fa7-4d99-8197-93e467b9fa45` is at **100%**, deployed 08:46 UTC from `fa55b93`. The dialog waits for publication history before showing editable controls and distinguishes Previously published from a new completion. Fresh sign-in, personal preview, shared switching and People & access were verified. Independent D1 readback confirms 25 ready files and one publication, unchanged from before this review. No duplicate copy was created.

Delayed-response browser tests, TypeScript, focused lint, build and dry run passed. Hosted UI CI `35706287820` and disposition-verifier CI `35706520490` passed both jobs. Punctuation follow-up CI `35706646571` passed both jobs. Both origins retain health/operations 200, anonymous feed 401 and coordinator 403. Schema, pilot budget and access flags are unchanged.

## Approved Workers Paid monitor - 22 September 2026

Cloudflare confirms the explicitly approved Workers Paid subscription active at $5/month plus usage. Monitor version `679cc9bd-a536-448e-a4fd-d34db1be5420` is at 100%, deployed 08:32 UTC from `d1c5797`. Independent version readback confirms standard usage model and 1,000 ms CPU limit. The 19/49 schedule, private endpoint, read-only credentials and 40-identity pilot guard remain in place. Hosted CI `35705343640` passed verification and browser jobs. Post-upgrade 08:49 UTC cron passed at 8 ms CPU / 2,208 ms wall time, no exceptions; independent R2 readback confirms the signed success report. Current-pilot CPU headroom is established; broader load remains unvalidated.

## Delayed recovery identity protection - 22 September 2026

Worker `a25d36be-f1ca-4b52-90bb-eb043b310312` is at **100%**, deployed 08:28 UTC from runtime source `87d93eb`. Recovery notifications now refuse raw identity recreation after minimisation and updates to disabled identities, with authority checked inside each batch mutation. Full built-Worker account-access tests include a forced closure/recovery race and pass. TypeScript, focused lint, production build and dry run passed. Both origins return health/operations 200, anonymous feed 401 and unauthenticated coordinator 403. Hosted CI `35704906771` passed verification and browser jobs.

No schema, audience, quota or flag change: migration 0019 and global backup coordination remain enabled; account closure tracking remains disabled. Fresh sign-in and personal/shared library checks passed on 22 September; 25 ready files and one existing publication independently confirmed unchanged. Historical read-only inventory reconciles 12 SQL versions, 12 manifests and one completion receipt; seven older schemas still need review. No deletion or cutover performed.

## Global backup coordination - 22 September 2026

Worker `45f8d855-7ef7-4f48-ad18-f26adc583eb2` is at **100%**, deployed at 08:10 UTC. Runtime/build source `436af67`, activation source `1ec67a6`. Migration 0019 is applied; independently exported before/after data confirms all 21 prior application tables unchanged and all four new tables initially empty. A fresh backup and recovery bookmark preceded the migration.

Global backup coordination is enabled with its separate protected credential. Coordinated hosted backup/restore `35703394048` verified all 25 originals (321,680,743 bytes); independent D1/B2 readback verified the archived completion receipt against its exact settled run and manifest version. Live protocol state contains one settled backup and no unresolved or account/device/fence/storage-effect records.

Both origins pass health/operations 200, anonymous feed 401 and unauthenticated coordinator 403. Account closure tracking remains absent; pilot access and 1 GiB allocation unchanged. Source CI `35702718797` passed verification and browser jobs. The currently available user browser has no Relay session; fresh interactive verification awaits sign-in. No user-original removal. [Activation evidence](../docs/COORDINATED-BACKUP-ACTIVATION.md).

## Navigation and account authority - 22 September 2026

Worker `5cb25ea3-e4c8-438c-b84c-36f34764c905` is at **100%**, deployed at 07:34:48 UTC. Runtime source `49f1195`; subsequent `b5be10d` adds identity-entry-point tests and documentation only. Both hosted CI runs `35699723145` and `35700251894` passed verification and browser jobs, resolving the earlier WebKit navigation failure. Local Chrome/Edge/Firefox/WebKit, enabled tracking/account suites, build and deployment dry run passed.

Both origins return health/operations 200, anonymous feed 401 and dormant coordinator 404. Retained signed-in My space loads its one existing file. Closure tracking and backup coordination flags remain absent; schema remains through 0018, pilot access and 1 GiB allocation unchanged. No user-original removal. Historical release notes below retain their original verification context.

## Current-authority cleanup - 22 September 2026

Worker `1ea256df-3729-46ce-b1b3-9671647cf24b` is at **100%**, read back at 07:18 UTC. Source `b2ec3e1` checks authority before and after destructive cleanup and extends request-bound metadata checks behind disabled closure tracking. Previous version: `d2878ef1-7faa-4220-88bf-7fce19b63320`. Both origins pass health/operations 200, anonymous feed 401 and coordinator 404; retained signed-in My space displays its existing fixture. No schema or flag activation, quota change or user-original removal.

Local built-Worker account/tracking and legacy/API suites, actual-D1 race tests, TypeScript, lint, build and deployment dry run passed. Hosted CI `35698859429` verification passed, but its browser job failed in WebKit on background polling access-control errors during navigation. Chromium/Firefox passed. The navigation failure is under active investigation and is not marked verified.

## Publication recovery authority - 22 September 2026

Worker `d2878ef1-7faa-4220-88bf-7fce19b63320` is at **100%**, read back at 06:57 UTC. Source `6c57684` adds password-recovery checks to publication reservation/copy/visibility commits and current account/device authority before cancellation cleanup. Authorised repeated cleanup is preserved. Previous version: `13b029f9-328b-467d-9c5e-99a7dfc63285`.

TypeScript, focused lint, production build, actual-D1/R2 recovery race tests, full account-access/legacy API checks and deployment dry run passed. Both origins return health/operations 200, anonymous feed 401 and dormant coordinator 404. Retained signed-in My space shows its existing ready fixture after reload. Hosted CI `35697206357` passed verification and browser jobs. No schema, account audience, secrets, pilot quota or user originals changed.

The external identity/recovery test alert is now confirmed in Gmail Inbox (21 September, 11:57 a.m. EAT; inspected 22 September). Expansion capacity and full lifecycle execution remain open. Historical sections below describe their verification state at the time.

## Transfer authority and page lifecycle release - 21 September 2026

Worker `59b996f4-aea4-4ece-a808-3798a2d783b3` is live at **100%**, deployment read back at 15:55 UTC. Source `30fe826` includes atomic transfer-commit access checks and navigation-aware background polling. No schema, account audience, secret or 1 GiB pilot-budget change. Previous version: `fe4fa894-f45e-4c7d-93a6-4ced1a355774`.

Full local API/account/browser suites passed; hosted CI `35621810303` passed both verification and browser jobs, including the WebKit reload case that had failed before the polling repair. TypeScript, lint, production build and direct-deployment dry run passed. Both primary-origin health endpoints return 200. Anonymous session/feed/device access remains denied and invitation-only entry remains enforced. The hosted isolated transfer passed direct R2 multipart/CORS, cross-session visibility, exact SHA-256 download and receiver revocation. Its generated test original is retained in the existing Relay verification library; no user original was removed.

The independent monitor's optimised version `49576315-efae-4b4d-b815-29532e4aac8d` also passed its real 15:49 UTC cron at 8 ms CPU with signed delivery and healthy readback. Alert receipt, expansion capacity and full lifecycle execution remain separate gates.

Post-release read-only D1/R2 reconciliation passed: **32 objects, zero unfinished uploads, zero anomalies**, with unchanged before/after fingerprints. The one added generated original is newer than the last independently verified backup; no claim is made that it was included in that earlier recovery point.

## Latest web polish - 21 September 2026

Worker `fe4fa894-f45e-4c7d-93a6-4ced1a355774` is at 100%, with the same 1 GiB pilot allocation and schema. Account-library loading now uses neutral Library / Opening labels until verified scope arrives; People & access waits for a confirmed shared library. Publication and cancellation show their actual busy state. Lint, type checking, production build, dry run, deployment readback, live health and live loading-state UI verification passed. Recovery monitoring manual run 35581282633 also passed. Snapshot 2026-09-21T09-04-10-836Z-76478b50-0d2d-4ba9-97a3-73fea8e7536b independently restored all 23 originals (304,899,366 bytes). Original test source/copy hashes match, keys differ, and all 20 baseline original records remain unchanged. The two clearly named synthetic PNGs are retained as verification evidence; no user originals were changed or removed.

## Latest personal pilot configuration - 21 September 2026

Worker `f096dd18-8262-46b8-af0c-fa7e23a87da3` is verified at 100%. The only runtime setting change is a 1 GiB total personal allocation (`1073741824`); the designated-account pilot, provider audience and existing shared quotas are unchanged. Runtime-config tests, deployment dry run and live public/private-boundary health passed. My space creation, personal upload, separate shared counts, grouped switching and deliberate publication of a synthetic PNG are verified through the signed-in UI. Independent restoration and remaining adversarial publication verification are ongoing. No schema change. Combined recovery monitoring is scheduled at minutes 13/43 UTC; test-alert receipt remains pending.

## Operational release - 21 September 2026

Worker `75e9e54e-c94b-47e4-91d7-3d3d0608855e` is verified at 100%. Signed operational health reporting is live at the primary origin; no schema change (through 0018). Web CI 35580098973 passed, as did hosted combined recovery/identity checks 35580179355 and 35580503181. A signed failure produced 503; the real check rerun restored 200. Unsigned reports are rejected. Better Stack monitor 4956708 is Up on Free, with exact-200 checks and email-only alerting. User-authorised test alert sent; receipt and scheduling remain pending. Restricted identity pilot and zero personal allocation remain in place.

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


## 21 September 2026 - P2 deletion review (local only)

- Migration 0018 and account UI/API implement explicit deletion requests, ownership handover checks, recent authentication, pending status and withdrawal. Nothing is erased or disabled by a request.
- Added honest retention and operator execution runbook, read-only queue query and restored-request review hold. Verified irreversible erasure/backup reconciliation and request monitoring remain release gates.
- Passed lint, TypeScript, build, account-access/D1 regressions, account phone/desktop browser tests and 11 backup checks. Phone request-status screenshot inspected. Hosted CI passed recovery commit `7871635` and legacy reconciliation commit `89db785`.
- Production unchanged. Migrations 0007-0018 remain local; no live deletion or account request was performed.


## 21 September 2026 - Phase 2 release preparation

- Populated Phase 1 upgrade rehearsal through migration 0018 passed without changing existing credentials, media/object references, uploads, Trash, albums or custom sections/covers. Added the rehearsal to hosted CI.
- `deploy/identity-runtime.json` now explicitly controls public Auth0 settings and total personal allocation. Current values keep identity disabled and allocation at zero; the preparation script rejects unknown/secret fields and invalid origins/budgets. Configuration checks and lint passed.
- Provider setup was waiting for user sign-in because Auth0's dashboard session expired. This handoff was resolved in the subsequent increment below.

## 21 September 2026 - Auth0 dashboard preparation

- Dashboard access restored. Relay Web retains email/password; its Google connection was disabled after confirming Auth0 development keys. No connection deleted and no paid upgrade selected.
- Relay password-change claim is deployed and passed Auth0's hosted test. Flow binding is still pending the user drag/Apply handoff.
- Relay recovery notification draft and issuer/origin settings are saved; source hash matches the repository. New recovery secret is in an ignored local file; user entry into the prepared Auth0 dialog is pending. Notification Action remains undeployed/unbound and no Worker secret changed.
- Latest hosted CI passed through source commit `89e78a4`. This increment changes provider preparation and records evidence only; no recovery email, remote migration or Worker deployment. Live Worker remains `76609db5-810c-4c08-8968-6c8b4dcd97d7` and production remains Phase 1.

## 21 September 2026 - Restricted Phase 2 pilot deployed

- Source `accc13a` passed hosted CI. Explicit pilot audience restrictions pass signed-token, D1 session/transaction and full API/account-access regressions. Existing library and personal access rules still apply; admission creates no membership.
- Independent recovery point `2026-09-21T06-26-08-576Z-4ffeea27-bf7e-40a6-8bf4-0678f8de26f5` restored all 20 originals (304,872,656 bytes) with matching hashes/sizes and valid database relationships. Recovery bookmark and exports are private under `.sites-runtime/operations`.
- Rehearsed migrations 0007-0018 against the actual private export, then applied them remotely. A fresh remote export confirmed every legacy space/device/invitation/media/album/section/membership row unchanged and new identity tables empty.
- Deployed disabled baseline `d784cb6d-b8d3-481a-a18e-9d32319b8ec4`; private client/recovery/pilot binding installation produced `7fad3264-7580-4923-9c6c-923fd54c536b`. Hosted Chrome/Firefox library checks and primary-origin health/private-feed checks passed. The bounded hosted fixture remains for review.
- Activated restricted pilot **`0a65245e-5af3-4295-aa37-136c68d493be`**, deployment read back at **100%**. Public config is enabled/pilot with personal allocation zero. Only the designated provider subject can complete account sign-in; general onboarding remains closed.
- Live synthetic recovery accepts the correct signature (204) and rejects unsigned events (403). Auth0 hosted testing exposed unsupported dynamic import; corrected the Action to CommonJS `require`, added a matching sandbox regression and verified hosted success in 316 ms. Hosted source SHA-256: `39a8bee9a64c700b3f8073df53dae0583527c51adb509b94d997267e3fe7a4e1`.
- Login Action binding and saved recovery secret are verified. Recovery Action corrected version is deployed; user trigger drag/Apply and real pilot sign-in are pending. One recovery email is authorised, not yet sent. Automated Action-failure monitoring, real recovery/logout, lifecycle operations and general-release gates remain open.

## 21 September 2026 - Real sign-in and recovery delivery

- Verified the real Relay callback: designated user signed in at 09:37:40 Nairobi with a temporary session expiring at 17:37:40. Account UI shows no connected libraries; login has not inferred ownership or access.
- Verified the recovery Action between Start and Complete, Apply disabled and All changes are live. Both Action bindings are complete.
- Sent exactly one approved recovery email through the normal Universal Login reset flow. Auth0 displayed Check Your Email; Resend shows Delivered for message `01a0c2b0-56c2-723b-aeff-b671fdde0bf5` (Reset your password).
- User password change is pending. Preserve the existing account browser and check revocation before fresh sign-in, to distinguish webhook delivery from signed-login reconciliation. Inbox placement/authentication, trusted-session choice and provider logout are not yet verified.
- Hosted CI passed `f0c19a8`. No deployment or schema change in this verification increment; pilot Worker remains `0a65245e-5af3-4295-aa37-136c68d493be`.

## 21 September 2026 - Password-change revocation verified

- User completed the password change. Reloading the existing Relay account tab showed the signed-out screen before any new login.
- Read-only D1 evidence shows only the pre-reset temporary session: authentication `1789972657000`, creation `1789972660090`, provider password-change watermark `1789973030975`, revocation `1789973031391` (416 ms after the reset timestamp). This demonstrates notification-driven revocation in this test, not a general latency guarantee.
- The exact recovery message has Gmail's Inbox label. Gmail Original Message summary reports SPF PASS, DKIM PASS for `mail.relayalbums.com`, and DMARC PASS; sender is the configured Relay address. No reset link or raw message was copied into project records.
- Fresh sign-in with the changed password is handed to the user; provider logout verification follows. No additional email sent, no deployment and no migration in this increment.

## 21 September 2026 - Recovery completion and account entry

- Verified fresh sign-in with the changed password at 09:53:27 Nairobi. D1 authentication `1789973604000` is newer than reset watermark `1789973030975`.
- Tested Sign out this browser: Relay session revoked at `1789973639951`, returned to the registered root, and Auth0 audit records **Success Logout** at `2026-09-21T06:54:00.602Z`. Password recovery and current-browser provider logout are verified; trusted-browser persistence remains pending explicit permission.
- Fixed the signed-out welcome screen: direct Account & libraries entry, invitation guidance preserved, and outdated no-accounts wording replaced with accurate device-access guidance. Actions wrap with spacing on narrow screens.
- Lint, TypeScript, build and deployment dry run passed. Deployed **`f8ba096e-cb97-41b0-bf67-cc7bcecfee4d`**; primary-origin public health/private-feed probe passed and live desktop layout/account navigation were inspected. No schema, secrets, pilot audience or personal budget changed.

## 21 September 2026 - Trusted session and owner-migration preparation

- User explicitly approved seven-day browser persistence. Selected the trusted option, user completed sign-in, and account UI shows 21 September 10:02:47 to 28 September 10:02:47 Nairobi. D1 confirms `trusted`, 604800000 ms lifetime, and no revocation. Hosted CI passed `3e9d6e4`.
- Existing-library preview on the primary origin correctly requires a connected owner browser. The legacy-origin tab has active owner access to Our shared space; its device panel shows one owner and one member. No identity or ownership inferred from display names.
- Requested explicit approval to pair the primary-origin browser, promote that device through the existing owner, and connect the designated account as owner. This is persistent access expansion and requires browser-policy confirmation. No invitation, promotion, ownership connection or device revocation performed in this preparation.
- Remaining provider, lifecycle, operations and rollback requirements are consolidated in `docs/PHASE-2-RELEASE-GATES.md`.

## 21 September 2026 - Approved account-owner connection

- User explicitly approved primary-origin pairing, device promotion and account ownership. Existing owner browser created a one-use invitation; the new My desktop · relayalbums.com device joined and was promoted through owner controls.
- Recent-authentication preview named Our shared space, the designated account and the new owner device; confirmed connection succeeded. Account library and People & access show Owner. Explicit account-scoped library shows the same two live files, one Trash item, album and 130.7 MB storage.
- Reviewed all three paired devices. Original My desktop remains owner and My phone remains member, both unlinked to accounts. Only the newly claimed device is linked to the account. No revocation, data mutation, deployment, schema change or budget change.

## 21 September 2026 - Operational checks activated; provider monitor prepared

- Source dc3e2c3: Identity operations run 35576462943 passed using the existing read-only D1 environment credential. Static status only; no personal records logged. Both primary and legacy health probes passed in run 35576467793. Twice-hourly schedules are configured; cron execution, notification delivery and missed-run detection are separate evidence.
- Dedicated Auth0 read-only recovery monitor is implemented and locally tested, with a manual-only workflow. No provider application, access grant or secret created. Auth0 create-application form is staged as Relay Recovery Monitor; approval is needed for new tenant-wide read:logs/read:users access and secure GitHub environment storage.
- No Worker deployment, data deletion, paid upgrade, personal-budget change or sign-in audience expansion. See docs/RECOVERY-MONITORING.md.

## 21 September 2026 - Lifecycle request authority

- Deployed source `828bb9f` as Worker `2241047a-0bd9-441f-b0fd-bf301c4004f5`; remote deployment readback confirms 100%.
- Account deletion preview/request/withdrawal recheck the credential-change watermark. Withdrawal timestamps advance monotonically. Actual-D1 account-access integration, lint, TypeScript, build and deployment dry run passed.
- Both primary and legacy origins return 200 for application and operational health. Primary anonymous account-deletion preview returns 401; legacy-origin account routes retain their deliberate 403 boundary.
- No schema, secret, pilot audience or budget change; no account or media was erased. Owner signing custody and the initial independent empty archive were separately verified; general lifecycle execution remains open.
- Hosted Web checks `35652294580` passed verification and full browser jobs for deployed source `828bb9f`.

## 22 September 2026 - Library metadata authority

- Deployed source `df7f4b3` as Worker `2b08bccf-a9ce-4962-8942-7c698d99c613`; remote readback confirms 100% (21 September 22:29 UTC / 22 September 01:29 Nairobi).
- Library owner mutations now recheck live authority inside D1, including current owner role. Direct archive/restore and restart commits recheck access; personal-space allocation/retry rejects authentication preceding recovery.
- Focused actual-D1 stale-authority tests, full local API/account-access regressions, lint, TypeScript, build and deployment dry run pass. Hosted Web checks `35662558689` passed both verification and browser jobs.
- Both origins returned health/operational-health 200 and anonymous feed 401. Primary hosted sections passed create/upload/move/Undo/remove/restore/deep-link/exact-byte download. One tiny generated original remains in Relay verification; no user original was removed.
- Pilot audience, 1 GiB personal budget, existing secrets and migrations through 0018 remain unchanged. Closure/backup-coordinator prototypes are not activated. Provider removal rehearsal awaits the specific owner approval described in `docs/PROVIDER-ERASURE-REHEARSAL.md`.
- Independent backup refresh `35663011013` passed inventory, copy and separate Backblaze restoration. Snapshot `2026-09-21T22-31-05-943Z-8d72d96c-46cb-402f-a6f5-57c8e8bad75b` protects all 25 originals (321,680,743 bytes); one content object uploaded and 24 reused. Hash/relationship/access-revocation verification passed; failure reporting was correctly skipped.

## 22 September 2026 - Account metadata recovery authority

- Source `591d2ab` deployed as Worker `aa104f6e-586e-47d5-9d28-a06e0a44f26b`, confirmed at 100% at 06:14 UTC.
- Attribution writes use current profile/authority inside the D1 batch. Claim previews, confirmations and people-management mutations reject authentication predating recovery. Deterministic actual-D1 race tests, local legacy/account integration, TypeScript, focused lint, production build and deployment dry run passed.
- Both origins return 200 for health and operational health and 401 for anonymous feed. Owner completed fresh sign-in; My space, shared library and owner People & access all load correctly. No membership mutation or upload was needed. CI `35693941086` passed both verification and browser jobs.
- Database migrations remain through 0018, pilot audience and 1 GiB budget unchanged; closure coordinator/executor not activated.
- Separate approved Auth0 rehearsal passed creation/exact-profile/removal/independent absence. Temporary API/connection access is revoked; writer token expiry approximately 23 September 06:08 UTC. No real account or media was removed.

## 22 September 2026 - Erased identity callback guard

- Source `05d1c30` deployed as Worker `13b029f9-328b-467d-9c5e-99a7dfc63285` at 100%, independently read back at 06:29 UTC.
- Delayed verified callbacks cannot recreate profiles/sessions matching retained minimisation identity digests. Actual-D1 tests cover normal and inconsistent restored rows plus unrelated successful login. Identity/claim/legacy regression, TypeScript, lint, build and dry run pass.
- Both origins return health/operational health 200, anonymous feed 401 and dormant backup coordinator 404. Existing signed-in My space still loads its one fixture. No fresh password entry was required for this retained-session check; it is not a new provider callback rehearsal.
- Coordinator code is present but disabled. No protocol migration, new secret, backup activation, budget expansion or user-data deletion. Hosted CI `35695052192` passed its verification job; its browser job remains in progress.
- Scheduled backup `35683283282` independently passed inventory, copy and verification; no extra manual restore was triggered.
