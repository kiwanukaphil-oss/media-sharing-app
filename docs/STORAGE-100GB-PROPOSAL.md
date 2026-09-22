# Personal capacity proposal - 100 GB

Prepared 22 September 2026. Requested capacity: 100 GB for the existing owner's My space. Status: prepared; spending and backup-policy decision pending. Live allowance remains 1 GiB.

## Concrete scope

- Increase only the existing personal library to 107,374,182,400 bytes (100 GiB, displayed as 100 GB by the current binary formatter). Do not change shared-library quotas, other accounts or general onboarding.
- Update the exact personal_spaces quota record with expected-old-quota, current owner/active membership and aggregate-allocation guards. Raising only PERSONAL_STORAGE_BUDGET_BYTES is insufficient: existing account access reads the database quota.
- Raise the aggregate personal allocation budget only to the amount needed to cover this existing space and any independently verified existing allocations. Preserve the default allowance for new accounts and the designated-account pilot.
- Include originals, previews, Trash and outstanding reservations in existing quota enforcement. A larger allowance is a ceiling, not an immediate purchase of filled capacity.

## Cost comparison at full utilisation

Planning uses 107.374 decimal GB, available provider free allowances, one unchanged deduplicated backup copy and 30 days. Existing shared data, retained deleted versions, previews outside assumed use, taxes, API/compute charges and extra restore runs can increase cost. Provider allowances apply across the account, not separately to each library.

| Item | Approximate monthly cost |
| --- | ---: |
| R2 Standard: (107.374 - 10) x $0.015 | $1.46 |
| B2 backup: (107.374 - 10) x $0.00695 | $0.68 |
| Current daily full restore: (30 - 3) x 107.374 x $0.01, assuming ordinary billable GitHub egress | $28.99 |
| Existing Workers Paid base | $5.00 |
| Current-policy subtotal | $36.13 |

Sources checked 22 September: [R2 pricing](https://developers.cloudflare.com/r2/pricing/) and [B2 pricing](https://www.backblaze.com/cloud-storage/pricing/). B2 includes egress up to three times average monthly storage; eligible partner downloads differ. No partner exemption is assumed for the current GitHub runner.

## Recommended lower-cost approach

Propose an additional $5/month operating budget (approximately $10/month including the existing $5 Workers base), subject to usage monitoring; this is not a provider-enforced total cap. Keep daily backups and verify each newly copied original through the independent reader. Verify database snapshots/manifests daily, retain independently authenticated prior evidence for unchanged exact object versions, and run a full byte-for-byte restore monthly. Never label an incremental verification as a new full restore. Continue fresh full restore checks for consequential migrations and recovery exercises, with budget reviewed before extra large runs.

This changes how frequently unchanged bytes are reread and must be accepted explicitly. It does not permit skipping verification of newly copied files. Retained deleted backups can grow beyond the live 100 GB allowance; this proposal does not authorise automatic deletion or unlimited storage growth. High turnover or extra full restores may require a larger budget.

## Activation checklist

- [x] Inspect actual quota and backup scheduling code; confirm exact existing-space update is required.
- [x] Check current provider pricing and calculate full-use costs, including daily restore traffic.
- [ ] Owner approves additional recurring budget and verification policy (or chooses the current daily full-restore policy and larger budget).
- [ ] Implement and test separate incremental/full verification evidence and monitoring before changing the live schedule; review runner capacity and timeouts at 100 GiB.
- [ ] Inspect live B2 billing eligibility and download/storage caps. Resolve the existing download-cap blocker without an unapproved cap change.
- [ ] Obtain a verified recovery point; apply guarded quota/budget updates to the exact existing personal space using a schema-compatible release.
- [ ] Verify storage display, quota-boundary/reservation behaviour and independent backup operation; update checked roadmap and deployment evidence.

No production quota, cap, billing setting, backup schedule or deletion policy has changed.
