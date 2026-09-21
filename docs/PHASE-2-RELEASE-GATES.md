# Phase 2 release gates

Updated 21 September 2026. Production remains Phase 1; no remote migration or deployment was performed during this preparation. This checklist consolidates the critical path without treating local implementation as a live release.

## Prepared and verified locally

- [x] Signed Auth0 protocol, one-time callback transactions, identity/session isolation and temporary/trusted sessions.
- [x] Person memberships, explicit legacy owner claims, scoped library access, personal-space budgets and switching.
- [x] Person invitations, ownership handover, member removal and explicit review/retirement of paired access.
- [x] Verified independent personal-to-shared publication, bounded reservations, retries and cancellation.
- [x] Password-change notification validation, signed-login reconciliation and Auth0 Action source/tests.
- [x] Deletion-request review/withdrawal, actual-retention disclosure and restored-request holds. This is not an erasure executor.
- [x] Populated Phase 1 migration rehearsal through 0018: legacy credentials/invitations, original metadata/object keys, Trash, multipart state, album/section/cover relationships and revisions remain unchanged. Identity tables start empty; no inferred membership or privacy change.
- [x] Public deployment configuration is checked in at `deploy/identity-runtime.json`: `enabled=false`, personal budget `0`. `prepare-cloudflare.mjs` validates and carries these settings into the direct deployment config. Secrets are rejected from the public configuration.

## Provider and user handoffs

- [x] Restore and verify Auth0 dashboard access (21 September).
- [x] Review initial connections: Relay Web retains email/password; Google is disabled for this application because its connection uses Auth0 development keys. Dedicated Google credentials remain a future prerequisite.
- [x] Review baseline free-plan suitability: database login and the two Actions fit published free capabilities and the tenant's displayed Action allowance. No paid upgrade was selected. Production monitoring and post-trial verification remain separate gates.
- [x] Create, configure, deploy and pass the hosted test for **Relay password-change claim**. Deployment alone does not connect the login flow.
- [ ] Connect that Action between Start and Complete in Post Login and Apply. Automated drag did not persist; the user has the open flow tab.
- [x] Prepare **Relay recovery notification**, set its public issuer/origin settings, and verify the saved source matches the repository exactly. Generate the independent recovery secret in an ignored local file without printing it.
- [ ] User enters and saves `RELAY_RECOVERY_SECRET` in the prepared Auth0 dialog. Browser credential-entry rules require this handoff.
- [ ] Install and connect the reviewed Post Login and Post Change Password Actions; complete any required secure credential handoff. The latter is tenant-wide for database password changes: verify this tenant remains dedicated to Relay or explicitly constrain the operational scope before installation.
- [ ] Configure the matching Worker recovery secret, Action failure monitoring and reconciliation path. Verify failures are visible without logging secrets or account details.
- [ ] With explicit email authority, send the designated recovery email; the user completes the password change personally. Check fresh delivery authentication/inbox placement and observe revocation of an older Relay session plus successful new sign-in.
- [ ] Verify real callback, temporary/trusted browser choices and current-browser provider logout. Provider connection-test success is not sufficient.

## Lifecycle and operations

- [ ] Establish a monitored deletion-request queue, authorised executor, backup removal/minimisation policy and independent erasure/restore rehearsal. Follow [the retention runbook](ACCOUNT-DELETION-AND-RETENTION.md); no irreversible cleanup is inferred from project-wide development authority.
- [ ] Verify actual legacy owner claim and current paired-device audience without guessing people from names. Retire no live device without the explicit migration workflow.
- [ ] Choose and record a bounded personal allocation budget; personal creation remains disabled until the budget is set. Review aggregate R2/B2 growth before expanding it.
- [ ] Verify hosted original publication, interruption recovery, retained attempt-key cleanup and destination revocation before visibility with designated test data.
- [ ] Verify the latest independent backup and rehearse the release against a current private production snapshot. The synthetic upgrade test is not a claim of having migrated live data.

## Release sequence and rollback limits

1. Finish the gates above. Set non-secret identity settings deliberately; keep all secrets in Worker/Action secret stores. Do not enable sign-in before the required signed claim is supplied.
2. Capture and independently verify a pre-release recovery point. Review migration 0007-0018 against the current database journal; apply only unapplied migrations. Preserve existing media and device access.
3. Deploy with identity disabled, verify baseline legacy web/native API behaviour and storage health, then enable the reviewed identity configuration and budget. Exercise designated account/space journeys before declaring release complete.
4. Record the Worker version, migration journal, verified behaviour and allocation in the roadmap and deployment log. Check parent items only after all their acceptance criteria pass.
5. If activation fails, disable new identity sign-in/allocation and return to the last compatible Worker while retaining the added schema and data. Do not roll the database back after users have created personal spaces, memberships or publications: an old snapshot can lose files or revive revoked access. Existing account users need a clear service-status/recovery path; a rollback to a legacy-only Worker is not feature-equivalent.

The next critical-path steps are the two prepared Auth0 handoffs (connect the login Action and save the recovery secret), followed by receiver/monitoring configuration and the user-owned password-recovery test. Recovery-email authorisation remains pending; no new email was sent. Later collaboration/privacy phases remain dependent on these identity release gates.
