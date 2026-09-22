# Coordinated backup activation

Activated and verified 22 September 2026. Only global backup admission is active; account closure tracking and deletion execution remain disabled.

## Exact change

Migration `0019_wild_nighthawk.sql` adds four empty protocol tables and their constraints/indexes. It does not edit existing rows or infer account closure. The former prototype is retained as a comparison/removal candidate; never apply it over migration 0019.

`deploy/backup-coordination.json` is the single public activation switch for both the Worker and the checked-out backup writer. It is enabled (`enabled: true`); deployment and first coordinated evidence are verified below. When enabled, the backup job requires its dedicated `RELAY_BACKUP_COORDINATION_SECRET`; missing credentials stop before export or upload. The existing D1 reader and B2 writer/reader permissions remain separate. The coordinator capability can only admit/settle global backup runs; it cannot read library contents, erase data or clear fences.

Completion receipts are archived before settlement. Independently verify one using:

```powershell
node --disable-warning=ExperimentalWarning scripts/read-live-backup-completion.mjs <snapshot-id>
```

This uses existing D1/B2 readers and compares exact immutable versions against live coordinator state. Private evidence stays under ignored operations storage. It does not use the coordinator secret as its trust source.

## Checklist

- [x] Review backup-only schema minimisation; refuse account/device/fence/storage-effect references pending their separate disposition review.
- [x] Generate migration 0019 from the checked-in Drizzle schema; validate legacy upgrade, constraints, actual D1/R2 protocol tests, restore quarantine and minimisation.
- [x] Rehearse against a fresh private production export: all 21 existing application tables unchanged, four new tables empty, integrity/relationships and restored-access quarantine verified. Source hash `7bb18d8ce8e950241b229013eeeff3a8e24126f88e4923f4d527090dffbd8e7e`.
- [x] Complete fresh independent recovery run `35702440856`: snapshot `2026-09-22T08-00-57-472Z-89f00ca6-b73b-488c-b2ae-9ce8f940f2ad`, 25 originals, 321,680,743 bytes, all 25 reused and independently restored.
- [x] Pass TypeScript, full lint/build, actual built-Worker coordinator and enabled-tracking suites. No production activation yet.
- [x] Hosted CI `35702718797` passed verification and browser jobs for source `436af67`.
- [x] Apply migration 0019 and independently verify the fresh post-change export at 08:09 UTC: all 21 existing tables unchanged, all four new tables empty. Private bookmark/export evidence retained.
- [x] Install the dedicated random coordinator secret via stdin into the existing Worker and protected `relay-backup-copy` environment; encrypted local custody retained, no values logged. No existing data-reader/writer permissions were broadened.
- [x] Enable the common switch and deploy `45f8d855-7ef7-4f48-ad18-f26adc583eb2` at 100% (08:10 UTC). Both origins return application/operations health 200, anonymous feed 401 and unauthenticated coordinator 403. Account closure tracking remains absent.
- [x] Hosted coordinated backup/restore `35703394048` passed: snapshot `2026-09-22T08-11-23-130Z-7b55498a-f8f8-4526-bdb3-0e9bde64b2dd`, 25 originals, 321,680,743 bytes. Existing independent D1/B2 readers verify the one archived completion-receipt version against the current settled run and exact manifest. Live readback: one settled backup, zero unresolved admissions, fences, effects or account/device admissions.

## Recovery boundaries

The schema is additive and remains present if application code is rolled back. Keep account closure tracking disabled. An interrupted or ambiguous run stays active/uncertain and requires review; disabling coordination is not evidence that earlier writers stopped. Restored historical active runs become uncertain. The current backup-only minimisation review rejects any snapshot containing account closure references. No general account-closure completion is claimed by this activation.


## Restored historical-run reconciliation

Use `node scripts/read-live-backup-completion.mjs --restored-snapshot <private-sql-path>` to review every global backup run captured in a restored snapshot against independent current D1 and immutable B2 receipt readers. The tool never writes to the input file or current/restored protocol rows. Historical active/uncertain state remains intact; reconciliation is a separate private report bound to the source SQL digest.

- [x] Actual-schema tests reject missing/orphan bindings, a different current run for the same snapshot, conflicting historical receipt digests, unresolved live runs and source-inventory changes during review.
- [x] Review the real coordinated snapshot `2026-09-22T08-11-23-130Z-7b55498a-f8f8-4526-bdb3-0e9bde64b2dd`: one historical run reconciles against its independently retrieved completion evidence.
- [ ] Establish full writer quiescence, account/storage disposition and release acceptance before any restore cutover. Receipt verification alone does not clear those gates.
