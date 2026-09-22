# Phase 2 release gates

Updated 22 September 2026. Phase 2 remains a restricted designated-account pilot, not a general release. Live runtime and migration evidence are maintained in [deployment status](../deploy/STATUS.md); the current verified runtime is `dc3a0d93-4903-4075-a235-6c69be3af11f`. Total personal allocation remains 1 GiB. Navigation, recovery/current-authority checks and retained signed-in library verification passed. Backup coordination and migration 0019 are live and independently verified through the [staged activation record](COORDINATED-BACKUP-ACTIVATION.md); account closure execution remains disabled.

## Prepared and verified locally

- [x] Signed Auth0 protocol, one-time callback transactions, identity/session isolation and temporary/trusted sessions.
- [x] Person memberships, explicit legacy owner claims, scoped library access, personal-space budgets and switching.
- [x] Person invitations, ownership handover, member removal and explicit review/retirement of paired access.
- [x] Verified independent personal-to-shared publication, bounded reservations, retries and cancellation.
- [x] Password-change notification validation, signed-login reconciliation and Auth0 Action source/tests.
- [x] Deletion-request review/withdrawal, actual-retention disclosure and restored-request holds. This is not an erasure executor.
- [x] Populated Phase 1 migration rehearsal through 0018: legacy credentials/invitations, original metadata/object keys, Trash, multipart state, album/section/cover relationships and revisions remain unchanged. Identity tables start empty; no inferred membership or privacy change.
- [x] Public deployment configuration is checked in at `deploy/identity-runtime.json`: `enabled=true`, rollout `pilot`, personal budget `1073741824`. `prepare-cloudflare.mjs` validates and carries these settings into the direct deployment config. Secrets are rejected from the public configuration.

## Provider and user handoffs

- [x] Restore and verify Auth0 dashboard access (21 September).
- [x] Review initial connections: Relay Web retains email/password; Google is disabled for this application because its connection uses Auth0 development keys. Dedicated Google credentials remain a future prerequisite.
- [x] Review baseline free-plan suitability: database login and the two Actions fit published free capabilities and the tenant's displayed Action allowance. No paid upgrade was selected. Production monitoring and post-trial verification remain separate gates.
- [x] Create, configure, deploy and pass the hosted test for **Relay password-change claim**. Deployment alone does not connect the login flow.
- [x] User connected the login Action and applied it. Verified the Action in the flow and All changes are live on 21 September.
- [x] Prepare **Relay recovery notification**, set its public issuer/origin settings, and verify the saved source matches the repository exactly. Generate the independent recovery secret in an ignored local file without printing it.
- [x] User entered and saved the recovery secret. Verified its setting name and saved draft without reading the value.
- [x] Install and connect both reviewed Actions, complete the credential handoff, and verify both applied flows. Post Change Password is tenant-wide; current application inventory is Relay Web and Default App, and future additions must review this scope.
- [x] Configure matching Worker recovery and pilot bindings. Live signed synthetic event returns 204; unsigned event returns 403. Auth0 hosted notification test succeeds after the CommonJS compatibility correction.
- [x] Prepare and locally test dedicated provider failure/password-reset reconciliation checks; [activation and response runbook](RECOVERY-MONITORING.md) records exact scopes and limitations.
- [x] Authorise dedicated read-only provider access and install the credential. Exactly read:logs/read:users verified; protected main-only GitHub storage.
- [x] Verify hosted provider and identity checks, signed failure reporting and recovery after real checks pass (35579499914, 35580179355, 35580503181).
- [x] Configure external aggregate-health monitor 4956708 and verify Up on the Free plan. Missing/failed/stale reports fail closed; tests cover 90-minute expiry.
- [x] Configure combined monitoring at minutes 13 and 43 UTC each hour; GitHub scheduling is best effort.
- [x] Observe independent Cloudflare scheduled combined runs at 15:19 and 15:49 UTC on 21 September, with signed delivery and healthy public readback; optimised CPU sample is 8 ms on Free.
- [x] Verify the already-sent identity/recovery test-alert receipt: Gmail Inbox inspected 22 September; message dated 21 September at 11:57 a.m. EAT.
- [x] Verify current-pilot monitoring headroom after approved Paid activation: actual 08:49 UTC run uses 8 ms of the configured 1,000 ms, with independent signed-report delivery.
- [ ] Validate broader identity capacity before expanding beyond the restricted pilot.
- [x] Rehearse operator repair with designated synthetic identities in isolated actual-schema D1: monitor detection, signed replay, independent watermark readback, old-session revocation, newer/unrelated-session preservation, library fingerprints and replay ordering passed. Real provider/receiver verification is recorded separately.
- [x] Send the explicitly authorised recovery email; user completes password change. Gmail Inbox label and SPF/DKIM/DMARC PASS verified. Old browser is signed out before any fresh login; D1 records notification-driven revocation 416 ms after reset.
- [x] Verify fresh sign-in with the changed password (09:53:27 Nairobi). Signed authentication is newer than the reset watermark.
- [x] Verify the real Relay callback and eight-hour temporary session with the designated account. No library access is inferred.
- [x] Verify current-browser sign-out: Relay session revoked, return to registered home page, and Auth0 audit Success Logout at 06:54:00.602 UTC.
- [x] User explicitly approved trusted-browser persistence; selected the option and completed sign-in. UI shows 21-28 September expiry; D1 confirms trusted mode, 604800000 ms lifetime and no revocation.

## Lifecycle and operations

