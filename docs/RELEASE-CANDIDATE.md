# Release candidate: production readiness and usability

## Current release position - 22 September 2026

The current production baseline is Worker `b7e1565a-3aa7-402c-acd2-5703cfe57ad4`, schema 0020, with designated-account access, a 1 GiB personal allocation and coordinated backups. General onboarding, account closure, restricted audiences, intake and deliveries are not activated. Repository publication and routine phase progression are already authorised by [AGENTS.md](../AGENTS.md); no new routine approval is needed.

| Candidate area | Development evidence | Remaining release acceptance |
| --- | --- | --- |
| Favourites, scoped activity, metadata export and folder mapping | Implemented; route/browser and migration checks recorded in the roadmap | Fresh independently verified backup, migration and live acceptance |
| Restricted audiences and explicit copies | Hosted run 35739071750 passed; private-export rehearsal preserved all 25 existing tables without inventing grants | Safe migration, live scope/compatibility checks and controlled activation |
| Named-account upload requests | Hosted main run 35746222158 passed; admission pause run 35752698764 passed | Provider disposition guarantees, live quota/transfer verification and operational activation |
| Snapshot deliveries | Hosted run 35749765799 passed; immutable selections, named-recipient authority, source suspension and restored-link quarantine tested | Live recipient, revocation, expiry and operational acceptance |
| Original ZIP packages | Hosted run 35751118759 passed; independent ZIP extraction and 2 GiB bounded stream checked | Physical-device/live transfer checks; final hosted cross-browser/file-writer run 35754168633 passed |
| Exact duplicate assistance | Hosted run 35752042399 passed; same-space/same-audience matching, streamed verification and deliberate reuse/Undo | Deployed verification; final hosted cross-browser run 35754168633 passed |

Development completion does not mean production activation. Parent roadmap counts remain **22/47**; [the roadmap](DEVELOPMENT-ROADMAP.md) is the authoritative checked status.

### Ordered rollout checklist

- [x] Prepare migrations 0021-0027 and isolated upgrade/restore rehearsals preserving existing rows, indexes and protective triggers.
- [x] Document intake limits and incident pause/restart in [intake operations](INTAKE-OPERATIONS.md), and package/access limits in [delivery contract](DELIVERY-CONTRACT.md).
- [x] Final hosted regression `35754168633` passed verification and browser jobs at `a0e6306`, including repeated folder reselection and disk-backed package writing.
- [ ] Clear B06: obtain a fresh independently restored backup. Run `35726687872` copied all 25 originals but restore failed with `download_cap_exceeded`; it is **not** a verified recovery point. The documented reset is 23 September at 03:00 EAT. No cap increase is approved.
- [ ] Refresh the private D1 export/recovery bookmark and rehearse the exact intended migration subset against that export. Check current writes, custody and actual schema before applying only missing migrations.
- [ ] Release independent favourites/activity/portability increments first when their backup gate clears. Do not make ordinary releases depend on optional creative-review demand.
- [ ] Before restricted/intake/delivery activation, verify all relevant lifecycle and restore treatment, safe feature flags, scoped existing-client behaviour and bounded live acceptance. Keep disabled features disabled if their own gates remain open.
- [ ] Read back the exact deployed Worker allocation and schema; verify both public origins, existing owner access and affected journeys, then record deployed checkboxes and evidence.

### Blocking dependencies and rollback constraints

Cloudflare case **02338622** must establish how already-admitted multipart requests are reconciled after cancellation. An awaited abort or temporarily absent object is not proof of permanent quiescence. Account closure and intake physical disposition remain gated; no actual account deletion or restore cutover is authorised. Actual post-trial identity operation and broader capacity evidence remain separate general-release gates in [Phase 2 release gates](PHASE-2-RELEASE-GATES.md).

After restricted records exist, never roll back to code that ignores access scopes: disabling creation does not remove existing restricted data. Delivery/intake tables and custody likewise require a compatible Worker and restore procedure. Prefer a forward fix; preserve original bytes and unresolved custody. Intake pause stops new admissions while preserving owner review/close and receipts; it cannot recall previously issued capabilities or erase files.

