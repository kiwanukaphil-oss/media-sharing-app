# Combined capacity and scalable backup verification

## Approved scope

100 GiB shared between the existing personal and shared libraries; additional $5/month planning budget; daily backups with independent new-version checks and monthly full byte verification. Budget is not a provider-enforced billing cap. Keep all file audiences, existing clients, retained originals and deletion gates intact.

## Implementation evidence

- [x] Validated private `RELAY_STORAGE_POOL` configuration accepts exactly two distinct library IDs and a limit at most 100 GiB. Invalid configuration fails closed. Unlisted libraries retain existing limits.
- [x] Same-statement pooled SQL reservations cover ordinary account/device uploads, previews, publication copies and prepared intake allowances. Disposable D1 verifies concurrent cross-library reservations, exact boundary, Trash/previews and common-owner privacy.
- [x] Storage UI labels the combined allowance. Only a live signed-in owner of both libraries gets the aggregate count; all filenames/upload lists remain library-scoped.
- [x] Hosted backup originals now stream from R2 to bounded B2 parts, and independent original verification hashes a stream instead of retaining large disk copies. Small files use ordinary B2 upload; larger files have at least two parts. Tests cover corruption, incorrect object versions and 16 MiB boundaries.
- [x] Daily incremental verification restores/checks SQL and manifest, independently verifies new versions, and checks exact old-version presence. Checksums carried forward come from AES-GCM authenticated, bucket/run-bound evidence encrypted using a verifier-only secret. Public GitHub artifacts contain ciphertext only. New versions never inherit old checksums.
- [x] Monthly rollover, missing history or explicit full dispatch requires a full reread. Evidence older than 35 days cannot be reused. Full reports retain `verified`; incremental reports use `incremental-verified`, preserving the distinction for release/recovery gates.
- [x] Backup heartbeat accepts only complete fresh reports with bounded full-verification age. Workflow tests preserve read/write credential separation and main-only entry; artifact history requires read-only Actions permission only in the verifier.
- [x] Compiled Worker pool tests pass on both current main and the schema-0020 release patch: concurrent cross-space reservation, common limit and aggregate privacy after ownership loss. Account/closure/publication and intake regression pass; browser storage display checks pass.
- [x] Hosted main run `35780616516` and schema-0020 release patch `cc8649d` run `35780653681` pass both verification and browser jobs.
- [x] Inspect Backblaze caps: current account has no payment method; 10 GB storage and 1 GB/day download caps explain the verification failure.
- [x] Owner saved the card. B2 caps now $0.04/day storage (183 GB) and $1.10/day download (111 GB), with existing alerts enabled. These are daily ceilings, not monthly fees or a $5 total guarantee.
- [x] Real full baseline `35814505652` passed on 23 September (323,643,069 bytes independently reread); incremental run `35821232068` passed with zero original bytes reread and 323,643,069 bytes carried from authenticated evidence plus current exact-version presence checks. B06 is resolved. Historical failed attempt: Run `35782249944` copied successfully but independent verification still failed with HTTP 403 `download_cap_exceeded` after the dashboard cap change. Two fresh reader authorizations and one-byte probes also failed; do not count this snapshot as verified. This historical failure is superseded by the successful 23 September runs.
- [x] Reopen the provider dashboard after a transient invalid-session message: both new caps and both existing alert checkboxes are displayed. Actual download acceptance remains the deciding release gate.
- [x] Activate the private pool on schema-0020 compatible source `cc8649d`, Worker `37d3cc5f-9811-4ddc-94f0-fa00a82e9767`, at 100% on 23 September 05:11 UTC. Both-origin health, security headers and anonymous denial pass. No migration required.
- [x] Signed-in live browser verifies Personal and Shared both show 132.7 MB / 100.0 GB, the same 139,134,720-byte aggregate. Current-library Trash and file lists remain separate. Quota boundary/concurrency checks passed against the built Worker in disposable storage; no production fill-to-limit test or user-file mutation was performed.

## Limits and operations

The hosted copy and verifier jobs have six-hour ceilings; originals use bounded buffers and do not accumulate on runner disk. This removes the previous total-capacity/disk mismatch but is not a measured 100 GiB provider throughput benchmark. Metadata exports retain their existing bounded 8 MiB guard. Failure or missing/stale monthly evidence must alert; it must never produce a success heartbeat. Failed multipart backups remain for operator review under the existing no-automatic-purge policy.

The verification secret lives only in `relay-backup-verify`; loss or rotation requires a fresh full baseline. It is not an access credential. The authenticated evidence is tied to a successful main-branch execution of the exact backup workflow, immutable artifact and run ID. The new artifact is retained for 40 days; the maximum reusable evidence age is 35 days. Backups remain retained, so churn and extra restore runs can exceed the approved planning estimate and require review.

Pool configuration is operator-owned and never a user-provided request field. It controls billing only. Restore still revokes sessions, memberships and historical delivery links. Removing the pool configuration restores old per-space limits and may leave a personal library over its old allowance; never delete files to force it under that limit. A rollback to code without pool enforcement is not safe after activation; prefer a forward fix or pause admissions.
