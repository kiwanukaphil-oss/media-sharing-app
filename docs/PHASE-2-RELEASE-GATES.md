# Phase 2 release gates

Updated 21 September 2026. Phase 2 is deployed as a restricted designated-account pilot, not a general release. Worker 0a65245e-5af3-4295-aa37-136c68d493be is at 100%; migrations through 0018 are applied and legacy rows were verified unchanged. Personal allocation remains zero.

## Prepared and verified locally

- [x] Signed Auth0 protocol, one-time callback transactions, identity/session isolation and temporary/trusted sessions.
- [x] Person memberships, explicit legacy owner claims, scoped library access, personal-space budgets and switching.
- [x] Person invitations, ownership handover, member removal and explicit review/retirement of paired access.
- [x] Verified independent personal-to-shared publication, bounded reservations, retries and cancellation.
- [x] Password-change notification validation, signed-login reconciliation and Auth0 Action source/tests.
- [x] Deletion-request review/withdrawal, actual-retention disclosure and restored-request holds. This is not an erasure executor.
- [x] Populated Phase 1 migration rehearsal through 0018: legacy credentials/invitations, original metadata/object keys, Trash, multipart state, album/section/cover relationships and revisions remain unchanged. Identity tables start empty; no inferred membership or privacy change.
- [x] Public deployment configuration is checked in at `deploy/identity-runtime.json`: `enabled=true`, rollout `pilot`, personal budget `0`. `prepare-cloudflare.mjs` validates and carries these settings into the direct deployment config. Secrets are rejected from the public configuration.

## Provider and user handoffs

- [x] Restore and verify Auth0 dashboard access (21 September).
- [x] Review initial connections: Relay Web retains email/password; Google is disabled for this application because its connection uses Auth0 development keys. Dedicated Google credentials remain a future prerequisite.
- [x] Review baseline free-plan suitability: database login and the two Actions fit published free capabilities and the tenant's displayed Action allowance. No paid upgrade was selected. Production monitoring and post-trial verification remain separate gates.
- [x] Create, configure, deploy and pass the hosted test for **Relay password-change claim**. Deployment alone does not connect the login flow.
- [x] User connected the login Action and applied it. Verified the Action in the flow and All changes are live on 21 September.
- [x] Prepare **Relay recovery notification**, set its public issuer/origin settings, and verify the saved source matches the repository exactly. Generate the independent recovery secret in an ignored local file without printing it.
- [x] User entered and saved the recovery secret. Verified its setting name and saved draft without reading the value.
- [ ] Install and connect the reviewed Post Login and Post Change Password Actions; complete any required secure credential handoff. The latter is tenant-wide for database password changes: verify this tenant remains dedicated to Relay or explicitly constrain the operational scope before installation.
- [x] Configure matching Worker recovery and pilot bindings. Live signed synthetic event returns 204; unsigned event returns 403. Auth0 hosted notification test succeeds after the CommonJS compatibility correction.
- [ ] Complete Action failure monitoring and reconciliation path. Hosted test results expose redacted failures for the supervised pilot; automated production alerting is not complete.
- [ ] With explicit email authority, send the designated recovery email; the user completes the password change personally. Check fresh delivery authentication/inbox placement and observe revocation of an older Relay session plus successful new sign-in.
- [ ] Verify real callback, temporary/trusted browser choices and current-browser provider logout. Provider connection-test success is not sufficient.

## Lifecycle and operations

- [ ] Establish a monitored deletion-request queue, authorised executor, backup removal/minimisation policy and independent erasure/restore rehearsal. Follow [the retention runbook](ACCOUNT-DELETION-AND-RETENTION.md); no irreversible cleanup is inferred from project-wide development authority.
- [ ] Verify actual legacy owner claim and current paired-device audience without guessing people from names. Retire no live device without the explicit migration workflow.
- [ ] Choose and record a bounded personal allocation budget; personal creation remains disabled until the budget is set. Review aggregate R2/B2 growth before expanding it.
- [ ] Verify hosted original publication, interruption recovery, retained attempt-key cleanup and destination revocation before visibility with designated test data.
- [x] Create and independently restore snapshot 2026-09-21T06-26-08-576Z-4ffeea27-bf7e-40a6-8bf4-0678f8de26f5; verify 20 original hashes/sizes and database integrity. Rehearse the private export, apply migrations and verify unchanged legacy rows from a fresh remote export.

## Release sequence and rollback limits

1. General release requires the gates above. A restricted, designated-account pilot may run the live verification steps first, with personal allocation disabled and a verified recovery point. Set non-secret identity settings deliberately; keep all secrets in Worker/Action secret stores. Do not enable sign-in before the required signed claim is supplied.
2. Capture and independently verify a pre-release recovery point. Review migration 0007-0018 against the current database journal; apply only unapplied migrations. Preserve existing media and device access.
3. Deploy with identity disabled, verify baseline legacy web/native API behaviour and storage health, then enable the reviewed identity configuration and budget. Exercise designated account/space journeys before declaring release complete.
4. Record the Worker version, migration journal, verified behaviour and allocation in the roadmap and deployment log. Check parent items only after all their acceptance criteria pass.
5. If activation fails, disable new identity sign-in/allocation and return to the last compatible Worker while retaining the added schema and data. Do not roll the database back after users have created personal spaces, memberships or publications: an old snapshot can lose files or revive revoked access. Existing account users need a clear service-status/recovery path; a rollback to a legacy-only Worker is not feature-equivalent.

Both Auth0 handoffs are verified. The user authorised one recovery email to the designated test account on 21 September; it has not yet been sent. The restricted pilot receiver is live and hosted synthetic notification succeeds. Next: user sign-in and password-change trigger binding, then the authorised real recovery test. Automated monitoring remains outstanding. Later collaboration/privacy phases remain dependent on these identity release gates.