Phase 6 requires actual demand for creative comparison/review. Optional media relationships and digests also require evidence of need. These are pending product gates, not permission pauses for ordinary implementation. No default AI processing is planned.

## Historical release preparation - 17-18 September 2026

The following record is retained as historical evidence, not the current release sequence. Its old versions, schema state and approval wording are superseded by the current position above and standing project authority.

Prepared 2026-09-17 and revalidated 2026-09-18. The user approved completing and publishing all 39 candidate files. Production deployment and migration remain separate and pending.

## Verified preflight

- Existing production health probe passes: home page, security header, database/storage health and anonymous feed denial.
- Live Worker remains version `279fd194-3c83-4ea2-8ea4-1ed4bb0199d9` at 100% allocation. A transient management API connection failure resolved on retry.
- Live `devices.role` and `invitations.created_by` are absent: migration 0003 has not been applied.
- Read-only owner election selects `My desktop` for the user's space and `Relay cloud test sender` for the isolated verification space. Both spaces have an active candidate. Private UUID mapping is retained under ignored `.sites-runtime/release-preflight/owner-results.json`.
- At inspection there were zero unfinished uploads and five ready originals totaling 233,197,388 bytes. Recheck immediately before migration; this observation is not a write freeze.
- Production config prepared and Wrangler deploy dry run passed. Correct D1/R2/rate-limit bindings remain present; Worker secrets are not embedded in the generated config.
- Fresh API/permission/security/transfer tests, legacy-role migration and owner-recovery preparation checks passed. Dependency audit reports zero vulnerabilities. Phase 3 TypeScript/lint/build and four-browser results are documented separately.
- Better Stack alert delivery was confirmed by the user. Independent Backblaze backups and the daily GitHub runner are active, with a successful hosted full restore; see OPERATIONS-ACTIVATION.md.

## Candidate impact

First devices become owners; invited devices become members. Owners control deletion and access. Migration 0003 invalidates unused legacy invitations; paired devices and original files remain. Existing native clients will encounter 403 responses for newly owner-only actions. Usability work includes reliable loading/retry feedback, mobile Help, contrast/touch improvements, visual polish and optional video posters.

See [Phase 1](PHASE-1-READINESS.md), [Phase 2](PHASE-2-USABILITY.md) and [Phase 3](PHASE-3-POLISH.md) for implementation and evidence.

## Prepared release sequence

1. Repository commit/push is approved. Obtain separate approval for the production release and migration.
2. Confirm the intended owner's browser still works. Arrange a brief pause in writes, rerun the active-owner query and check unfinished uploads.
3. Capture a fresh D1 recovery bookmark and private export; validate restoration in isolated storage. The earlier recovery exercise is historical, not a fresh release backup. Independent media backup activation is described in [the operations proposal](OPERATIONS-PROPOSAL.md).
4. Apply only `drizzle/0003_device_roles.sql`, once, to production. Do not replay older migrations. Confirm the role columns, owner mapping and legacy-invitation invalidation.
5. Deploy `dist/server/wrangler.direct.json` from the tested candidate. Recheck that the build/config have not changed since validation. Preserve existing Worker secrets.
6. Read back the deployed version/allocation. Run public health checks and bounded hosted owner/member, invitation, thumbnail and exact-byte transfer checks only in the isolated verification space.
7. Verify the user's desktop owner role and establish a second trusted owner. Resume normal writes and retain the release evidence.

## Release limits

Alert delivery and independent backup/restore have passed. Real-iPhone validation remains unresolved; do not equate desktop WebKit testing with physical-device validation. Workers paid-plan capacity remains unverified. Free-tier and framework prerelease constraints remain documented in the runbook.

The pre-role Worker is schema-compatible but does not enforce owner/member access. Rolling back to it would broaden permissions; prefer a forward fix. A rollback to that security behavior requires an explicit informed decision.

Fresh 2026-09-18 checks passed: strict web lint, TypeScript, production build, zero-vulnerability dependency audit, original-download integrity, preparation progress, preview lifecycle, legacy role migration, owner recovery preparation, and isolated transfer/management/permission/security API tests. Clean-checkout browser CI runs after publication. No additional Backblaze restores were performed during this release validation, preserving the remaining daily bandwidth allowance. No production migration or deployment is included in repository publication.
