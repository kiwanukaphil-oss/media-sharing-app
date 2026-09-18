# Release candidate: production readiness and usability

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