- [x] Implement aggregate-only queue and known recovery/session consistency checks with actual-schema tests; scheduled workflow reuses existing D1 read-only access.
- [x] Verify hosted identity operations and both-origin health checks (runs 35576462943 and 35576467793).
- [ ] Verify operator notifications and missed-run detection; provider delivery cannot be inferred from a consistent local watermark.

- [x] Implement and locally test a private read-only erasure review inventory; exact personal ownership, shared-copy preservation, content-addressed backup dependencies and intent/handover blockers verified.
- [ ] Establish a monitored deletion-request queue, authorised executor, backup removal/minimisation policy and independent erasure/restore rehearsal. Follow [the retention runbook](ACCOUNT-DELETION-AND-RETENTION.md); no irreversible cleanup is inferred from project-wide development authority.
- [x] Verify actual legacy owner claim and current paired-device audience without guessing people from names. User approved and completed primary-origin pairing/promotion/account claim on 21 September. Account-scoped files and roles verified; original desktop owner and phone member retained. No live device retired.
- [x] Choose and record a bounded personal allocation budget: 1 GiB total for the designated-account pilot; per-person allowance remains 1 GiB. No pilot audience expansion or paid upgrade. Review aggregate R2/B2 growth before expanding it.
- [x] Deploy the pilot allocation and verify real My space creation, upload, grouped switching, separate shared counts and explicit synthetic publication. Independent restore and adversarial hosted publication checks remain separate gates.
- [x] Verify hosted original publication through the real pilot UI and independent original restoration. Separate cloud D1/R2 rehearsal passes interruption/retry, attempt cleanup, destination revocation before visibility and cancellation; generated source originals survive. See [rehearsal evidence](HOSTED-PUBLICATION-REHEARSAL.md).
- [x] Create and independently restore snapshot 2026-09-21T06-26-08-576Z-4ffeea27-bf7e-40a6-8bf4-0678f8de26f5; verify 20 original hashes/sizes and database integrity. Rehearse the private export, apply migrations and verify unchanged legacy rows from a fresh remote export.

## Release sequence and rollback limits

1. General release requires the gates above. A restricted, designated-account pilot may run the live verification steps first, with personal allocation disabled and a verified recovery point. Set non-secret identity settings deliberately; keep all secrets in Worker/Action secret stores. Do not enable sign-in before the required signed claim is supplied.
2. Capture and independently verify a pre-release recovery point. Review migration 0007-0018 against the current database journal; apply only unapplied migrations. Preserve existing media and device access.
3. Deploy with identity disabled, verify baseline legacy web/native API behaviour and storage health, then enable the reviewed identity configuration and budget. Exercise designated account/space journeys before declaring release complete.
4. Record the Worker version, migration journal, verified behaviour and allocation in the roadmap and deployment log. Check parent items only after all their acceptance criteria pass.
5. If activation fails, disable new identity sign-in/allocation and return to the last compatible Worker while retaining the added schema and data. Do not roll the database back after users have created personal spaces, memberships or publications: an old snapshot can lose files or revive revoked access. Existing account users need a clear service-status/recovery path; a rollback to a legacy-only Worker is not feature-equivalent.

Both Auth0 handoffs are verified. The user authorised one recovery email to the designated test account on 21 September; it was sent and Resend confirms delivery (01a0c2b0-56c2-723b-aeff-b671fdde0bf5). The restricted pilot receiver is live and hosted synthetic notification succeeds. Real sign-in and password-change trigger binding are verified. Password change, old-session revocation before fresh login, and Inbox authentication are verified. New sign-in and provider logout are verified. Trusted-browser verification is complete. Existing-library owner connection and actual device audience are verified. Automated monitoring, signed delivery and test-alert receipt are verified, including the Paid-plan execution on 22 September. Remaining gates are lifecycle execution/restore reconciliation, actual post-trial verification and capacity evidence before expansion. Later collaboration/privacy releases remain dependent on these gates; policy preparation may continue without activation.

Historical recovery point (21 September): 2026-09-21T09-04-10-836Z-76478b50-0d2d-4ba9-97a3-73fea8e7536b independently restored 23 originals / 304,899,366 bytes. The synthetic personal original and published copy have distinct R2 keys and matching expected SHA-256. All 20 baseline original rows remain unchanged. Recovery checks passed again after allocation activation (35581282633). Hosted adversarial interruption/revocation now passes in dedicated cloud resources; lifecycle execution remains open.


## Current outstanding work - 22 September

- [x] Verify coordinated backup `35703394048`: snapshot `2026-09-22T08-11-23-130Z-7b55498a-f8f8-4526-bdb3-0e9bde64b2dd`, all 25 originals / 321,680,743 bytes independently restored. Exact completion receipt and historical active run reconciled read-only; no restore cutover.
- [x] Verify deployed account feedback and hosted browser checks; prepare collaboration policy and review all affected routes without changing live permissions.
- [ ] Obtain R2-specific in-flight multipart guarantees from Cloudflare case **02338622**. The open email checked at approximately 09:10 UTC is an acknowledgement only.
- [ ] Complete independent disposition evaluation, protocol-aware minimisation and the complete generated-person lifecycle rehearsal. Component rehearsals and signatures do not establish whole-account erasure. Prepare any irreversible rehearsal scope before requesting specific authority.
- [ ] Verify actual post-trial authentication/recovery and broader monitoring/storage capacity before widening the pilot. Initial email/password and Free-plan baseline are already reviewed; Google development keys remain disabled.

No new purchase, message or user action is currently requested. Parent Phase 2 acceptance remains incomplete.
