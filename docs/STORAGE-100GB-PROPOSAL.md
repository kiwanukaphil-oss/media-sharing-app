# Personal capacity proposal - 100 GB

Prepared 22 September 2026. Requested capacity: 100 GB combined across the existing owner's personal and shared libraries. The owner approved the additional $5/month planning budget and daily incremental/monthly full verification, then explicitly selected combined storage. The combined allowance is live as of 23 September 2026.

## Concrete scope

- One 107,374,182,400-byte allowance (100 GiB, displayed as 100 GB by the current formatter) covers the two existing libraries together. Neither library receives a separate 100 GB entitlement.
- A private operator configuration names exactly the existing personal and shared library IDs. Each quota-producing database statement sums the same pool before reserving bytes: regular uploads, previews, publication copies and future intake allowances. No schema migration or broad per-account default change is required.
- Personal and shared file audiences remain separate. Only the current authenticated owner of both libraries sees exact combined billing totals; other users see their own accessible library details and the shared-capacity label.
- Include originals, previews, Trash and outstanding reservations. Copies into the other library consume additional bytes. No automatic deletion, additional memberships or general onboarding.

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
- [x] Owner approved the additional recurring budget, verification policy and combined personal/shared allowance.
- [x] Implement and hosted-test separate incremental/full verification evidence, bounded streaming and monitoring; six-hour runner ceilings remain an operational limit.
- [x] Owner saved the B2 payment method. Replace automatically unlimited caps with $0.04/day storage (dashboard: 183 GB) and $1.10/day downloads (111 GB); existing 75%/100% alerts remain enabled.
- [x] Full backup `35814505652` and incremental `35821232068` passed; activated schema-compatible Worker `37d3cc5f-9811-4ddc-94f0-fa00a82e9767`.
- [x] Both live library views show the same 100 GB combined allowance; isolated compiled Worker quota/concurrency checks and independent backup acceptance passed. Checked roadmap and deployment evidence updated.

The production pool is active; deletion policy remains unchanged. The approved daily schedule now chooses incremental verification with monthly full rereads; explicit release checks remain full. Caps limit daily exposure, not monthly spend: sustained maximum download usage could cost more than the approved planning estimate. Full checks at 100 GiB must not be run daily. Retained backup growth approaching the storage cap requires operator review, never automatic deletion. A new encryption key lives only in the existing main-only backup verification environment; the copy job cannot forge independent verification evidence.
